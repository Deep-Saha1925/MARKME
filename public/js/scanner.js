const token   = localStorage.getItem('markme_token');
const user    = JSON.parse(localStorage.getItem('markme_user') || '{}');

if (!token) window.location.href = '/pages/login.html';

document.getElementById('student-name').textContent = user.name || '';

let scanner   = null;
let scanning  = false;
let userLat   = null;
let userLng   = null;

// Get device fingerprint (simple version)
const deviceId = navigator.userAgent + screen.width + screen.height;

window.addEventListener('DOMContentLoaded', () => {
  getLocation();
  loadHistory();
});

// ── Get student location ──────────────────────
function getLocation() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      userLat = pos.coords.latitude;
      userLng = pos.coords.longitude;
    },
    () => {} // silently skip if denied
  );
}

// ── Start QR scanner ──────────────────────────
function startScanner() {
  document.getElementById('start-btn').classList.add('hidden');
  document.getElementById('stop-btn').classList.remove('hidden');
  setStatus('Initialising camera...', 'info');

  scanner = new Html5Qrcode('qr-reader');

  scanner.start(
    { facingMode: 'environment' },           // rear camera
    { fps: 10, qrbox: { width: 240, height: 240 } },
    onScanSuccess,
    () => {}                                 // ignore per-frame errors
  ).catch((err) => {
    setStatus('Camera access denied. Please allow camera permission.', 'error');
    document.getElementById('start-btn').classList.remove('hidden');
    document.getElementById('stop-btn').classList.add('hidden');
  });
}

// ── Stop scanner ──────────────────────────────
function stopScanner() {
  if (scanner && scanning) {
    scanner.stop().then(() => {
      scanner = null;
      scanning = false;
    });
  }
  document.getElementById('start-btn').classList.remove('hidden');
  document.getElementById('stop-btn').classList.add('hidden');
  setStatus('', '');
}

// ── On QR detected ────────────────────────────
async function onScanSuccess(decodedText) {
  if (scanning) return; // prevent duplicate scans
  scanning = true;

  stopScanner();
  setStatus('Verifying...', 'info');

  try {
    const res = await fetch('/api/attendance/scan', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        token:     decodedText,
        device_id: btoa(deviceId).slice(0, 64), // hashed device fingerprint
        lat:       userLat,
        lng:       userLng,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      setStatus(data.error || 'Scan failed', 'error');
      scanning = false;
      document.getElementById('start-btn').classList.remove('hidden');
      return;
    }

    // Show success screen
    document.getElementById('scanner-card').classList.add('hidden');
    document.getElementById('success-card').classList.remove('hidden');
    document.getElementById('success-course').textContent = data.course_name;
    document.getElementById('success-time').textContent =
      'Scanned at ' + new Date(data.scanned_at).toLocaleTimeString();

    loadHistory(); // refresh history

  } catch (err) {
    setStatus('Could not connect to server', 'error');
    scanning = false;
  }
}

// ── Scan again ────────────────────────────────
function scanAgain() {
  scanning = false;
  document.getElementById('success-card').classList.add('hidden');
  document.getElementById('scanner-card').classList.remove('hidden');
  setStatus('', '');
}

// ── Load attendance history ───────────────────
async function loadHistory() {
  const res  = await fetch('/api/attendance/history', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const data = await res.json();
  const list = document.getElementById('history-list');

  if (!data.length) {
    list.innerHTML = '<p class="text-muted">No attendance records yet.</p>';
    return;
  }

  list.innerHTML = data.map(r => {
    const pct   = parseFloat(r.percentage) || 0;
    const color = pct >= 75 ? '#0F6E56' : pct >= 60 ? '#854F0B' : '#A32D2D';
    const bg    = pct >= 75 ? '#E1F5EE' : pct >= 60 ? '#FAEEDA' : '#FCEBEB';
    return `
      <div class="history-row">
        <div>
          <div class="history-course">${r.course_name}</div>
          <div class="history-detail">${r.attended} / ${r.total_sessions} classes</div>
          <div class="progress-bar-bg">
            <div class="progress-bar-fill" style="width:${pct}%;background:${color}"></div>
          </div>
        </div>
        <span class="pct-badge" style="background:${bg};color:${color}">${pct}%</span>
      </div>
    `;
  }).join('');
}

// ── Helpers ───────────────────────────────────
function setStatus(msg, type) {
  const el = document.getElementById('scan-status');
  el.textContent  = msg;
  el.className    = `scan-status ${type}`;
}

function logout() {
  localStorage.removeItem('markme_token');
  localStorage.removeItem('markme_user');
  window.location.href = '/pages/login.html';
}