const token = localStorage.getItem('markme_token');
const user  = JSON.parse(localStorage.getItem('markme_user') || '{}');
if (!token) window.location.href = '/pages/login.html';

document.getElementById('teacher-name').textContent = user.name || '';

let currentSessionId   = null;
let attendanceData     = [];
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
// FIX: use window.location.protocol explicitly
// to avoid conflict with any local variable named
// 'location'. Also re-requests on every backToHome()
// so a stale position is never used.
// ─────────────────────────────────────────────
function getLocation() {
  // 1. API not available
  if (!navigator.geolocation) {
    setBanner('geo-warn', '⚠️ Location not supported on this device — geo-fence will be skipped');
    return;
  }

  // 2. HTTP on non-localhost — browser silently blocks GPS
  const proto       = window.location.protocol;   // ← use window.location explicitly
  const host        = window.location.hostname;
  const isHTTP      = proto === 'http:';
  const isLocalhost = host === 'localhost' || host === '127.0.0.1';

  if (isHTTP && !isLocalhost) {
    setBanner('geo-warn', '⚠️ GPS blocked on HTTP — run ngrok and use the https:// URL for geo-fence to work');
    return;
  }

  // 3. Request GPS
  setBanner('geo-loading', '📍 Getting your location...');

  navigator.geolocation.getCurrentPosition(
    pos => {
      userLat = pos.coords.latitude;
      userLng = pos.coords.longitude;
      const acc = Math.round(pos.coords.accuracy);

      if (acc <= 50) {
        setBanner('geo-ok', `✓ Location captured (±${acc}m) — geo-fence active`);
      } else if (acc <= 200) {
        setBanner('geo-ok', `✓ Location captured (±${acc}m accuracy) — geo-fence active`);
      } else {
        // Very poor accuracy — warn but still store coords
        setBanner('geo-warn', `⚠️ Low GPS accuracy (±${acc}m) — move near a window for better accuracy`);
      }
    },
    err => {
      // Reset coords so we don't use stale values from a previous session
      userLat = null;
      userLng = null;

      const msgs = {
        1: '⚠️ Location permission denied — allow location in browser settings. Geo-fence will be skipped.',
        2: '⚠️ Location unavailable — make sure GPS is enabled. Geo-fence will be skipped.',
        3: '⚠️ Location timed out — refresh the page to try again. Geo-fence will be skipped.',
      };
      setBanner('geo-warn', msgs[err.code] || '⚠️ Location error — geo-fence will be skipped');
    },
    {
      enableHighAccuracy: true,  // use GPS chip, not just WiFi/cell towers
      timeout:            12000, // 12 seconds — teachers are usually on WiFi, GPS is slower indoors
      maximumAge:         0,     // always fresh — never use cached position
    }
  );
}

function setBanner(type, msg) {
  const b   = document.getElementById('geo-banner');
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
  sessionDate       = new Date().toLocaleDateString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
  });

  document.getElementById('qr-course-name').textContent = sessionCourseName;
  document.getElementById('qr-date').textContent        = sessionDate;
  document.getElementById('qr-geo-info').textContent    = userLat
    ? `Active · ${fenceRadius}m radius`
    : 'Not active (location unavailable)';
  document.getElementById('qr-image').src = data.qr_image;

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
  if (!attendanceData.length) { alert('No attendance data to export yet.'); return; }

  const header  = 'Roll No,Name,Time,Status';
  const rows    = attendanceData.map(r =>
    `${r.roll_no},"${r.student_name}",${formatTime(r.scanned_at)},Present`
  );
  const summary = [
    '',
    `Course,${sessionCourseName}`,
    `Date,${sessionDate}`,
    `Total Present,${attendanceData.length}`,
    `Exported by,${user.name || 'Teacher'}`,
    `Exported at,${new Date().toLocaleString('en-IN')}`,
  ];

  const blob       = new Blob([[header, ...rows, ...summary].join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url        = URL.createObjectURL(blob);
  const link       = document.createElement('a');
  const courseSafe = sessionCourseName.replace(/[^a-zA-Z0-9]/g, '-');
  const dateSafe   = new Date().toLocaleDateString('en-IN').replace(/\//g, '-');
  link.href        = url;
  link.download    = `MarkMe-${courseSafe}-${dateSafe}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

// ─────────────────────────────────────────────
// PRINT ATTENDANCE
// ─────────────────────────────────────────────
function printAttendance() {
  if (!attendanceData.length) { alert('No attendance data to print yet.'); return; }

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
        body    { font-family: system-ui, sans-serif; padding: 32px; color: #1a1a18; }
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
        .summary { margin-top: 20px; background: #f4f4f0; padding: 12px 16px; border-radius: 8px; font-size: 13px; display: flex; gap: 32px; }
        .summary strong { display: block; font-size: 11px; color: #73726c; font-weight: 500; margin-bottom: 2px; }
        .footer { margin-top: 24px; font-size: 12px; color: #9c9a92; text-align: center; border-top: 1px solid #e0dfd8; padding-top: 12px; }
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
          <tr><th>#</th><th>Roll No</th><th>Name</th><th>Scan Time</th><th>Status</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="summary">
        <div><strong>Total present</strong>${attendanceData.length}</div>
        <div><strong>Course</strong>${sessionCourseName}</div>
        <div><strong>Date</strong>${sessionDate}</div>
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
  userLat          = null;  // ← reset coords so stale location isn't reused
  userLng          = null;

  document.getElementById('qr-image').src              = '';
  document.getElementById('timer-text').textContent    = '--:--';
  document.getElementById('timer-box').className       = 'timer-box timer-active';
  document.getElementById('attendance-list').innerHTML = '<p style="color:#73726c;font-size:14px">Waiting for scans...</p>';
  document.getElementById('present-count').textContent = '0 present';
  document.getElementById('closed-banner').classList.add('hidden');
  document.getElementById('close-btn').classList.remove('hidden');
  document.getElementById('qr-card').classList.add('hidden');
  document.getElementById('generate-card').classList.remove('hidden');

  // Re-fetch location fresh for the next session
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
  const url = `${window.location.origin}/pages/qr-share.html?session=${currentSessionId}`;
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

function logout() {
  localStorage.removeItem('markme_token');
  localStorage.removeItem('markme_user');
  window.location.href = '/pages/login.html';
}