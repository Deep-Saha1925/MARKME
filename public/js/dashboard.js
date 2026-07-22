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
let locationPending    = false;   // true while GPS request is in-flight

// State for whichever past session is open in the "Recent classes" modal
let historyModal = { data: [], meta: {} };

// ─────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  loadCourses();
  loadHistory();

  // Click on any history row (event delegation — rows are re-rendered
  // each time loadHistory() runs, so we bind once on the container).
  document.getElementById('history-list').addEventListener('click', (e) => {
    const row = e.target.closest('.history-row');
    if (!row) return;
    openHistoryDetail(
      row.dataset.id,
      `${row.dataset.course} (${row.dataset.code})`,
      formatHistoryDate(row.dataset.createdAt),
      row.dataset.status
    );
  });

  // If a session is still live from before (e.g. teacher got logged out
  // or refreshed mid-class), restore it first. Only request GPS for a
  // brand-new session if nothing was recovered.
  const resumed = await checkActiveSession();
  if (!resumed) getLocation();
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
// RECOVER AN ACTIVE SESSION (e.g. after accidental logout)
// ─────────────────────────────────────────────
async function checkActiveSession() {
  try {
    const res  = await apiFetch('/api/sessions/my-active');
    const data = await res.json();
    if (!res.ok || !data.active) return false;

    currentSessionId  = data.session_id;
    sessionClosed     = false;
    attendanceData    = [];
    sessionCourseName = `${data.course_name} (${data.course_code})`;
    sessionDate       = new Date(data.expires_at).toLocaleDateString('en-IN', {
      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
    });

    document.getElementById('qr-course-name').textContent = sessionCourseName;
    document.getElementById('qr-date').textContent        = sessionDate;
    document.getElementById('qr-geo-info').textContent = data.geo_enabled
      ? `Active · ${data.fence_radius_m}m radius`
      : 'Disabled (no location)';
    document.getElementById('qr-image').src = data.qr_image;

    document.getElementById('print-meta').textContent =
      `${sessionCourseName} · ${sessionDate} · Printed by ${user.name || 'Teacher'}`;

    document.getElementById('generate-card').classList.add('hidden');
    document.getElementById('qr-card').classList.remove('hidden');
    document.getElementById('closed-banner').classList.add('hidden');
    document.getElementById('close-btn').classList.remove('hidden');

    // Let the teacher know this was picked back up, then fade the notice
    const banner = document.getElementById('resume-banner');
    banner.classList.remove('hidden');
    setTimeout(() => banner.classList.add('hidden'), 6000);

    startTimer(data.seconds_left);
    startPolling();
    return true;
  } catch (err) {
    console.error('[checkActiveSession]', err);
    return false;
  }
}

// ─────────────────────────────────────────────
// RECENT CLASSES (history)
// ─────────────────────────────────────────────
async function loadHistory() {
  const list = document.getElementById('history-list');
  try {
    const res  = await apiFetch('/api/sessions/history');
    const data = await res.json();

    if (!res.ok) {
      list.innerHTML = '<p style="color:#73726c;font-size:14px">Could not load class history.</p>';
      return;
    }
    if (!data.length) {
      list.innerHTML = '<p style="color:#73726c;font-size:14px">No classes yet — generate your first QR above.</p>';
      return;
    }

    list.innerHTML = data.map(s => `
      <div class="history-row"
           data-id="${s.id}"
           data-course="${escapeAttr(s.course_name)}"
           data-code="${escapeAttr(s.course_code)}"
           data-created-at="${s.created_at}"
           data-status="${s.status}">
        <div>
          <div class="history-course">${escapeHtml(s.course_name)} (${escapeHtml(s.course_code)})</div>
          <div class="history-meta">${formatHistoryDate(s.created_at)}</div>
        </div>
        <div class="history-right">
          <span class="badge-count">${s.present_count} present</span>
          <span class="status-badge status-${s.status}">${s.status}</span>
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.error('[loadHistory]', err);
    list.innerHTML = '<p style="color:#73726c;font-size:14px">Could not load class history.</p>';
  }
}

function formatHistoryDate(iso) {
  return new Date(iso).toLocaleString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit'
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, '&quot;');
}

// ─────────────────────────────────────────────
// HISTORY DETAIL MODAL (view students for a past class)
// ─────────────────────────────────────────────
async function openHistoryDetail(sessionId, courseLabel, dateLabel, status) {
  document.getElementById('history-modal-course').textContent = courseLabel;
  document.getElementById('history-modal-date').textContent   = dateLabel;
  const statusEl = document.getElementById('history-modal-status');
  statusEl.textContent = status;
  statusEl.className   = `status-badge status-${status}`;
  document.getElementById('history-modal-count').textContent  = '… present';
  document.getElementById('history-modal-list').innerHTML =
    '<p style="color:#73726c;font-size:14px">Loading…</p>';
  document.getElementById('history-modal').classList.remove('hidden');

  try {
    const res  = await apiFetch(`/api/sessions/${sessionId}/attendance`);
    const data = await res.json();

    if (!res.ok) {
      document.getElementById('history-modal-list').innerHTML =
        `<p style="color:#791F1F;font-size:14px">${data.error || 'Could not load attendance.'}</p>`;
      return;
    }

    historyModal = {
      data,
      meta: { courseLabel, dateLabel, sessionId },
    };
    renderHistoryModalList(data);
  } catch (err) {
    console.error('[openHistoryDetail]', err);
    document.getElementById('history-modal-list').innerHTML =
      '<p style="color:#791F1F;font-size:14px">Could not load attendance.</p>';
  }
}

function renderHistoryModalList(data) {
  document.getElementById('history-modal-count').textContent = `${data.length} present`;
  const list = document.getElementById('history-modal-list');

  if (!data.length) {
    list.innerHTML = '<p style="color:#73726c;font-size:14px">No students were marked present for this class.</p>';
    return;
  }

  list.innerHTML = data.map(r => `
    <div class="attendance-row">
      <div>
        <span class="roll-no">${escapeHtml(r.roll_no)}</span>
        <span class="student-name">${escapeHtml(r.student_name)}</span>
      </div>
      <span class="scan-time">${formatTime(r.scanned_at)}</span>
    </div>`).join('');
}

function closeHistoryModal() {
  document.getElementById('history-modal').classList.add('hidden');
}

// ─────────────────────────────────────────────
// LOCATION
// ─────────────────────────────────────────────
function getLocation() {
  // 1. API not available at all
  if (!navigator.geolocation) {
    setBanner('geo-warn',
      '⚠️ Location not supported on this device — geo-fence will be skipped',
      false);
    return;
  }

  // 2. HTTP on non-localhost blocks GPS silently in most browsers
  const proto       = window.location.protocol;
  const host        = window.location.hostname;
  const isHTTP      = proto === 'http:';
  const isLocalhost = host === 'localhost' || host === '127.0.0.1';

  if (isHTTP && !isLocalhost) {
    setBanner('geo-warn',
      '⚠️ GPS blocked on HTTP — use the https:// URL (e.g. via ngrok) for geo-fence to work',
      false);
    return;
  }

  // 3. Request GPS — mark as pending so generateQR() can guard against it
  locationPending = true;
  userLat = null;
  userLng = null;
  setBanner('geo-loading', '📍 Getting your location…', false);

  navigator.geolocation.getCurrentPosition(
    pos => {
      locationPending = false;
      userLat = pos.coords.latitude;
      userLng = pos.coords.longitude;
      const acc = Math.round(pos.coords.accuracy);

      if (acc <= 50) {
        setBanner('geo-ok', `✓ Location captured (±${acc}m) — geo-fence active`, false);
      } else if (acc <= 200) {
        setBanner('geo-ok', `✓ Location captured (±${acc}m accuracy) — geo-fence active`, false);
      } else {
        // Very poor accuracy but still usable
        setBanner('geo-warn',
          `⚠️ Low GPS accuracy (±${acc}m) — move near a window for better results`,
          false);
      }
    },
    err => {
      locationPending = false;
      userLat = null;
      userLng = null;

      const msgs = {
        1: '⚠️ Location permission denied — allow location in browser settings. Geo-fence will be skipped.',
        2: '⚠️ Location unavailable — make sure GPS/Wi-Fi is enabled. Geo-fence will be skipped.',
        3: '⚠️ Location timed out — tap "Retry location" to try again. Geo-fence will be skipped.',
      };
      // Show retry button for timeout and unavailable; for denial it needs a settings change
      const showRetry = err.code !== 1;
      setBanner('geo-warn', msgs[err.code] || '⚠️ Location error — geo-fence will be skipped', showRetry);
    },
    {
      enableHighAccuracy: true,
      timeout:            12000,
      maximumAge:         0,
    }
  );
}

/**
 * Set the geo banner content.
 * @param {string} type       - CSS class suffix: geo-loading | geo-ok | geo-warn | geo-error
 * @param {string} msg        - Banner text
 * @param {boolean} showRetry - Whether to append a retry button
 */
function setBanner(type, msg, showRetry = false) {
  const b     = document.getElementById('geo-banner');
  b.className = 'geo-banner ' + type;

  if (showRetry) {
    b.innerHTML = `
      <span>${msg}</span>
      <button
        onclick="getLocation()"
        style="margin-left:12px;padding:4px 12px;font-size:12px;font-weight:600;
               background:#fff;border:1px solid currentColor;border-radius:6px;
               cursor:pointer;color:inherit;font-family:inherit;">
        Retry location
      </button>`;
  } else {
    b.textContent = msg;
  }
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

  // Guard: if GPS is still resolving, wait rather than silently proceeding without coords
  if (locationPending) {
    alert('📍 Still getting your location — please wait a moment, then try again.');
    return;
  }

  // Warn if no location but don't block — geo-fence will just be skipped server-side
  if (!userLat && !userLng) {
    const proceed = confirm(
      'Location is not available.\n\nGeo-fence will be disabled — students can scan from anywhere.\n\nProceed anyway?'
    );
    if (!proceed) return;
  }

  btn.textContent = 'Generating…';
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

  // Show clearly whether geo-fence is active for THIS session
  document.getElementById('qr-geo-info').textContent = userLat
    ? `Active · ${fenceRadius}m radius`
    : 'Disabled (no location)';

  document.getElementById('qr-image').src = data.qr_image;

  document.getElementById('print-meta').textContent =
    `${sessionCourseName} · ${sessionDate} · Printed by ${user.name || 'Teacher'}`;

  document.getElementById('generate-card').classList.add('hidden');
  document.getElementById('qr-card').classList.remove('hidden');
  document.getElementById('closed-banner').classList.add('hidden');
  document.getElementById('close-btn').classList.remove('hidden');

  startTimer(data.expiry_mins * 60);
  startPolling();
  loadHistory();
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
// ─────────────────────────────────────────────
// EXPORT CSV
// ─────────────────────────────────────────────
function exportCSV() {
  downloadCSV(attendanceData, { courseLabel: sessionCourseName, dateLabel: sessionDate });
}

function exportHistoryCSV() {
  downloadCSV(historyModal.data, historyModal.meta);
}

function downloadCSV(data, meta) {
  if (!data.length) { alert('No attendance data to export yet.'); return; }

  const header  = 'Roll No,Name,Time,Status';
  const rows    = data.map(r =>
    `${r.roll_no},"${r.student_name}",${formatTime(r.scanned_at)},Present`
  );
  const summary = [
    '',
    `Course,${meta.courseLabel}`,
    `Date,${meta.dateLabel}`,
    `Total Present,${data.length}`,
    `Exported by,${user.name || 'Teacher'}`,
    `Exported at,${new Date().toLocaleString('en-IN')}`,
  ];

  const blob       = new Blob([[header, ...rows, ...summary].join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url        = URL.createObjectURL(blob);
  const link       = document.createElement('a');
  const courseSafe = meta.courseLabel.replace(/[^a-zA-Z0-9]/g, '-');
  const dateSafe   = new Date().toLocaleDateString('en-IN').replace(/\//g, '-');
  link.href        = url;
  link.download    = `MarkMe-${courseSafe}-${dateSafe}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

// ─────────────────────────────────────────────
// EXPORT EXCEL (.xlsx via SheetJS, same library used for admin bulk import)
// ─────────────────────────────────────────────
function exportExcel() {
  downloadExcel(attendanceData, { courseLabel: sessionCourseName, dateLabel: sessionDate });
}

function exportHistoryExcel() {
  downloadExcel(historyModal.data, historyModal.meta);
}

function downloadExcel(data, meta) {
  if (!data.length) { alert('No attendance data to export yet.'); return; }
  if (typeof XLSX === 'undefined') { alert('Excel export library failed to load — check your connection.'); return; }

  const rows = data.map(r => ({
    'Roll No': r.roll_no,
    'Name':    r.student_name,
    'Time':    formatTime(r.scanned_at),
    'Status':  'Present',
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [{ wch: 12 }, { wch: 26 }, { wch: 12 }, { wch: 10 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Attendance');

  const courseSafe = meta.courseLabel.replace(/[^a-zA-Z0-9]/g, '-');
  const dateSafe    = new Date().toLocaleDateString('en-IN').replace(/\//g, '-');
  XLSX.writeFile(wb, `MarkMe-${courseSafe}-${dateSafe}.xlsx`);
}

// ─────────────────────────────────────────────
// PRINT ATTENDANCE
// ─────────────────────────────────────────────
function printAttendance() {
  printRows(attendanceData, { courseLabel: sessionCourseName, dateLabel: sessionDate });
}

function printHistoryAttendance() {
  printRows(historyModal.data, historyModal.meta);
}

function printRows(data, meta) {
  if (!data.length) { alert('No attendance data to print yet.'); return; }

  const rows = data.map((r, i) => `
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
          Date: ${meta.dateLabel}<br>
          Printed at: ${new Date().toLocaleTimeString('en-IN')}
        </div>
      </div>
      <h2>${meta.courseLabel}</h2>
      <p class="sub">Attendance Report · ${meta.dateLabel}</p>
      <table>
        <thead>
          <tr><th>#</th><th>Roll No</th><th>Name</th><th>Scan Time</th><th>Status</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="summary">
        <div><strong>Total present</strong>${data.length}</div>
        <div><strong>Course</strong>${meta.courseLabel}</div>
        <div><strong>Date</strong>${meta.dateLabel}</div>
      </div>
      <div class="footer">Generated by MarkMe · QR Attendance System</div>
      <script>window.onload = () => { window.print(); }<\/script>
    </body>
    </html>
  `);
  printWindow.document.close();
}

// CLOSE SESSION
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
  loadHistory();
}

// BACK TO HOME
function backToHome() {
  if (currentSessionId && !sessionClosed) {
    if (!confirm('An active session is still running.\nStudents can still scan until it expires.\nGo back anyway?')) return;
  }
  clearInterval(attendanceInterval);
  clearInterval(timerInterval);
  currentSessionId = null;
  sessionClosed    = false;
  attendanceData   = [];
  userLat          = null;
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

  // Fresh location request for the next session
  getLocation();
}

// DOWNLOAD QR
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

// SHARE LINK
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

// HELPERS
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