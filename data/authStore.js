/* ============================================================
   K-Delta — User Authentication, RBAC & Audit Storage
   Password Hashing via bcrypt, JWT tokens & 2FA Verification
   ============================================================ */

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const USERS_FILE = path.join(__dirname, 'users.json');
const AUDIT_FILE = path.join(__dirname, 'audit.json');

const JWT_SECRET = process.env.JWT_SECRET || 'kdelta_default_jwt_secret_change_me_32bytes';
const JWT_EXPIRES_IN = '24h';

let users = [];
let auditLogs = [];

/**
 * Load users & audit logs from disk
 */
function loadData() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    } else {
      // Seed default admin user for initial installation
      const adminHash = bcrypt.hashSync('Admin@KDelta2026', 10);
      users = [
        {
          userId: 'usr_admin_001',
          email: 'admin@kdelta.com',
          name: 'K-Delta Administrator',
          passwordHash: adminHash,
          role: 'admin',
          twoFactorEnabled: false,
          twoFactorSecret: null,
          createdAt: new Date().toISOString(),
        },
        {
          userId: 'usr_demo_002',
          email: 'trader@kdelta.com',
          name: 'Demo Trader',
          passwordHash: bcrypt.hashSync('TraderPass2026!', 10),
          role: 'user',
          twoFactorEnabled: false,
          twoFactorSecret: null,
          createdAt: new Date().toISOString(),
        }
      ];
      saveUsers();
    }

    if (fs.existsSync(AUDIT_FILE)) {
      auditLogs = JSON.parse(fs.readFileSync(AUDIT_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('[AUTH-STORE] Failed to load auth storage:', err.message);
  }
}

function saveUsers() {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
  } catch (err) {
    console.error('[AUTH-STORE] Failed to save users:', err.message);
  }
}

function recordAudit(eventType, userId, ip, details = {}) {
  const log = {
    id: `audit_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
    timestamp: new Date().toISOString(),
    eventType,
    userId: userId || 'anonymous',
    ip: ip || 'unknown',
    details,
  };
  auditLogs.unshift(log);
  if (auditLogs.length > 500) auditLogs.pop();

  try {
    fs.writeFileSync(AUDIT_FILE, JSON.stringify(auditLogs.slice(0, 200), null, 2), 'utf8');
  } catch (e) {
    // Ignore audit write errors
  }
}

// Initial load
loadData();

module.exports = {
  /**
   * Register new user
   */
  registerUser({ email, password, name }, ip) {
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      throw new Error('Invalid email address');
    }
    if (!password || password.length < 8) {
      throw new Error('Password must be at least 8 characters long');
    }

    const existing = users.find(u => u.email === cleanEmail);
    if (existing) {
      recordAudit('SIGNUP_FAILED_EXISTS', null, ip, { email: cleanEmail });
      throw new Error('Email is already registered');
    }

    const passwordHash = bcrypt.hashSync(password, 10);
    const userId = `usr_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

    const newUser = {
      userId,
      email: cleanEmail,
      name: name ? String(name).trim() : cleanEmail.split('@')[0],
      passwordHash,
      role: 'user',
      twoFactorEnabled: false,
      twoFactorSecret: null,
      createdAt: new Date().toISOString(),
    };

    users.push(newUser);
    saveUsers();

    recordAudit('SIGNUP_SUCCESS', userId, ip, { email: cleanEmail });

    const token = this.generateToken(newUser);
    return { user: this.sanitizeUser(newUser), token };
  },

  /**
   * Authenticate User Login
   */
  loginUser({ email, password }, ip) {
    const cleanEmail = String(email || '').trim().toLowerCase();
    const user = users.find(u => u.email === cleanEmail);

    if (!user) {
      recordAudit('LOGIN_FAILED_NOT_FOUND', null, ip, { email: cleanEmail });
      throw new Error('Invalid email or password');
    }

    const isValid = bcrypt.compareSync(password, user.passwordHash);
    if (!isValid) {
      recordAudit('LOGIN_FAILED_INVALID_PASSWORD', user.userId, ip, { email: cleanEmail });
      throw new Error('Invalid email or password');
    }

    if (user.twoFactorEnabled) {
      recordAudit('LOGIN_2FA_REQUIRED', user.userId, ip);
      return {
        require2FA: true,
        tempToken: jwt.sign({ userId: user.userId, temp2FA: true }, JWT_SECRET, { expiresIn: '5m' }),
      };
    }

    recordAudit('LOGIN_SUCCESS', user.userId, ip, { email: cleanEmail });

    const token = this.generateToken(user);
    return { user: this.sanitizeUser(user), token };
  },

  /**
   * Setup 2FA
   */
  setup2FA(userId) {
    const user = users.find(u => u.userId === userId);
    if (!user) throw new Error('User not found');

    // Generate secret key (represented as a 16-char base32 secret)
    const secret = Math.random().toString(36).substring(2, 10).toUpperCase() + 
                   Math.random().toString(36).substring(2, 10).toUpperCase();

    user.twoFactorSecret = secret;
    saveUsers();

    return { secret, qrText: `otpauth://totp/K-Delta:${user.email}?secret=${secret}&issuer=K-Delta` };
  },

  /**
   * Verify 2FA code (simulated standard TOTP verification or 6-digit pin)
   */
  verify2FA(userId, code, ip) {
    const user = users.find(u => u.userId === userId);
    if (!user) throw new Error('User not found');

    if (!code || String(code).length < 4) {
      throw new Error('Invalid 2FA verification code');
    }

    user.twoFactorEnabled = true;
    saveUsers();

    recordAudit('2FA_VERIFIED', user.userId, ip);
    const token = this.generateToken(user);
    return { user: this.sanitizeUser(user), token };
  },

  /**
   * Generate JWT token
   */
  generateToken(user) {
    return jwt.sign(
      {
        userId: user.userId,
        email: user.email,
        role: user.role || 'user',
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );
  },

  /**
   * Verify JWT Token
   */
  verifyToken(token) {
    try {
      return jwt.verify(token, JWT_SECRET);
    } catch (err) {
      return null;
    }
  },

  /**
   * Find User by Id
   */
  getUserById(userId) {
    const user = users.find(u => u.userId === userId);
    return user ? this.sanitizeUser(user) : null;
  },

  /**
   * Get Audit Logs (Admin only)
   */
  getAuditLogs() {
    return auditLogs.slice(0, 100);
  },

  /**
   * Remove sensitive hash before returning user object
   */
  sanitizeUser(user) {
    const { passwordHash, twoFactorSecret, ...safe } = user;
    return safe;
  }
};
