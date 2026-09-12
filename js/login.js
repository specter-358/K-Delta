/* ============================================================
   K-Delta — Human-crafted Dedicated Login Controller
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
  checkExistingAuth();
});

/**
 * Check if user is already logged in
 */
function checkExistingAuth() {
  const token = localStorage.getItem('kdelta_token');
  if (token) {
    const user = JSON.parse(localStorage.getItem('kdelta_user') || '{}');
    showAuthAlert('success', `Signed in as ${user.name || 'Key'}. Redirecting to terminal...`);
    setTimeout(() => {
      window.location.href = 'index.html';
    }, 1000);
  }
}

/**
 * Handle Login Submission
 */
async function handleLoginSubmit(event) {
  event.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const submitBtn = document.getElementById('login-submit-btn');

  if (!email || !password) {
    return showAuthAlert('error', 'Please enter both email and password.');
  }

  try {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Authenticating...';

    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Authentication failed');
    }

    if (data.require2FA) {
      document.getElementById('2fa-step').style.display = 'block';
      window._temp2FAToken = data.tempToken;
      showAuthAlert('error', '2FA code required. Please enter 6-digit code.');
      return;
    }

    // Save token and user details with default profile name "Key"
    const user = data.user || {};
    user.name = user.name || 'Key';

    localStorage.setItem('kdelta_token', data.token);
    localStorage.setItem('kdelta_user', JSON.stringify(user));

    showAuthAlert('success', `Welcome, ${user.name}! Accessing terminal...`);
    setTimeout(() => {
      window.location.href = 'index.html';
    }, 900);
  } catch (err) {
    showAuthAlert('error', err.message || 'Invalid email or password.');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Access Terminal →';
  }
}

/**
 * Quick Fill Demo Credentials
 */
function fillDemoCredentials(role) {
  if (role === 'admin') {
    document.getElementById('login-email').value = 'admin@kdelta.com';
    document.getElementById('login-password').value = 'Admin@KDelta2026';
  } else {
    document.getElementById('login-email').value = 'trader@kdelta.com';
    document.getElementById('login-password').value = 'TraderPass2026!';
  }
  showAuthAlert('success', 'Demo credentials populated. Click Access Terminal →');
}

/**
 * Helper to display auth alerts
 */
function showAuthAlert(type, message) {
  const alertBox = document.getElementById('auth-alert');
  if (!alertBox) return;

  alertBox.className = `login-alert login-alert--${type}`;
  alertBox.textContent = message;
  alertBox.style.display = 'block';
}

window.handleLoginSubmit = handleLoginSubmit;
window.fillDemoCredentials = fillDemoCredentials;
