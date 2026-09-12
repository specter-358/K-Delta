/* ============================================================
   K-Delta — Isolated User Watchlist Storage Module
   Supports user data isolation per userId & backward compatibility
   ============================================================ */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname);
const WATCHLIST_FILE = path.join(DATA_DIR, 'watchlist.json');
const USER_WATCHLISTS_FILE = path.join(DATA_DIR, 'user_watchlists.json');

const DEFAULT_WATCHLIST = [];

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadUserWatchlists() {
  try {
    if (fs.existsSync(USER_WATCHLISTS_FILE)) {
      return JSON.parse(fs.readFileSync(USER_WATCHLISTS_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('Error loading user watchlists:', err);
  }
  return {};
}

function saveUserWatchlists(map) {
  try {
    fs.writeFileSync(USER_WATCHLISTS_FILE, JSON.stringify(map, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Error saving user watchlists:', err);
    return false;
  }
}

/**
 * Get Watchlist for specific user or guest default
 */
function getWatchlist(userId = 'guest') {
  try {
    if (!userId || userId === 'guest') {
      if (!fs.existsSync(WATCHLIST_FILE)) return [...DEFAULT_WATCHLIST];
      let data = fs.readFileSync(WATCHLIST_FILE, 'utf8');
      if (data.charCodeAt(0) === 0xFEFF) data = data.slice(1);
      const parsed = JSON.parse(data.trim() || '[]');
      return Array.isArray(parsed) ? parsed : [];
    }

    const map = loadUserWatchlists();
    return Array.isArray(map[userId]) ? map[userId] : [];
  } catch (err) {
    console.error('Error reading watchlist:', err);
    return [];
  }
}

/**
 * Save Watchlist for specific user or guest
 */
function saveWatchlist(userIdOrList, listParam) {
  let userId = 'guest';
  let list = [];

  if (Array.isArray(userIdOrList)) {
    list = userIdOrList;
  } else {
    userId = userIdOrList || 'guest';
    list = listParam || [];
  }

  try {
    const unique = Array.from(new Set(list.map(s => String(s).trim().toUpperCase()).filter(Boolean)));

    if (userId === 'guest') {
      fs.writeFileSync(WATCHLIST_FILE, JSON.stringify(unique, null, 2), 'utf8');
    } else {
      const map = loadUserWatchlists();
      map[userId] = unique;
      saveUserWatchlists(map);
    }
    return true;
  } catch (err) {
    console.error('Error saving watchlist:', err);
    return false;
  }
}

function addToWatchlist(userIdOrSymbol, symbolParam) {
  let userId = 'guest';
  let symbol = '';

  if (typeof symbolParam === 'undefined') {
    symbol = userIdOrSymbol;
  } else {
    userId = userIdOrSymbol || 'guest';
    symbol = symbolParam;
  }

  if (!symbol) return getWatchlist(userId);
  const cleanSym = String(symbol).trim().toUpperCase();
  const list = getWatchlist(userId);

  if (!list.includes(cleanSym)) {
    list.push(cleanSym);
    saveWatchlist(userId, list);
  }
  return list;
}

function removeFromWatchlist(userIdOrSymbol, symbolParam) {
  let userId = 'guest';
  let symbol = '';

  if (typeof symbolParam === 'undefined') {
    symbol = userIdOrSymbol;
  } else {
    userId = userIdOrSymbol || 'guest';
    symbol = symbolParam;
  }

  if (!symbol) return getWatchlist(userId);
  const cleanSym = String(symbol).trim().toUpperCase();
  const list = getWatchlist(userId);
  const filtered = list.filter(s => s !== cleanSym);

  saveWatchlist(userId, filtered);
  return filtered;
}

module.exports = {
  getWatchlist,
  saveWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  DEFAULT_WATCHLIST,
};
