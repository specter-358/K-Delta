/* ============================================================
   K-Delta — Isolated User Watchlist Storage Module
   Supports user data isolation per userId & backward compatibility
   ============================================================ */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname);
const WATCHLIST_FILE = path.join(DATA_DIR, 'watchlist.json');
const USER_WATCHLISTS_FILE = path.join(DATA_DIR, 'user_watchlists.json');

const DEFAULT_WATCHLIST = [
  'TATASTEEL.NS',
  'TATAMOTORS.NS',
  'IFCI.NS',
  'ITC.NS',
  'RVNL.NS',
  'HINDCOPPER.NS',
];

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

let cachedUserWatchlists = null;
let cachedGuestWatchlist = null;

function loadUserWatchlists() {
  if (cachedUserWatchlists !== null) return cachedUserWatchlists;
  try {
    if (fs.existsSync(USER_WATCHLISTS_FILE)) {
      cachedUserWatchlists = JSON.parse(fs.readFileSync(USER_WATCHLISTS_FILE, 'utf8'));
      return cachedUserWatchlists;
    }
  } catch (err) {
    console.error('Error loading user watchlists:', err);
  }
  cachedUserWatchlists = {};
  return cachedUserWatchlists;
}

function saveUserWatchlists(map) {
  cachedUserWatchlists = map;
  fs.promises.writeFile(USER_WATCHLISTS_FILE, JSON.stringify(map, null, 2), 'utf8')
    .catch(err => console.error('Error saving user watchlists asynchronously:', err));
  return true;
}

/**
 * Get Watchlist for specific user or guest default
 */
function getWatchlist(userId = 'guest') {
  try {
    if (!userId || userId === 'guest') {
      if (cachedGuestWatchlist !== null) return [...cachedGuestWatchlist];
      if (!fs.existsSync(WATCHLIST_FILE)) {
        cachedGuestWatchlist = [...DEFAULT_WATCHLIST];
        return cachedGuestWatchlist;
      }
      let data = fs.readFileSync(WATCHLIST_FILE, 'utf8');
      if (data.charCodeAt(0) === 0xFEFF) data = data.slice(1);
      const parsed = JSON.parse(data.trim() || '[]');
      cachedGuestWatchlist = Array.isArray(parsed) && parsed.length > 0 ? parsed : [...DEFAULT_WATCHLIST];
      return [...cachedGuestWatchlist];
    }

    const map = loadUserWatchlists();
    if (!Object.prototype.hasOwnProperty.call(map, userId)) {
      // First time user login: initialize watchlist with guest/default list
      const fallbackList = getWatchlist('guest');
      map[userId] = fallbackList && fallbackList.length > 0 ? [...fallbackList] : [...DEFAULT_WATCHLIST];
      saveUserWatchlists(map);
    }
    return Array.isArray(map[userId]) ? [...map[userId]] : [...DEFAULT_WATCHLIST];
  } catch (err) {
    console.error('Error reading watchlist:', err);
    return [...DEFAULT_WATCHLIST];
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
      cachedGuestWatchlist = unique;
      fs.promises.writeFile(WATCHLIST_FILE, JSON.stringify(unique, null, 2), 'utf8')
        .catch(err => console.error('Error saving guest watchlist asynchronously:', err));
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
