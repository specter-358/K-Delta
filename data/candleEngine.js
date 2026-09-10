/* ============================================================
   K-Delta — Real-Time Candlestick Engine
   Dynamically tracks forming candle and aggregates closed bars
   Supports: 1m, 3m, 5m, 15m, 30m, 1h, 1D, 1W
   Strictly aligned with Indian Market trading hours (09:15–15:30 IST)
   ============================================================ */

const EventEmitter = require('events');

const TIMEFRAME_SECONDS = {
  '1min': 60,
  '1m': 60,
  '3min': 180,
  '3m': 180,
  '5min': 300,
  '5m': 300,
  '15min': 900,
  '15m': 900,
  '30min': 1800,
  '30m': 1800,
  '1h': 3600,
  '60min': 3600,
  '1day': 86400,
  '1d': 86400,
  '1week': 604800,
  '1wk': 604800,
  '1w': 604800,
};

class RealTimeCandleEngine extends EventEmitter {
  constructor() {
    super();
    this.formingCandles = new Map();
    this.historicalBuffers = new Map();
  }

  getTimeframeSeconds(interval) {
    const key = (interval || '1min').toLowerCase();
    return TIMEFRAME_SECONDS[key] || 60;
  }

  getPeriodStart(timestampMs, intervalSec, isDaily = false) {
    const sec = Math.floor(timestampMs / 1000);
    if (isDaily) {
      const d = new Date(timestampMs);
      return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
    }
    return Math.floor(sec / intervalSec) * intervalSec;
  }

  setHistoricalBuffer(symbol, timeframe, candles) {
    const key = `${symbol}_${timeframe}`;
    this.historicalBuffers.set(key, [...candles]);
  }

  /**
   * Process an incoming live market tick
   */
  processTick(tick, timeframes = ['1min', '3min', '5min', '15min', '30min', '1h', '1day', '1week']) {
    if (!tick || !tick.symbol || tick.price == null) return;

    const symbol = tick.symbol;
    const price = tick.price;
    const timestampMs = tick.timestamp || Date.now();
    const isMarketOpen = tick.isMarketOpen !== false;

    for (const tf of timeframes) {
      const isDaily = tf === '1day' || tf === '1d' || tf === '1week' || tf === '1wk' || tf === '1w';
      
      // If market is closed and this is an intraday timeframe, do not create phantom evening candles
      if (!isMarketOpen && !isDaily) {
        continue;
      }

      const intervalSec = this.getTimeframeSeconds(tf);
      const periodKey = this.getPeriodStart(timestampMs, intervalSec, isDaily);
      const mapKey = `${symbol}_${tf}`;

      let forming = this.formingCandles.get(mapKey);

      if (!forming) {
        forming = {
          time: periodKey,
          open: price,
          high: price,
          low: price,
          close: price,
          volume: tick.volume || 0,
          isForming: true,
          symbol,
          timeframe: tf,
        };
        this.formingCandles.set(mapKey, forming);
        this.emit('candle_update', { symbol, timeframe: tf, candle: forming });
      } else if (forming.time === periodKey) {
        forming.high = Math.max(forming.high, price);
        forming.low = Math.min(forming.low, price);
        forming.close = price;
        forming.volume = tick.volume || forming.volume;
        this.emit('candle_update', { symbol, timeframe: tf, candle: forming });
      } else {
        // Period elapsed: seal completed bar
        const closedCandle = {
          time: forming.time,
          open: forming.open,
          high: forming.high,
          low: forming.low,
          close: forming.close,
          volume: forming.volume,
          isForming: false,
          symbol,
          timeframe: tf,
        };

        const buffer = this.historicalBuffers.get(mapKey) || [];
        buffer.push(closedCandle);
        if (buffer.length > 500) buffer.shift();
        this.historicalBuffers.set(mapKey, buffer);

        this.emit('candle_closed', { symbol, timeframe: tf, candle: closedCandle, buffer });

        // Start new forming candle
        forming = {
          time: periodKey,
          open: price,
          high: price,
          low: price,
          close: price,
          volume: tick.volume || 0,
          isForming: true,
          symbol,
          timeframe: tf,
        };
        this.formingCandles.set(mapKey, forming);
        this.emit('candle_update', { symbol, timeframe: tf, candle: forming });
      }
    }
  }
}

module.exports = {
  RealTimeCandleEngine,
  candleEngine: new RealTimeCandleEngine(),
};
