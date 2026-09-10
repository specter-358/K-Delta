/* ============================================================
   K-Delta — Persistent History Storage Module
   Saves stock observations, analyses, and trade signals to disk.
   ============================================================ */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname);
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Ensure history.json exists with valid JSON array
if (!fs.existsSync(HISTORY_FILE)) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify([], null, 2), 'utf8');
}

/**
 * Read all history records
 */
function getHistory() {
  try {
    if (!fs.existsSync(HISTORY_FILE)) return [];
    const data = fs.readFileSync(HISTORY_FILE, 'utf8');
    return JSON.parse(data || '[]');
  } catch (err) {
    console.error('Error reading history file:', err);
    return [];
  }
}

/**
 * Add a record to history
 * @param {Object} record - History record object
 */
function addHistoryRecord(record) {
  try {
    const history = getHistory();
    
    // Create new record with unique ID and IST timestamp
    const now = new Date();
    const istString = now.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      dateStyle: 'medium',
      timeStyle: 'medium',
      hour12: true,
    });

    const newEntry = {
      id: 'hist_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      symbol: record.symbol ? record.symbol.toUpperCase() : 'UNKNOWN',
      name: record.name || record.symbol || 'Equity',
      exchange: record.exchange || (record.symbol && record.symbol.endsWith('.BO') ? 'BSE' : 'NSE'),
      price: typeof record.price === 'number' ? record.price : parseFloat(record.price) || 0,
      change: typeof record.change === 'number' ? record.change : parseFloat(record.change) || 0,
      percentChange: typeof record.percentChange === 'number' ? record.percentChange : parseFloat(record.percentChange) || 0,
      volume: record.volume || 0,
      signal: record.signal || 'HOLD',
      action: record.action || record.signal || 'WAIT',
      confidence: record.confidence || 0,
      trend: record.trend || 'sideways',
      tradeSetup: record.tradeSetup || null,
      summary: record.summary || '',
      marketStatus: record.marketStatus || 'Market Closed',
      timestamp: now.toISOString(),
      timestampIST: `${istString} IST`,
    };

    // Filter out immediate duplicate within 30 seconds for the same symbol
    const thirtySecsAgo = Date.now() - 30000;
    const filtered = history.filter(h => {
      const isSameSymbol = h.symbol === newEntry.symbol;
      const isRecent = new Date(h.timestamp).getTime() > thirtySecsAgo;
      return !(isSameSymbol && isRecent);
    });

    // Add to beginning, cap at 200 items
    filtered.unshift(newEntry);
    if (filtered.length > 200) filtered.pop();

    fs.writeFileSync(HISTORY_FILE, JSON.stringify(filtered, null, 2), 'utf8');
    return newEntry;
  } catch (err) {
    console.error('Error saving history record:', err);
    throw err;
  }
}

/**
 * Delete a specific record by ID
 */
function deleteHistoryRecord(id) {
  try {
    const history = getHistory();
    const filtered = history.filter(h => h.id !== id);
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(filtered, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Error deleting history record:', err);
    return false;
  }
}

/**
 * Clear all history
 */
function clearHistory() {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify([], null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Error clearing history:', err);
    return false;
  }
}

module.exports = {
  getHistory,
  addHistoryRecord,
  deleteHistoryRecord,
  clearHistory,
};
