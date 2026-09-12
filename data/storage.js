/* ============================================================
   K-Delta — Persistent Storage Module
   Saves user watchlists and terminal preferences to disk.
   ============================================================ */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname);
const WATCHLIST_FILE = path.join(DATA_DIR, 'watchlist.json');

const DEFAULT_WATCHLIST = [
  'RELIANCE.NS',
  'TCS.NS',
  'HDFCBANK.NS',
  'INFY.NS',
  'ICICIBANK.NS',
  'SBIN.NS',
  'BHARTIARTL.NS',
  'TATAMOTORS.NS',
  'TATASTEEL.NS',
  'ITC.NS',
  'LT.NS',
  'MARUTI.NS',
  '^NSEI',
  '^BSESN',
];

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Ensure watchlist.json exists with valid JSON array on initial run
if (!fs.existsSync(WATCHLIST_FILE)) {
  try {
    fs.writeFileSync(WATCHLIST_FILE, JSON.stringify(DEFAULT_WATCHLIST, null, 2), 'utf8');
  } catch (err) {
    console.error('Error creating initial watchlist file:', err);
  }
}

/**
 * Read all watchlist symbols strictly as saved by user
 */
function getWatchlist() {
  try {
    if (!fs.existsSync(WATCHLIST_FILE)) {
      return [...DEFAULT_WATCHLIST];
    }
    let data = fs.readFileSync(WATCHLIST_FILE, 'utf8');
    if (data.charCodeAt(0) === 0xFEFF) {
      data = data.slice(1);
    }
    const parsed = JSON.parse(data.trim() || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('Error reading watchlist file:', err);
    return [];
  }
}

/**
 * Save complete watchlist array strictly as requested by user
 */
function saveWatchlist(list) {
  try {
    if (!Array.isArray(list)) return false;
    const unique = Array.from(new Set(list.map(s => s.trim().toUpperCase()).filter(Boolean)));
    fs.writeFileSync(WATCHLIST_FILE, JSON.stringify(unique, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Error saving watchlist:', err);
    return false;
  }
}

/**
 * Add a symbol to the persistent watchlist
 * @param {string} symbol - Stock symbol
 */
function addToWatchlist(symbol) {
  try {
    if (!symbol) return getWatchlist();
    const cleanSym = symbol.trim().toUpperCase();
    const list = getWatchlist();
    if (!list.includes(cleanSym)) {
      list.push(cleanSym);
      saveWatchlist(list);
    }
    return list;
  } catch (err) {
    console.error('Error adding to watchlist:', err);
    throw err;
  }
}

/**
 * Remove a symbol from the persistent watchlist
 * @param {string} symbol - Stock symbol
 */
function removeFromWatchlist(symbol) {
  try {
    if (!symbol) return getWatchlist();
    const cleanSym = symbol.trim().toUpperCase();
    const list = getWatchlist();
    const filtered = list.filter(s => s !== cleanSym);
    saveWatchlist(filtered);
    return filtered;
  } catch (err) {
    console.error('Error removing from watchlist:', err);
    throw err;
  }
}

module.exports = {
  getWatchlist,
  saveWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  DEFAULT_WATCHLIST,
};
