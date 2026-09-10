/* ============================================================
   K-Delta — Real-Time WebSocket Streaming Hub
   Distributes live NSE/BSE ticks, dynamic candles & pattern alerts
   ============================================================ */

const WebSocket = require('ws');
const { provider, normalizeSymbol } = require('./marketProvider');
const { candleEngine } = require('./candleEngine');

class WebSocketHub {
  constructor() {
    this.wss = null;
    // Map: ws client -> Set of subscribed symbols
    this.clientSubscriptions = new Map();
    // Map: symbol -> Set of ws clients
    this.symbolSubscribers = new Map();
  }

  init(server) {
    this.wss = new WebSocket.Server({ server, path: '/ws' });

    this.wss.on('connection', (ws, req) => {
      this.clientSubscriptions.set(ws, new Set());

      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message);
          this.handleClientMessage(ws, data);
        } catch (err) {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON payload' }));
        }
      });

      ws.on('close', () => {
        this.cleanupClient(ws);
      });

      ws.on('error', (err) => {
        console.warn('WebSocket client error:', err.message);
        this.cleanupClient(ws);
      });

      // Send connection acknowledgement
      ws.send(JSON.stringify({
        type: 'connected',
        serverTimeIST: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST',
        supportedTimeframes: ['1min', '3min', '5min', '15min', '30min', '1h', '1day'],
      }));
    });

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

    console.log('📡 K-Delta WebSocket Stream Engine bound to /ws');
  }

  handleClientMessage(ws, data) {
    const { action, symbol, timeframe } = data;

    if (action === 'subscribe' && symbol) {
      const normSym = normalizeSymbol(symbol);
      const subs = this.clientSubscriptions.get(ws) || new Set();
      subs.add(normSym);
      this.clientSubscriptions.set(ws, subs);

      if (!this.symbolSubscribers.has(normSym)) {
        this.symbolSubscribers.set(normSym, new Set());
      }
      this.symbolSubscribers.get(normSym).add(ws);

      // Tell provider to start streaming ticks
      provider.subscribe(normSym);

      ws.send(JSON.stringify({
        type: 'subscribed',
        symbol: normSym,
        timeframe: timeframe || '1day',
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
  }
}

module.exports = {
  WebSocketHub,
  wsHub: new WebSocketHub(),
};
