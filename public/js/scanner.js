const token = localStorage.getItem('markme_token');
const user  = JSON.parse(localStorage.getItem('markme_user') || '{}');
if (!token) window.location.href = '/pages/login.html';

let scanner    = null;
let scanning   = false;
let allHistory = [];
const deviceId = btoa(navigator.userAgent + screen.width + screen.height).slice(0, 64);

// ─────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('student-name').textContent = user.name || '';
  checkHTTPS();
  warmUpGPS();
  await loadProfile();
  await loadCourses();
  await loadHistory();
});

// ─────────────────────────────────────────────
// HTTPS CHECK
// ─────────────────────────────────────────────
function checkHTTPS() {
  const isHTTP      = location.protocol === 'http:';
  const isLocalhost = ['localhost', '127.0.0.1'].includes(location.hostname);
  if (isHTTP && !isLocalhost) {
    document.getElementById('https-warning').classList.remove('hidden');
    const startBtn = document.getElementById('start-btn');
    startBtn.disabled    = true;
    startBtn.textContent = 'HTTPS required to scan';
  }
}

// ─────────────────────────────────────────────
// GPS WARM-UP
// ─────────────────────────────────────────────
function warmUpGPS() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(() => {}, () => {}, {
    enableHighAccuracy: true, timeout: 10000, maximumAge: 0
  });
}

// ─────────────────────────────────────────────
// LOCATION BANNER
// ─────────────────────────────────────────────
function showLocBanner(type, msg) {
  const el = document.getElementById('loc-banner');
  el.className   = 'loc-banner ' + type;
  el.textContent = msg;
  el.classList.remove('hidden');
}
function hideLocBanner() {
  document.getElementById('loc-banner').classList.add('hidden');
}

// ─────────────────────────────────────────────
// GET FRESH GPS — called at scan/upload time
// ─────────────────────────────────────────────
function getCurrentLocation() {
  return new Promise(resolve => {
    if (!navigator.geolocation) {
      showLocBanner('warning', 'Location not supported — geo-fence skipped');
      resolve({ lat: null, lng: null });
      return;
    }
    const isHTTP      = location.protocol === 'http:';
    const isLocalhost = ['localhost', '127.0.0.1'].includes(location.hostname);
    if (isHTTP && !isLocalhost) {
      showLocBanner('error', 'GPS blocked on HTTP — open site over HTTPS');
      resolve({ lat: null, lng: null });
      return;
    }
    showLocBanner('info', '📍 Getting your location...');
    navigator.geolocation.getCurrentPosition(
      pos => {
        const acc = Math.round(pos.coords.accuracy);
        showLocBanner(
          acc <= 50 ? 'success' : 'warning',
          acc <= 50
            ? '✓ Location confirmed (±' + acc + 'm)'
            : '⚠️ Low GPS accuracy (±' + acc + 'm)'
        );
        if (acc > 50) document.getElementById('retry-loc-btn').classList.remove('hidden');
        resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      err => {
        const msgs = {
          1: 'Location denied — allow location in browser settings',
          2: 'Location unavailable — check GPS is on',
          3: 'Location timed out — move to open area and retry',
        };
        showLocBanner('error', msgs[err.code] || 'Location error');
        document.getElementById('retry-loc-btn').classList.remove('hidden');
        resolve({ lat: null, lng: null });
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
    );
  });
}

async function retryLocation() {
  document.getElementById('retry-loc-btn').classList.add('hidden');
  const loc = await getCurrentLocation();
  window._lastLocation = loc;
}

// SUBMIT SCAN — shared by camera + upload
async function submitScan(decodedText, method) {
  // Get fresh location (or use retried one)
  let location = window._lastLocation || null;
  window._lastLocation = null;
  if (!location) location = await getCurrentLocation();

  // Block if no location
  if (!location.lat || !location.lng) {
    setStatus('Location required — enable GPS and tap Retry', 'error');
    document.getElementById('retry-loc-btn').classList.remove('hidden');
    scanning = false;
    document.getElementById('start-btn').classList.remove('hidden');
    return;
  }

  setStatus('Verifying attendance...', 'info');

  try {
    const res  = await apiFetch('/api/attendance/scan', {
      method: 'POST',
      body: JSON.stringify({
        token:     decodedText,
        device_id: deviceId,
        lat:       location.lat,
        lng:       location.lng,
      })
    });
    const data = await res.json();

    if (!res.ok) {
      setStatus(data.error || 'Scan failed', 'error');
      scanning = false;
      document.getElementById('start-btn').classList.remove('hidden');
      return;
    }

    // Show success
    document.getElementById('scan-view').classList.add('hidden');
    document.getElementById('success-view').classList.remove('hidden');
    document.getElementById('success-course').textContent = data.course_name;
    document.getElementById('success-time').textContent   = 'Marked at ' + formatTime(data.scanned_at);
    document.getElementById('success-method').textContent =
      method === 'upload' ? '📁 Marked via uploaded QR image' : '📷 Marked via camera scan';

    loadCourses();
    loadHistory();

  } catch {
    setStatus('Could not connect to server', 'error');
    scanning = false;
  }
}

// CAMERA SCANNER
function startScanner() {
  hideLocBanner();
  document.getElementById('retry-loc-btn').classList.add('hidden');
  document.getElementById('start-btn').classList.add('hidden');
  document.getElementById('stop-btn').classList.remove('hidden');
  setStatus('Starting camera...', 'info');

  scanner = new Html5Qrcode('qr-reader');
  scanner.start(
    { facingMode: 'environment' },
    { fps: 10, qrbox: { width: 240, height: 240 } },
    onScanSuccess,
    () => {}
  ).then(() => {
    setStatus('', '');
  }).catch(() => {
    setStatus('Camera access denied. Please allow camera permission.', 'error');
    document.getElementById('start-btn').classList.remove('hidden');
    document.getElementById('stop-btn').classList.add('hidden');
  });
}

function stopScanner() {
  if (scanner) {
    scanner.stop().catch(() => {}).finally(() => { scanner = null; scanning = false; });
  }
  document.getElementById('start-btn').classList.remove('hidden');
  document.getElementById('stop-btn').classList.add('hidden');
  setStatus('', '');
}

async function onScanSuccess(decodedText) {
  if (scanning) return;
  scanning = true;
  stopScanner();
  await submitScan(decodedText, 'camera');
}

// UPLOAD QR IMAGE
function handleUploadDragOver(e) {
  e.preventDefault();
  document.getElementById('upload-zone').classList.add('drag-over');
}
function handleUploadDragLeave() {
  document.getElementById('upload-zone').classList.remove('drag-over');
}
function handleUploadDrop(e) {
  e.preventDefault();
  document.getElementById('upload-zone').classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) processUploadedQR(file);
}
function handleUploadFile(e) {
  const file = e.target.files[0];
  if (file) processUploadedQR(file);
  e.target.value = ''; // reset so same file can be re-selected
}

async function processUploadedQR(file) {
  if (scanning) return;
  scanning = true;

  hideLocBanner();
  document.getElementById('retry-loc-btn').classList.add('hidden');
  document.getElementById('upload-processing').classList.remove('hidden');
  setStatus('Reading QR from image...', 'info');

  try {
    // html5-qrcode can decode from a File object directly
    const html5QrCode = new Html5Qrcode('qr-reader');
    const decodedText = await html5QrCode.scanFile(file, false);
    document.getElementById('upload-processing').classList.add('hidden');

    if (!decodedText) {
      setStatus('No QR code found in this image. Try a clearer photo.', 'error');
      scanning = false;
      return;
    }

    await submitScan(decodedText, 'upload');

  } catch (err) {
    document.getElementById('upload-processing').classList.add('hidden');
    setStatus('Could not read QR from image. Make sure the QR is clear and fully visible.', 'error');
    scanning = false;
  }
}

// ─────────────────────────────────────────────
// SCAN AGAIN
// ─────────────────────────────────────────────
function scanAgain() {
  scanning = false;
  window._lastLocation = null;
  document.getElementById('success-view').classList.add('hidden');
  document.getElementById('scan-view').classList.remove('hidden');
  hideLocBanner();
  document.getElementById('retry-loc-btn').classList.add('hidden');
  document.getElementById('upload-processing').classList.add('hidden');
  setStatus('', '');
}

// ─────────────────────────────────────────────
// TAB SWITCHING
// ─────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  document.getElementById('tab-' + name).classList.add('active');
  if (name !== 'scan' && scanner) stopScanner();
  if (name === 'history') renderHistory(allHistory);
  if (name === 'scan') {
    hideLocBanner();
    document.getElementById('retry-loc-btn').classList.add('hidden');
  }
}

// ─────────────────────────────────────────────
// PROFILE
// ─────────────────────────────────────────────
async function loadProfile() {
  const res  = await apiFetch('/api/auth/me');
  const data = await res.json();
  if (!res.ok) return;
  document.getElementById('student-name').textContent = data.name || '';
  document.getElementById('home-name').textContent    = data.name ? data.name.split(' ')[0] : 'Student';
  document.getElementById('home-branch').textContent  = data.branch  || 'Branch —';
  document.getElementById('home-year').textContent    = data.year    ? 'Year ' + data.year : 'Year —';
  document.getElementById('home-section').textContent = data.section ? 'Sec ' + data.section : 'Sec —';
  const initial = (data.name || 'S').charAt(0).toUpperCase();
  document.getElementById('profile-avatar').textContent = initial;
  document.getElementById('profile-name').textContent   = data.name || '—';
  document.getElementById('profile-roll').textContent   = data.roll_no ? 'Roll no: ' + data.roll_no : '';
  document.getElementById('profile-info').innerHTML = `
    <div class="info-row"><span class="info-label">Email</span><span class="info-value">${data.email||'—'}</span></div>
    <div class="info-row"><span class="info-label">Branch</span><span class="info-value">${data.branch||'—'}</span></div>
    <div class="info-row"><span class="info-label">Year</span><span class="info-value">${data.year||'—'}</span></div>
    <div class="info-row"><span class="info-label">Section</span><span class="info-value">${data.section||'—'}</span></div>
  `;
}

// ─────────────────────────────────────────────
// COURSES + STATS
// ─────────────────────────────────────────────
async function loadCourses() {
  const res  = await apiFetch('/api/attendance/history');
  const data = await res.json();
  if (!res.ok || !data.length) {
    const empty = '<div class="empty-state"><div class="empty-icon">📚</div>No courses enrolled yet</div>';
    document.getElementById('home-courses').innerHTML    = empty;
    document.getElementById('profile-courses').innerHTML = empty;
    return;
  }
  const totalAttended = data.reduce((s, r) => s + parseInt(r.attended || 0), 0);
  const avgPct = Math.round(data.reduce((s, r) => s + parseFloat(r.percentage || 0), 0) / data.length);
  document.getElementById('home-total-classes').textContent = totalAttended;
  document.getElementById('home-avg-pct').textContent       = avgPct + '%';
  const html = data.map(r => {
    const pct    = parseFloat(r.percentage) || 0;
    const cls    = pct >= 75 ? 'pct-safe' : pct >= 60 ? 'pct-warn' : 'pct-danger';
    const barClr = pct >= 75 ? '#1D9E75' : pct >= 60 ? '#D97706' : '#E24B4A';
    return `
      <div class="course-card">
        <div class="course-top">
          <div><div class="course-name">${r.course_name}</div><div class="course-code">${r.course_code}</div></div>
          <span class="pct-badge ${cls}">${pct}%</span>
        </div>
        <div class="bar-bg"><div class="bar-fill" style="width:${pct}%;background:${barClr}"></div></div>
        <div class="course-detail">${r.attended} of ${r.total_sessions} classes attended</div>
      </div>`;
  }).join('');
  document.getElementById('home-courses').innerHTML    = html;
  document.getElementById('profile-courses').innerHTML = html;
}

// ─────────────────────────────────────────────
// HISTORY
// ─────────────────────────────────────────────
async function loadHistory() {
  const res  = await apiFetch('/api/attendance/detailed-history');
  const data = await res.json();
  allHistory = res.ok ? data : [];
  renderHistory(allHistory);
}
function renderHistory(data) {
  const list = document.getElementById('history-list');
  if (!data.length) {
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div>No attendance records yet</div>';
    return;
  }
  list.innerHTML = data.map(r => `
    <div class="attendance-item">
      <div class="att-top">
        <span class="att-course">${r.course_name}</span>
        <span class="att-status ${r.status === 'present' ? 'att-present' : 'att-absent'}">
          ${r.status === 'present' ? '✓ Present' : '✗ Absent'}
        </span>
      </div>
      <div class="att-date">${formatDate(r.scanned_at)} · ${r.course_code}</div>
    </div>`).join('');
}
function filterHistory(type, btn) {
  document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  renderHistory(type === 'all' ? allHistory : allHistory.filter(r => r.status === type));
}

// ─────────────────────────────────────────────
// CHANGE PASSWORD
// ─────────────────────────────────────────────
async function changePassword() {
  const current = document.getElementById('pwd-current').value;
  const newPwd  = document.getElementById('pwd-new').value;
  const confirm = document.getElementById('pwd-confirm').value;
  const btn     = document.getElementById('pwd-btn');
  document.getElementById('pwd-msg').style.display = 'none';
  if (!current || !newPwd || !confirm) { showPwdMsg('error', 'Please fill in all fields'); return; }
  if (newPwd.length < 8) { showPwdMsg('error', 'New password must be at least 8 characters'); return; }
  if (newPwd !== confirm) { showPwdMsg('error', 'New passwords do not match'); return; }
  if (current === newPwd) { showPwdMsg('error', 'New password must be different'); return; }
  btn.textContent = 'Updating...';
  btn.disabled    = true;
  try {
    const res  = await apiFetch('/api/auth/student/change-password', {
      method: 'POST', body: JSON.stringify({ current_password: current, new_password: newPwd })
    });
    const data = await res.json();
    if (!res.ok) { showPwdMsg('error', data.error || 'Failed to update password'); return; }
    showPwdMsg('success', '✓ Password updated successfully');
    document.getElementById('pwd-current').value = '';
    document.getElementById('pwd-new').value     = '';
    document.getElementById('pwd-confirm').value = '';
  } catch { showPwdMsg('error', 'Could not connect to server'); }
  finally { btn.textContent = 'Update password'; btn.disabled = false; }
}
function showPwdMsg(type, text) {
  const el = document.getElementById('pwd-msg');
  el.style.cssText = type === 'error'
    ? 'display:block;padding:10px 14px;border-radius:8px;font-size:13px;margin-bottom:12px;background:#FCEBEB;color:#791F1F;border:1px solid #f09595'
    : 'display:block;padding:10px 14px;border-radius:8px;font-size:13px;margin-bottom:12px;background:#E1F5EE;color:#085041;border:1px solid #5DCAA5';
  el.textContent = text;
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
function apiFetch(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token, ...(options.headers || {}) }
  });
}
function setStatus(msg, type) {
  const el = document.getElementById('scan-status');
  el.textContent = msg;
  el.className   = 'scan-status' + (type ? ' ' + type : '');
}
function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function formatTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}
function logout() {
  localStorage.removeItem('markme_token');
  localStorage.removeItem('markme_user');
  window.location.href = '/pages/login.html';
}