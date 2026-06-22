const token = localStorage.getItem('markme_token');
const user  = JSON.parse(localStorage.getItem('markme_user') || '{}');
if (!token) window.location.href = '/pages/login.html';

let scanner       = null;
let scanning      = false;
let allHistory    = [];
let locationReady = false;
let confirmedLat  = null;
let confirmedLng  = null;

const deviceId = btoa(navigator.userAgent + screen.width + screen.height).slice(0, 64);

// ─────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('student-name').textContent = user.name || '';

  await loadProfile();
  await loadCourses();
  await loadHistory();

  checkAndRequestLocation();
});

// ─────────────────────────────────────────────
// HTTPS CHECK
// ─────────────────────────────────────────────
function isHTTPSBlocked() {
  const isHTTP = location.protocol === 'http:';
  const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
  return isHTTP && !isLocal;
}

// ─────────────────────────────────────────────
// LOCATION GATE SYSTEM
// ─────────────────────────────────────────────
function checkAndRequestLocation() {
  locationReady = false;
  confirmedLat = null;
  confirmedLng = null;

  showGateState('requesting');

  if (isHTTPSBlocked()) {
    showGateState('denied', {
      title: 'HTTPS required',
      msg: 'Use HTTPS (or ngrok) for GPS access.',
      showRetry: false
    });
    return;
  }

  if (!navigator.geolocation) {
    showGateState('denied', {
      title: 'GPS not supported',
      msg: 'Your device does not support location.',
      showRetry: false
    });
    return;
  }

  navigator.geolocation.getCurrentPosition(
    pos => {
      confirmedLat = pos.coords.latitude;
      confirmedLng = pos.coords.longitude;
      locationReady = true;

      const acc = Math.round(pos.coords.accuracy);

      document.getElementById('loc-banner').classList.remove('hidden');
      document.getElementById('loc-banner').textContent =
        acc <= 50
          ? `✓ GPS ready (±${acc}m)`
          : `⚠ Low accuracy (±${acc}m)`;

      showGateState('unlocked');
    },
    err => {
      const msg =
        err.code === 1 ? 'Permission denied' :
        err.code === 2 ? 'Location unavailable' :
        'Location timeout';

      showGateState('denied', {
        title: 'GPS Error',
        msg,
        showRetry: true
      });
    },
    { enableHighAccuracy: true, timeout: 12000 }
  );
}

function showGateState(state, opts = {}) {
  const gate = document.getElementById('loc-gate');
  const scan = document.getElementById('scan-view');

  if (state === 'requesting') {
    gate.classList.remove('hidden');
    scan.classList.add('hidden');
  }

  if (state === 'denied') {
    gate.classList.remove('hidden');
    scan.classList.add('hidden');

    document.getElementById('gate-title').textContent = opts.title;
    document.getElementById('gate-msg').textContent = opts.msg;

    document.getElementById('gate-retry')
      .classList.toggle('hidden', !opts.showRetry);
  }

  if (state === 'unlocked') {
    gate.classList.add('hidden');
    scan.classList.remove('hidden');
  }
}

function retryLocation() {
  checkAndRequestLocation();
}

// ─────────────────────────────────────────────
// SCAN SUBMIT
// ─────────────────────────────────────────────
async function submitScan(decodedText, method) {
  if (!locationReady) {
    setStatus('Enable GPS first', 'error');
    return;
  }

  setStatus('Verifying...', 'info');

  try {
    const res = await apiFetch('/api/attendance/scan', {
      method: 'POST',
      body: JSON.stringify({
        token: decodedText,
        device_id: deviceId,
        lat: confirmedLat,
        lng: confirmedLng
      })
    });

    const data = await res.json();

    if (!res.ok) {
      setStatus(data.error || 'Failed', 'error');
      return;
    }

    document.getElementById('scan-view').classList.add('hidden');
    document.getElementById('success-view').classList.remove('hidden');

    document.getElementById('success-course').textContent = data.course_name;
    document.getElementById('success-time').textContent =
      'Marked at ' + new Date(data.scanned_at).toLocaleTimeString();

    document.getElementById('success-method').textContent =
      method === 'upload' ? 'QR Upload' : 'Camera Scan';

    loadCourses();
    loadHistory();

  } catch {
    setStatus('Server error', 'error');
  }
}

// ─────────────────────────────────────────────
// CAMERA
// ─────────────────────────────────────────────
function startScanner() {
  if (!locationReady) return checkAndRequestLocation();

  scanner = new Html5Qrcode('qr-reader');

  scanner.start(
    { facingMode: 'environment' },
    { fps: 10, qrbox: 250 },
    async (text) => {
      if (scanning) return;
      scanning = true;
      await submitScan(text, 'camera');
      stopScanner();
    }
  );
}

function stopScanner() {
  if (scanner) scanner.stop().catch(() => {});
  scanner = null;
  scanning = false;
}

// ─────────────────────────────────────────────
// QR IMAGE UPLOAD
// ─────────────────────────────────────────────
async function processUploadedQR(file) {
  if (!locationReady) return;

  const reader = new Html5Qrcode('qr-reader');

  try {
    const text = await reader.scanFile(file, true);
    await submitScan(text, 'upload');
  } catch {
    setStatus('Invalid QR image', 'error');
  }
}

// ─────────────────────────────────────────────
// UI HELPERS
// ─────────────────────────────────────────────
function setStatus(msg, type) {
  const el = document.getElementById('scan-status');
  el.textContent = msg;
  el.className = 'scan-status ' + type;
}

function apiFetch(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token
    }
  });
}

function logout() {
  localStorage.clear();
  window.location.href = '/pages/login.html';
}