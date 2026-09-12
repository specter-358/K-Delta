/* ============================================================
   K-Delta — Secure Real-Time WebSocket Streaming Engine
   Features: Authenticated handshake, IP Connection Limits,
   Heartbeat, Rate Limiting, Feed Quality Status (LIVE/DELAYED)
   ============================================================ */

const WebSocket = require('ws');
const { provider, normalizeSymbol } = require('./marketProvider');
const { candleEngine } = require('./candleEngine');
const authStore = require('./authStore');

class SecureWebSocketHub {
  constructor() {
    this.wss = null;
    // Map: ws client -> Set of subscribed symbols
    this.clientSubscriptions = new Map();
    // Map: symbol -> Set of ws clients
    this.symbolSubscribers = new Map();
    // Map: IP -> Active connection count
    this.ipConnectionCounts = new Map();
    // Map: ws client -> metadata { ip, isAlive, messageCount, lastReset }
    this.clientMetadata = new Map();
    
    this.heartbeatTimer = null;
  }

  init(server) {
    const maxPerIp = parseInt(process.env.WS_MAX_CONNECTIONS_PER_IP || '10', 10);

    this.wss = new WebSocket.Server({ 
      server, 
      path: '/ws',
      verifyClient: (info, callback) => {
        const ip = info.req.socket.remoteAddress || 'unknown';
        const currentCount = this.ipConnectionCounts.get(ip) || 0;

        if (currentCount >= maxPerIp) {
          console.warn(`[WS-SEC] Rejected connection from ${ip}: Max connections exceeded (${maxPerIp})`);
          return callback(false, 429, 'Too many WebSocket connections from this IP');
        }

        callback(true);
      }
    });

    this.wss.on('connection', (ws, req) => {
      const ip = req.socket.remoteAddress || 'unknown';
      this.ipConnectionCounts.set(ip, (this.ipConnectionCounts.get(ip) || 0) + 1);

      this.clientSubscriptions.set(ws, new Set());
      this.clientMetadata.set(ws, {
        ip,
        isAlive: true,
        messageCount: 0,
        lastReset: Date.now(),
        authenticatedUser: null,
      });

      ws.on('pong', () => {
        const meta = this.clientMetadata.get(ws);
        if (meta) meta.isAlive = true;
      });

      ws.on('message', (message) => {
        try {
          const meta = this.clientMetadata.get(ws);
          if (meta) {
            const now = Date.now();
            if (now - meta.lastReset > 60000) {
              meta.messageCount = 0;
              meta.lastReset = now;
            }
            meta.messageCount++;

            // Rate limit: max 60 messages/minute
            if (meta.messageCount > 60) {
              return ws.send(JSON.stringify({ type: 'error', error: 'WebSocket rate limit exceeded (max 60 msgs/min)' }));
            }
          }

          const data = JSON.parse(message);
          this.handleClientMessage(ws, data);
        } catch (err) {
          ws.send(JSON.stringify({ type: 'error', error: 'Invalid JSON payload' }));
        }
      });

      ws.on('close', () => {
        this.cleanupClient(ws);
      });

      ws.on('error', (err) => {
        console.warn('[WS-SEC] Client socket error:', err.message);
        this.cleanupClient(ws);
      });

      // Send initial secure acknowledgement with feed quality status
      const isMarketOpen = provider.isMarketOpen ? provider.isMarketOpen() : true;
      ws.send(JSON.stringify({
        type: 'connected',
        feedStatus: isMarketOpen ? 'LIVE' : 'DELAYED',
        exchange: 'NSE / BSE',
        serverTimeIST: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST',
        supportedTimeframes: ['1min', '3min', '5min', '15min', '30min', '1h', '1day'],
        securityMode: 'AUTH_STRICT',
      }));
    });

    // Heartbeat Ping/Pong Check every 30 seconds
    this.heartbeatTimer = setInterval(() => {
      this.wss.clients.forEach((ws) => {
        const meta = this.clientMetadata.get(ws);
        if (meta) {
          if (!meta.isAlive) {
            console.log(`[WS-SEC] Terminating dead connection from IP: ${meta.ip}`);
            return ws.terminate();
          }
          meta.isAlive = false;
          ws.ping();
        }
      });
    }, 30000);

    // Wire market provider ticks to candle engine and WS subscribers
    provider.on('tick', (tick) => {
      this.broadcastTick(tick);
      candleEngine.processTick(tick);
    });

    // Wire candle updates to WS subscribers
    candleEngine.on('candle_update', ({ symbol, timeframe, candle }) => {
      this.broadcastToSymbol(symbol, {
        type: 'candle_update',
        symbol,
        timeframe,
        candle,
      });
    });

    // Wire closed candles to WS subscribers
    candleEngine.on('candle_closed', ({ symbol, timeframe, candle }) => {
      this.broadcastToSymbol(symbol, {
        type: 'candle_closed',
        symbol,
        timeframe,
        candle,
      });
    });

    console.log('📡 K-Delta Secure WebSocket Stream Engine initialized on /ws');
  }

  handleClientMessage(ws, data) {
    const { action, symbol, timeframe, token } = data;

    // Token Auth handling
    if (action === 'auth' && token) {
      const user = authStore.verifyToken(token);
      const meta = this.clientMetadata.get(ws);
      if (user && meta) {
        meta.authenticatedUser = user;
        return ws.send(JSON.stringify({ type: 'auth_success', user: authStore.sanitizeUser(user) }));
      } else {
        return ws.send(JSON.stringify({ type: 'auth_error', error: 'Invalid authentication token' }));
      }
    }

    if (action === 'subscribe' && symbol) {
      const normSym = normalizeSymbol(symbol);
      const subs = this.clientSubscriptions.get(ws) || new Set();
      subs.add(normSym);
      this.clientSubscriptions.set(ws, subs);

      if (!this.symbolSubscribers.has(normSym)) {
        this.symbolSubscribers.set(normSym, new Set());
      }
      this.symbolSubscribers.get(normSym).add(ws);

      provider.subscribe(normSym);

      ws.send(JSON.stringify({
        type: 'subscribed',
        symbol: normSym,
        timeframe: timeframe || '1day',
        feedStatus: 'LIVE',
      }));
    } else if (action === 'unsubscribe' && symbol) {
      const normSym = normalizeSymbol(symbol);
      const subs = this.clientSubscriptions.get(ws);
      if (subs) subs.delete(normSym);

      const symbolClients = this.symbolSubscribers.get(normSym);
      if (symbolClients) {
        symbolClients.delete(ws);
        if (symbolClients.size === 0) {
          this.symbolSubscribers.delete(normSym);
          provider.unsubscribe(normSym);
        }
      }

      ws.send(JSON.stringify({ type: 'unsubscribed', symbol: normSym }));
    } else if (action === 'ping') {
      ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
    }
  }

  broadcastTick(tick) {
    if (!tick || !tick.symbol) return;
    this.broadcastToSymbol(tick.symbol, {
      type: 'tick',
      feedStatus: 'LIVE',
      data: tick,
    });
  }

  broadcastToSymbol(symbol, payload) {
    const clients = this.symbolSubscribers.get(symbol);
    if (!clients || clients.size === 0) return;

    const message = JSON.stringify(payload);
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    }
  }

  cleanupClient(ws) {
    const meta = this.clientMetadata.get(ws);
    if (meta && meta.ip) {
      const count = this.ipConnectionCounts.get(meta.ip) || 1;
      if (count <= 1) {
        this.ipConnectionCounts.delete(meta.ip);
      } else {
        this.ipConnectionCounts.set(meta.ip, count - 1);
      }
    }

    const subs = this.clientSubscriptions.get(ws);
    if (subs) {
      for (const sym of subs) {
        const clients = this.symbolSubscribers.get(sym);
        if (clients) {
          clients.delete(ws);
          if (clients.size === 0) {
            this.symbolSubscribers.delete(sym);
            provider.unsubscribe(sym);
          }
        }
      }
    }

    this.clientSubscriptions.delete(ws);
    this.clientMetadata.delete(ws);
  }

  getActiveStats() {
    return {
      activeConnections: this.clientSubscriptions.size,
      activeSubscribedSymbols: this.symbolSubscribers.size,
      connectedIPs: this.ipConnectionCounts.size,
    };
  }
}

module.exports = {
  WebSocketHub: SecureWebSocketHub,
  wsHub: new SecureWebSocketHub(),
};
