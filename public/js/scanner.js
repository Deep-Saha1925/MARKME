// public/js/scanner.js

const token = localStorage.getItem('markme_token');
const user  = JSON.parse(localStorage.getItem('markme_user') || '{}');
if (!token) window.location.href = '/pages/login.html';

let scanner  = null;
let scanning = false;
let userLat  = null;
let userLng  = null;
let allHistory = [];
const deviceId = btoa(navigator.userAgent + screen.width + screen.height).slice(0, 64);

// ─────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('student-name').textContent = user.name || '';
  getLocation();
  await loadProfile();
  await loadCourses();
  await loadHistory();
});

// ─────────────────────────────────────────────
// TAB SWITCHING
// ─────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  document.getElementById('tab-' + name).classList.add('active');

  // Stop scanner when leaving scan tab
  if (name !== 'scan' && scanner) stopScanner();
  if (name === 'history') renderHistory(allHistory);
}

// ─────────────────────────────────────────────
// LOAD PROFILE
// ─────────────────────────────────────────────
async function loadProfile() {
  const res  = await apiFetch('/api/auth/me');
  const data = await res.json();
  if (!res.ok) return;

  // Navbar
  document.getElementById('student-name').textContent = data.name || '';

  // Home banner
  document.getElementById('home-name').textContent    = data.name ? data.name.split(' ')[0] : 'Student';
  document.getElementById('home-branch').textContent  = data.branch  || 'Branch —';
  document.getElementById('home-year').textContent    = data.year    ? 'Year ' + data.year : 'Year —';
  document.getElementById('home-section').textContent = data.section ? 'Sec ' + data.section : 'Sec —';

  // Profile page
  const initial = (data.name || 'S').charAt(0).toUpperCase();
  document.getElementById('profile-avatar').textContent = initial;
  document.getElementById('profile-name').textContent   = data.name  || '—';
  document.getElementById('profile-roll').textContent   = data.roll_no ? 'Roll no: ' + data.roll_no : '';
  document.getElementById('profile-info').innerHTML = `
    <div class="info-row"><span class="info-label">Email</span><span class="info-value">${data.email||'—'}</span></div>
    <div class="info-row"><span class="info-label">Branch</span><span class="info-value">${data.branch||'—'}</span></div>
    <div class="info-row"><span class="info-label">Year</span><span class="info-value">${data.year||'—'}</span></div>
    <div class="info-row"><span class="info-label">Section</span><span class="info-value">${data.section||'—'}</span></div>
  `;
}

// ─────────────────────────────────────────────
// LOAD COURSES + STATS
// ─────────────────────────────────────────────
async function loadCourses() {
  const res  = await apiFetch('/api/attendance/history');
  const data = await res.json();
  if (!res.ok || !data.length) {
    document.getElementById('home-courses').innerHTML =
      '<div class="empty-state"><div class="empty-icon">📚</div>No courses enrolled yet</div>';
    document.getElementById('profile-courses').innerHTML =
      '<div class="empty-state"><div class="empty-icon">📚</div>No courses yet</div>';
    return;
  }

  // Stats
  const totalAttended = data.reduce((s, r) => s + parseInt(r.attended || 0), 0);
  const avgPct = data.length
    ? Math.round(data.reduce((s, r) => s + parseFloat(r.percentage || 0), 0) / data.length)
    : 0;
  document.getElementById('home-total-classes').textContent = totalAttended;
  document.getElementById('home-avg-pct').textContent       = avgPct + '%';

  const courseHTML = data.map(r => {
    const pct    = parseFloat(r.percentage) || 0;
    const cls    = pct >= 75 ? 'pct-safe' : pct >= 60 ? 'pct-warn' : 'pct-danger';
    const barClr = pct >= 75 ? '#1D9E75' : pct >= 60 ? '#D97706' : '#E24B4A';
    return `
      <div class="course-card">
        <div class="course-top">
          <div>
            <div class="course-name">${r.course_name}</div>
            <div class="course-code">${r.course_code}</div>
          </div>
          <span class="pct-badge ${cls}">${pct}%</span>
        </div>
        <div class="bar-bg">
          <div class="bar-fill" style="width:${pct}%;background:${barClr}"></div>
        </div>
        <div class="course-detail">${r.attended} of ${r.total_sessions} classes attended</div>
      </div>`;
  }).join('');

  document.getElementById('home-courses').innerHTML     = courseHTML;
  document.getElementById('profile-courses').innerHTML  = courseHTML;
}

// ─────────────────────────────────────────────
// LOAD HISTORY
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
  const filtered = type === 'all' ? allHistory
    : allHistory.filter(r => r.status === type);
  renderHistory(filtered);
}

// ─────────────────────────────────────────────
// QR SCANNER
// ─────────────────────────────────────────────
function getLocation() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    pos => { userLat = pos.coords.latitude; userLng = pos.coords.longitude; },
    () => {}
  );
}

function startScanner() {
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
  setStatus('Verifying attendance...', 'info');

  try {
    const res  = await apiFetch('/api/attendance/scan', {
      method: 'POST',
      body: JSON.stringify({ token: decodedText, device_id: deviceId, lat: userLat, lng: userLng })
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

    // Refresh data in background
    loadCourses();
    loadHistory();

  } catch {
    setStatus('Could not connect to server', 'error');
    scanning = false;
  }
}

function scanAgain() {
  scanning = false;
  document.getElementById('success-view').classList.add('hidden');
  document.getElementById('scan-view').classList.remove('hidden');
  setStatus('', '');
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