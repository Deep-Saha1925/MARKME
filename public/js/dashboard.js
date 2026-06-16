// public/js/dashboard.js

const token = localStorage.getItem('markme_token');
const user  = JSON.parse(localStorage.getItem('markme_user') || '{}');
if (!token) window.location.href = '/pages/login.html';

document.getElementById('teacher-name').textContent = user.name || '';

let currentSessionId   = null;
let attendanceInterval = null;
let timerInterval      = null;
let userLat            = null;
let userLng            = null;
let sessionClosed      = false;

// ─────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  loadCourses();
  getLocation();
});

// ─────────────────────────────────────────────
// LOAD COURSES
// ─────────────────────────────────────────────
async function loadCourses() {
  const res  = await apiFetch('/api/sessions/my-courses');
  const data = await res.json();
  const sel  = document.getElementById('course-select');

  if (!res.ok || !data.length) {
    sel.innerHTML = '<option value="">No courses assigned yet — ask admin</option>';
    return;
  }
  sel.innerHTML = data.map(c =>
    `<option value="${c.id}">${c.name} (${c.code})</option>`
  ).join('');
}

// ─────────────────────────────────────────────
// LOCATION
// Gets teacher's GPS to set as geo-fence centre.
// Shows a clear banner with status.
// ─────────────────────────────────────────────
function getLocation() {
  const banner = document.getElementById('geo-banner');

  if (!navigator.geolocation) {
    setBanner('geo-warn', '⚠️ Location not supported — geo-fence will be skipped');
    return;
  }

  // Check HTTPS — geolocation is blocked on HTTP outside localhost
  const isHTTP      = location.protocol === 'http:';
  const isLocalhost = ['localhost', '127.0.0.1'].includes(location.hostname);
  if (isHTTP && !isLocalhost) {
    setBanner('geo-warn', '⚠️ GPS blocked on HTTP — use ngrok HTTPS for geo-fence. Continuing without location.');
    return;
  }

  setBanner('geo-loading', '📍 Getting your location...');

  navigator.geolocation.getCurrentPosition(
    pos => {
      userLat = pos.coords.latitude;
      userLng = pos.coords.longitude;
      const acc = Math.round(pos.coords.accuracy);
      setBanner('geo-ok', `✓ Location captured (±${acc}m) — geo-fence will be active`);
    },
    err => {
      const msgs = {
        1: '⚠️ Location denied — geo-fence will be skipped. Allow location in browser settings.',
        2: '⚠️ Location unavailable — geo-fence will be skipped.',
        3: '⚠️ Location timed out — geo-fence will be skipped.',
      };
      setBanner('geo-warn', msgs[err.code] || '⚠️ Location error — geo-fence will be skipped');
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

function setBanner(type, msg) {
  const banner = document.getElementById('geo-banner');
  banner.className = 'geo-banner ' + type;
  banner.textContent = msg;
}

// ─────────────────────────────────────────────
// GENERATE QR
// ─────────────────────────────────────────────
async function generateQR() {
  const courseId    = document.getElementById('course-select').value;
  const expiry      = document.getElementById('expiry').value;
  const fenceRadius = document.getElementById('fence-radius').value;
  const btn         = document.getElementById('generate-btn');

  if (!courseId) {
    alert('Please select a course');
    return;
  }

  btn.textContent = 'Generating...';
  btn.disabled    = true;

  const res = await apiFetch('/api/sessions/generate', {
    method: 'POST',
    body: JSON.stringify({
      course_id:      parseInt(courseId),
      lat:            userLat,
      lng:            userLng,
      fence_radius_m: parseInt(fenceRadius),
      expiry_minutes: parseInt(expiry),
    })
  });

  const data = await res.json();
  btn.textContent = 'Generate QR code';
  btn.disabled    = false;

  if (!res.ok) {
    alert(data.error || 'Failed to generate QR');
    return;
  }

  // Populate session info
  currentSessionId = data.session_id;
  sessionClosed    = false;

  const sel        = document.getElementById('course-select');
  const courseName = sel.options[sel.selectedIndex].text;

  document.getElementById('qr-course-name').textContent = courseName;
  document.getElementById('qr-date').textContent        = new Date().toLocaleDateString('en-IN', { weekday:'short', day:'numeric', month:'short' });
  document.getElementById('qr-geo-info').textContent    = userLat
    ? `Active · ${fenceRadius}m radius`
    : 'Not active (no location)';
  document.getElementById('qr-image').src               = data.qr_image;

  // Show QR card, hide generate card
  document.getElementById('generate-card').classList.add('hidden');
  document.getElementById('qr-card').classList.remove('hidden');
  document.getElementById('closed-banner').classList.add('hidden');

  startTimer(data.expiry_mins * 60);
  startPolling();
}

// ─────────────────────────────────────────────
// TIMER
// ─────────────────────────────────────────────
function startTimer(seconds) {
  const timerText = document.getElementById('timer-text');
  const timerBox  = document.getElementById('timer-box');
  let remaining   = seconds;

  clearInterval(timerInterval);

  timerInterval = setInterval(() => {
    if (remaining <= 0) {
      clearInterval(timerInterval);
      timerText.textContent  = 'QR expired';
      timerBox.className     = 'timer-box timer-expired';
      return;
    }

    const m = String(Math.floor(remaining / 60)).padStart(2, '0');
    const s = String(remaining % 60).padStart(2, '0');
    timerText.textContent = `Expires in ${m}:${s}`;
    timerBox.className    = remaining <= 60 ? 'timer-box timer-urgent' : 'timer-box timer-active';
    remaining--;
  }, 1000);
}

// ─────────────────────────────────────────────
// LIVE ATTENDANCE POLLING
// ─────────────────────────────────────────────
function startPolling() {
  clearInterval(attendanceInterval);
  fetchAttendance();
  attendanceInterval = setInterval(fetchAttendance, 3000);
}

async function fetchAttendance() {
  if (!currentSessionId) return;
  const res  = await apiFetch(`/api/sessions/${currentSessionId}/attendance`);
  if (!res.ok) return;
  const data = await res.json();

  document.getElementById('present-count').textContent = `${data.length} present`;

  const list = document.getElementById('attendance-list');
  if (!data.length) {
    list.innerHTML = '<p style="color:#73726c;font-size:14px">Waiting for scans...</p>';
    return;
  }

  list.innerHTML = data.map(r => `
    <div class="attendance-row">
      <div>
        <span class="roll-no">${r.roll_no}</span>
        <span class="student-name">${r.student_name}</span>
      </div>
      <span class="scan-time">${formatTime(r.scanned_at)}</span>
    </div>`).join('');
}

// ─────────────────────────────────────────────
// CLOSE SESSION
// ─────────────────────────────────────────────
async function closeSession() {
  if (!confirm('Close this session? Students will no longer be able to scan.')) return;

  await apiFetch(`/api/sessions/${currentSessionId}/close`, { method: 'PATCH' });

  clearInterval(attendanceInterval);
  clearInterval(timerInterval);
  sessionClosed = true;

  const timerText = document.getElementById('timer-text');
  const timerBox  = document.getElementById('timer-box');
  timerText.textContent = 'Session closed';
  timerBox.className    = 'timer-box timer-expired';

  document.getElementById('closed-banner').classList.remove('hidden');

  // Hide close button
  document.querySelector('.btn-danger').classList.add('hidden');
}

// ─────────────────────────────────────────────
// BACK TO HOME
// Resets the view to the generate form.
// Warns if a session is still active.
// ─────────────────────────────────────────────
function backToHome() {
  if (currentSessionId && !sessionClosed) {
    const confirm_ = confirm(
      'An active session is still running.\n\nStudents can still scan until it expires.\n\nGo back to home anyway?'
    );
    if (!confirm_) return;
  }

  // Stop polling + timer
  clearInterval(attendanceInterval);
  clearInterval(timerInterval);
  currentSessionId = null;
  sessionClosed    = false;

  // Reset QR card
  document.getElementById('qr-image').src = '';
  document.getElementById('timer-text').textContent = '--:--';
  document.getElementById('timer-box').className    = 'timer-box timer-active';
  document.getElementById('attendance-list').innerHTML = '<p style="color:#73726c;font-size:14px">Waiting for scans...</p>';
  document.getElementById('present-count').textContent = '0 present';
  document.getElementById('closed-banner').classList.add('hidden');
  document.querySelector('.btn-danger') && document.querySelector('.btn-danger').classList.remove('hidden');

  // Show generate card
  document.getElementById('qr-card').classList.add('hidden');
  document.getElementById('generate-card').classList.remove('hidden');

  // Re-fetch location in case it changed
  getLocation();
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
function apiFetch(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${token}`,
      ...(options.headers || {}),
    }
  });
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

// ── Download QR as PNG ────────────────────────
function downloadQR() {
  const img    = document.getElementById('qr-image');
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 300;
  const ctx   = canvas.getContext('2d');
  const image = new Image();
  image.onload = () => {
    ctx.drawImage(image, 0, 0, 300, 300);
    const link    = document.createElement('a');
    const course  = document.getElementById('qr-course-name').textContent;
    link.download = `MarkMe-QR-${course}-${new Date().toLocaleDateString('en-IN').replace(/\//g,'-')}.png`;
    link.href     = canvas.toDataURL('image/png');
    link.click();
  };
  image.src = img.src;
}

// ── Share QR link ─────────────────────────────
function shareLink() {
  const url    = `${location.origin}/pages/qr-share.html?session=${currentSessionId}`;
  const course = document.getElementById('qr-course-name').textContent;
  const btn    = document.getElementById('share-btn');

  if (navigator.share) {
    navigator.share({
      title: 'MarkMe — Scan attendance for ' + course,
      text:  'Scan QR to mark your attendance',
      url,
    }).catch(() => copyLink(url, btn));
  } else {
    copyLink(url, btn);
  }
}

function copyLink(url, btn) {
  navigator.clipboard.writeText(url).then(() => {
    const original    = btn.textContent;
    btn.textContent   = '✓ Copied!';
    setTimeout(() => btn.textContent = original, 2000);
  });
}

// EXPORT CSV
async function exportCSV() {
  if (!currentSessionId) return alert('No active session');

  const res  = await apiFetch(`/api/sessions/${currentSessionId}/attendance`);
  if (!res.ok) return alert('Could not load attendance');
  const data = await res.json();

  const course = document.getElementById('qr-course-name').textContent || 'Course';
  const date   = new Date().toLocaleDateString('en-IN').replace(/\//g, '-');

  // CSV header + rows
  const rows = [['Roll No', 'Name', 'Time', 'Status']];
  data.forEach(r => {
    rows.push([
      csvSafe(r.roll_no),
      csvSafe(r.student_name),
      csvSafe(formatTime(r.scanned_at)),
      'Present',
    ]);
  });

  const csv  = rows.map(row => row.join(',')).join('\r\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `MarkMe-${course.replace(/[^\w]+/g, '_')}-${date}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function csvSafe(v) {
  if (v == null) return '';
  const s = String(v);
  // Escape quotes and wrap if contains comma/quote/newline
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ─────────────────────────────────────────────
// PRINT ATTENDANCE
// Opens a clean print-friendly popup with the
// session details + student table, then triggers
// the browser print dialog.
// ─────────────────────────────────────────────
async function printAttendance() {
  if (!currentSessionId) return alert('No active session');

  const res  = await apiFetch(`/api/sessions/${currentSessionId}/attendance`);
  if (!res.ok) return alert('Could not load attendance');
  const data = await res.json();

  const course = document.getElementById('qr-course-name').textContent || '—';
  const date   = document.getElementById('qr-date').textContent || new Date().toLocaleDateString('en-IN');
  const geo    = document.getElementById('qr-geo-info').textContent || '—';
  const teacher = (user && user.name) || 'Teacher';

  const rowsHtml = data.length
    ? data.map((r, i) => `
        <tr>
          <td>${i + 1}</td>
          <td>${escapeHtml(r.roll_no || '')}</td>
          <td>${escapeHtml(r.student_name || '')}</td>
          <td>${escapeHtml(formatTime(r.scanned_at))}</td>
          <td style="color:#0F6E56;font-weight:600">Present</td>
        </tr>`).join('')
    : '<tr><td colspan="5" style="text-align:center;padding:24px;color:#73726c">No scans recorded</td></tr>';

  const html = `
    <!DOCTYPE html>
    <html><head><meta charset="utf-8"><title>MarkMe Attendance — ${escapeHtml(course)}</title>
    <style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:system-ui,sans-serif;color:#1a1a18;padding:32px;background:#fff}
      .head{border-bottom:2px solid #534AB7;padding-bottom:14px;margin-bottom:20px}
      .brand{font-size:22px;font-weight:700;color:#534AB7}
      .title{font-size:18px;font-weight:600;margin-top:4px}
      .meta{display:flex;flex-wrap:wrap;gap:24px;margin:18px 0;font-size:13px}
      .meta div span{color:#73726c;display:block;font-size:11px;text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px}
      table{width:100%;border-collapse:collapse;margin-top:8px;font-size:13px}
      th,td{border:1px solid #d3d1c7;padding:8px 10px;text-align:left}
      th{background:#EEEDF8;color:#534AB7;font-weight:600}
      .summary{margin-top:18px;font-size:13px;color:#3d3d3a}
      .footer{margin-top:28px;padding-top:14px;border-top:1px solid #e0dfd8;font-size:11px;color:#73726c;display:flex;justify-content:space-between}
      @media print { body{padding:16px} .no-print{display:none} }
    </style></head>
    <body>
      <div class="head">
        <div class="brand">MarkMe</div>
        <div class="title">Attendance Report — ${escapeHtml(course)}</div>
      </div>
      <div class="meta">
        <div><span>Date</span>${escapeHtml(date)}</div>
        <div><span>Teacher</span>${escapeHtml(teacher)}</div>
        <div><span>Geo-fence</span>${escapeHtml(geo)}</div>
        <div><span>Session ID</span>#${currentSessionId}</div>
      </div>
      <table>
        <thead>
          <tr><th style="width:40px">#</th><th>Roll No</th><th>Name</th><th>Time</th><th>Status</th></tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      <div class="summary"><strong>Total present:</strong> ${data.length}</div>
      <div class="footer">
        <div>Generated by MarkMe · ${new Date().toLocaleString('en-IN')}</div>
        <div>Teacher signature: ______________________</div>
      </div>
    </body></html>`;

  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) return alert('Pop-up blocked — please allow pop-ups to print');
  w.document.write(html);
  w.document.close();
  w.focus();
  // Wait a tick so styles apply, then print
  setTimeout(() => { w.print(); }, 250);
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function logout() {
  localStorage.removeItem('markme_token');
  localStorage.removeItem('markme_user');
  window.location.href = '/pages/login.html';
}