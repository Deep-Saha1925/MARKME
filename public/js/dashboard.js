// public/js/dashboard.js

const token = localStorage.getItem('markme_token');
const user  = JSON.parse(localStorage.getItem('markme_user') || '{}');
if (!token) window.location.href = '/pages/login.html';

document.getElementById('teacher-name').textContent = user.name || '';

let currentSessionId   = null;
let attendanceData     = []; // kept in memory for CSV + print
let attendanceInterval = null;
let timerInterval      = null;
let userLat            = null;
let userLng            = null;
let sessionClosed      = false;
let sessionCourseName  = '';
let sessionDate        = '';

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
// ─────────────────────────────────────────────
function getLocation() {
  if (!navigator.geolocation) {
    setBanner('geo-warn', '⚠️ Location not supported — geo-fence will be skipped');
    return;
  }
  const isHTTP      = location.protocol === 'http:';
  const isLocalhost = ['localhost', '127.0.0.1'].includes(location.hostname);
  if (isHTTP && !isLocalhost) {
    setBanner('geo-warn', '⚠️ GPS blocked on HTTP — use ngrok HTTPS for geo-fence');
    return;
  }
  setBanner('geo-loading', '📍 Getting your location...');
  navigator.geolocation.getCurrentPosition(
    pos => {
      userLat = pos.coords.latitude;
      userLng = pos.coords.longitude;
      const acc = Math.round(pos.coords.accuracy);
      setBanner('geo-ok', `✓ Location captured (±${acc}m) — geo-fence active`);
    },
    err => {
      const msgs = {
        1: '⚠️ Location denied — geo-fence will be skipped',
        2: '⚠️ Location unavailable — geo-fence will be skipped',
        3: '⚠️ Location timed out — geo-fence will be skipped',
      };
      setBanner('geo-warn', msgs[err.code] || '⚠️ Location error');
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

function setBanner(type, msg) {
  const b = document.getElementById('geo-banner');
  b.className   = 'geo-banner ' + type;
  b.textContent = msg;
}

// ─────────────────────────────────────────────
// GENERATE QR
// ─────────────────────────────────────────────
async function generateQR() {
  const courseId    = document.getElementById('course-select').value;
  const expiry      = document.getElementById('expiry').value;
  const fenceRadius = document.getElementById('fence-radius').value;
  const btn         = document.getElementById('generate-btn');

  if (!courseId) { alert('Please select a course'); return; }

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

  if (!res.ok) { alert(data.error || 'Failed to generate QR'); return; }

  currentSessionId  = data.session_id;
  sessionClosed     = false;
  attendanceData    = [];

  const sel         = document.getElementById('course-select');
  sessionCourseName = sel.options[sel.selectedIndex].text;
  sessionDate       = new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

  document.getElementById('qr-course-name').textContent = sessionCourseName;
  document.getElementById('qr-date').textContent        = sessionDate;
  document.getElementById('qr-geo-info').textContent    = userLat ? `Active · ${fenceRadius}m radius` : 'Not active (no location)';
  document.getElementById('qr-image').src               = data.qr_image;

  // Update print header
  document.getElementById('print-meta').textContent =
    `${sessionCourseName} · ${sessionDate} · Printed by ${user.name || 'Teacher'}`;

  document.getElementById('generate-card').classList.add('hidden');
  document.getElementById('qr-card').classList.remove('hidden');
  document.getElementById('closed-banner').classList.add('hidden');
  document.getElementById('close-btn').classList.remove('hidden');

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
      timerText.textContent = 'QR expired';
      timerBox.className    = 'timer-box timer-expired';
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

  // Keep in memory for CSV + print
  attendanceData = data;

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
// EXPORT CSV
// ─────────────────────────────────────────────
function exportCSV() {
  if (!attendanceData.length) {
    alert('No attendance data to export yet.');
    return;
  }

  // Build CSV string
  const header = 'Roll No,Name,Time,Status';
  const rows   = attendanceData.map(r =>
    `${r.roll_no},"${r.student_name}",${formatTime(r.scanned_at)},Present`
  );

  // Add summary at bottom
  const summary = [
    '',
    `Course,${sessionCourseName}`,
    `Date,${sessionDate}`,
    `Total Present,${attendanceData.length}`,
    `Exported by,${user.name || 'Teacher'}`,
    `Exported at,${new Date().toLocaleString('en-IN')}`,
  ];

  const csvContent = [header, ...rows, ...summary].join('\n');

  // Trigger download
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const courseSafe = sessionCourseName.replace(/[^a-zA-Z0-9]/g, '-');
  const dateSafe   = new Date().toLocaleDateString('en-IN').replace(/\//g, '-');
  link.href     = url;
  link.download = `MarkMe-${courseSafe}-${dateSafe}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

// ─────────────────────────────────────────────
// PRINT ATTENDANCE
// ─────────────────────────────────────────────
function printAttendance() {
  if (!attendanceData.length) {
    alert('No attendance data to print yet.');
    return;
  }

  // Build a clean print window
  const rows = attendanceData.map((r, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${r.roll_no}</td>
      <td>${r.student_name}</td>
      <td>${formatTime(r.scanned_at)}</td>
      <td>Present</td>
    </tr>`).join('');

  const printWindow = window.open('', '_blank', 'width=800,height=600');
  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>MarkMe — Attendance Report</title>
      <style>
        body { font-family: system-ui, sans-serif; padding: 32px; color: #1a1a18; }
        .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; border-bottom: 2px solid #1a1a18; padding-bottom: 16px; }
        .logo   { font-size: 22px; font-weight: 700; }
        .logo span { color: #534AB7; }
        .meta   { text-align: right; font-size: 13px; color: #73726c; line-height: 1.8; }
        h2      { font-size: 18px; font-weight: 600; margin-bottom: 4px; }
        .sub    { font-size: 13px; color: #73726c; margin-bottom: 20px; }
        table   { width: 100%; border-collapse: collapse; font-size: 13px; }
        th      { background: #f4f4f0; text-align: left; padding: 10px 12px; font-weight: 600; border-bottom: 1px solid #d3d1c7; }
        td      { padding: 10px 12px; border-bottom: 1px solid #e0dfd8; }
        tr:last-child td { border-bottom: none; }
        .footer { margin-top: 24px; font-size: 12px; color: #9c9a92; text-align: center; border-top: 1px solid #e0dfd8; padding-top: 12px; }
        .summary { margin-top: 20px; background: #f4f4f0; padding: 12px 16px; border-radius: 8px; font-size: 13px; display: flex; gap: 32px; }
        .summary strong { display: block; font-size: 11px; color: #73726c; font-weight: 500; margin-bottom: 2px; }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="logo"><span>Mark</span>Me</div>
        <div class="meta">
          Printed by: ${user.name || 'Teacher'}<br>
          Date: ${sessionDate}<br>
          Printed at: ${new Date().toLocaleTimeString('en-IN')}
        </div>
      </div>

      <h2>${sessionCourseName}</h2>
      <p class="sub">Attendance Report · ${sessionDate}</p>

      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Roll No</th>
            <th>Name</th>
            <th>Scan Time</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>

      <div class="summary">
        <div><strong>Total present</strong>${attendanceData.length}</div>
        <div><strong>Course</strong>${sessionCourseName}</div>
        <div><strong>Session date</strong>${sessionDate}</div>
      </div>

      <div class="footer">Generated by MarkMe · QR Attendance System</div>

      <script>window.onload = () => { window.print(); }<\/script>
    </body>
    </html>
  `);
  printWindow.document.close();
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
  document.getElementById('timer-text').textContent = 'Session closed';
  document.getElementById('timer-box').className    = 'timer-box timer-expired';
  document.getElementById('closed-banner').classList.remove('hidden');
  document.getElementById('close-btn').classList.add('hidden');
}

// ─────────────────────────────────────────────
// BACK TO HOME
// ─────────────────────────────────────────────
function backToHome() {
  if (currentSessionId && !sessionClosed) {
    if (!confirm('An active session is still running.\nStudents can still scan until it expires.\nGo back anyway?')) return;
  }
  clearInterval(attendanceInterval);
  clearInterval(timerInterval);
  currentSessionId = null;
  sessionClosed    = false;
  attendanceData   = [];
  document.getElementById('qr-image').src = '';
  document.getElementById('timer-text').textContent = '--:--';
  document.getElementById('timer-box').className    = 'timer-box timer-active';
  document.getElementById('attendance-list').innerHTML = '<p style="color:#73726c;font-size:14px">Waiting for scans...</p>';
  document.getElementById('present-count').textContent = '0 present';
  document.getElementById('closed-banner').classList.add('hidden');
  document.getElementById('close-btn').classList.remove('hidden');
  document.getElementById('qr-card').classList.add('hidden');
  document.getElementById('generate-card').classList.remove('hidden');
  getLocation();
}

// ─────────────────────────────────────────────
// DOWNLOAD QR
// ─────────────────────────────────────────────
function downloadQR() {
  const img    = document.getElementById('qr-image');
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 300;
  const ctx    = canvas.getContext('2d');
  const image  = new Image();
  image.onload = () => {
    ctx.drawImage(image, 0, 0, 300, 300);
    const link    = document.createElement('a');
    const course  = sessionCourseName.replace(/[^a-zA-Z0-9]/g, '-');
    link.download = `MarkMe-QR-${course}-${new Date().toLocaleDateString('en-IN').replace(/\//g,'-')}.png`;
    link.href     = canvas.toDataURL('image/png');
    link.click();
  };
  image.src = img.src;
}

// ─────────────────────────────────────────────
// SHARE LINK
// ─────────────────────────────────────────────
function shareLink() {
  const url = `${location.origin}/pages/qr-share.html?session=${currentSessionId}`;
  const btn = document.getElementById('share-btn');
  if (navigator.share) {
    navigator.share({
      title: 'MarkMe — Scan attendance for ' + sessionCourseName,
      text:  'Scan QR to mark your attendance',
      url,
    }).catch(() => copyLink(url, btn));
  } else {
    copyLink(url, btn);
  }
}
function copyLink(url, btn) {
  navigator.clipboard.writeText(url).then(() => {
    const original  = btn.textContent;
    btn.textContent = '✓ Copied!';
    setTimeout(() => btn.textContent = original, 2000);
  });
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
function apiFetch(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, ...(options.headers || {}) }
  });
}
function formatTime(iso) {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}
function logout() {
  localStorage.removeItem('markme_token');
  localStorage.removeItem('markme_user');
  window.location.href = '/pages/login.html';
}