/* ============================================================
   K-Delta — Security & Vulnerability Test Suite
   Verifies: Secret protection, OWASP security headers, input
   sanitization, rate limiting enforcement, and RBAC authentication
   ============================================================ */

const assert = require('assert');
const http = require('http');
require('dotenv').config();

const BASE_URL = `http://localhost:${process.env.PORT || 3000}`;

function makeRequest(path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = `${BASE_URL}${path}`;
    const req = http.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) {}
        resolve({ statusCode: res.statusCode, headers: res.headers, body: data, json });
      });
    });
    req.on('error', reject);
    if (options.body) {
      req.write(typeof options.body === 'object' ? JSON.stringify(options.body) : options.body);
    }
    req.end();
  });
}

async function runSecurityTests() {
  console.log('[SECURITY] Starting K-Delta Production Security Test Suite...\n');
  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  ✓ PASSED: ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ FAILED: ${name}`);
      console.error(`    Error: ${err.message}`);
      failed++;
    }
  }

  // 1. OWASP Security Headers Test
  await test('OWASP Security Headers Presence', async () => {
    const res = await makeRequest('/api/market/status');
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.headers['x-frame-options'], 'DENY');
    assert.strictEqual(res.headers['x-content-type-options'], 'nosniff');
    assert(res.headers['content-security-policy'], 'Missing Content-Security-Policy header');
  });

  // 2. Secret Protection Test (No API keys or JWT secret exposed)
  await test('Zero Secret Exposure in Public Responses', async () => {
    const res = await makeRequest('/api/market/status');
    const bodyStr = res.body;

    const secretsToProtect = [
      process.env.JWT_SECRET,
      process.env.SESSION_SECRET,
      process.env.MARKET_DATA_PRIMARY_KEY,
      process.env.MARKET_DATA_BACKUP_KEY,
    ].filter(Boolean);

    for (const secret of secretsToProtect) {
      if (secret.length > 5 && bodyStr.includes(secret)) {
        throw new Error(`CRITICAL: Server response leaked environment secret: ${secret}`);
      }
    }
  });

  // 3. Input Sanitization & Script Injection Protection Test
  await test('Input Sanitization & Injection Defense', async () => {
    const dirtySymbol = "RELIANCE.NS<script>alert(1)</script>' OR 1=1--";
    const res = await makeRequest(`/api/quote?symbol=${encodeURIComponent(dirtySymbol)}`);
    
    // Server should either sanitize symbol cleanly or return 404/400 without executing code or throwing 500 stack trace
    assert(res.statusCode === 400 || res.statusCode === 404, `Unexpected status code: ${res.statusCode}`);
    assert(!res.body.includes('<script>'), 'Response contained un-sanitized script tags!');
    assert(!res.body.includes('SyntaxError'), 'Response leaked internal SQL/syntax trace!');
  });

  // 4. Authentication & RBAC Access Control Test
  await test('RBAC Endpoint Protection (/api/admin/health)', async () => {
    const res = await makeRequest('/api/admin/health');
    assert.strictEqual(res.statusCode, 401, 'Unauthenticated request to admin health endpoint must return 401');
  });

  // 5. Rate Limiting Test on Auth Endpoint
  await test('Auth Endpoint Rate Limiter (Max 10 req/min)', async () => {
    let rateLimited = false;
    for (let i = 0; i < 15; i++) {
      const res = await makeRequest('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: `test_${i}@test.com`, password: 'WrongPassword123!' }),
      });
      if (res.statusCode === 429) {
        rateLimited = true;
        break;
      }
    }
    assert(rateLimited, 'Rate limiter failed to block excessive login requests with 429 status');
  });

  console.log(`\n====================================================`);
  console.log(`Security Test Results: ${passed} Passed, ${failed} Failed`);
  console.log(`====================================================`);

  if (failed > 0) {
    process.exit(1);
  }
}

// Run test if server is up
runSecurityTests().catch((err) => {
  console.error('Security test runner error:', err);
  process.exit(1);
});
