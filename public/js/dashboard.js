const token = localStorage.getItem('markme_token');
const user  = JSON.parse(localStorage.getItem('markme_user') || '{}');

// Redirect to login if not authenticated
if (!token) window.location.href = '/pages/login.html';

// Show teacher name in navbar
document.getElementById('teacher-name').textContent = user.name || '';

let currentSessionId  = null;
let attendanceInterval = null;
let timerInterval      = null;
let expiresAt          = null;
let userLat            = null;
let userLng            = null;

// ── On load ─────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  loadCourses();
  getLocation();
});

// ── Load teacher's courses into dropdown ────
async function loadCourses() {
  const res  = await apiFetch('/api/sessions/my-courses');
  const data = await res.json();
  const sel  = document.getElementById('course-select');

  if (!data.length) {
    sel.innerHTML = '<option value="">No courses assigned yet</option>';
    return;
  }

  sel.innerHTML = data.map(c =>
    `<option value="${c.id}">${c.name} (${c.code})</option>`
  ).join('');
}

// ── Get teacher's location for geo-fence ────
function getLocation() {
  const status = document.getElementById('geo-status');
  if (!navigator.geolocation) {
    status.textContent = 'Location not supported — geo-fence will be skipped';
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      userLat = pos.coords.latitude;
      userLng = pos.coords.longitude;
      status.innerHTML = '📍 Location captured — geo-fence active';
      status.classList.add('geo-ok');
    },
    () => {
      status.textContent = '⚠️ Location denied — geo-fence will be skipped';
      status.classList.add('geo-warn');
    }
  );
}

// ── Generate QR ──────────────────────────────
async function generateQR() {
  const courseId = document.getElementById('course-select').value;
  const expiry   = document.getElementById('expiry').value;
  const btn      = document.getElementById('generate-btn');

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
      fence_radius_m: 100,
      expiry_minutes: parseInt(expiry),
    })
  });

  const data = await res.json();

  if (!res.ok) {
    alert(data.error || 'Failed to generate QR');
    btn.textContent = 'Generate QR code';
    btn.disabled    = false;
    return;
  }

  // Show QR section
  currentSessionId = data.session_id;
  expiresAt        = new Date(data.expires_at);

  const courseName = document.getElementById('course-select')
    .options[document.getElementById('course-select').selectedIndex].text;

  document.getElementById('qr-course-name').textContent = courseName;
  document.getElementById('qr-image').src = data.qr_image;
  document.getElementById('qr-section').classList.remove('hidden');
  document.querySelector('.card').classList.add('hidden'); // hide generate form

  startTimer(data.expiry_mins * 60);
  startPolling();

  btn.textContent = 'Generate QR code';
  btn.disabled    = false;
}

// ── Countdown timer ──────────────────────────
function startTimer(seconds) {
  const timerEl = document.getElementById('timer');
  let remaining = seconds;

  timerInterval = setInterval(() => {
    const m = String(Math.floor(remaining / 60)).padStart(2, '0');
    const s = String(remaining % 60).padStart(2, '0');
    timerEl.textContent = `Expires in ${m}:${s}`;
    timerEl.className   = remaining <= 60 ? 'timer timer-urgent' : 'timer';

    if (remaining <= 0) {
      clearInterval(timerInterval);
      timerEl.textContent = 'QR expired';
      timerEl.className   = 'timer timer-expired';
    }
    remaining--;
  }, 1000);
}

// ── Poll attendance every 3 seconds ─────────
function startPolling() {
  fetchAttendance();
  attendanceInterval = setInterval(fetchAttendance, 3000);
}

async function fetchAttendance() {
  if (!currentSessionId) return;
  const res  = await apiFetch(`/api/sessions/${currentSessionId}/attendance`);
  const data = await res.json();

  const list  = document.getElementById('attendance-list');
  const count = document.getElementById('present-count');

  count.textContent = `${data.length} present`;

  if (!data.length) {
    list.innerHTML = '<p class="text-muted">Waiting for scans...</p>';
    return;
  }

  list.innerHTML = data.map(r => `
    <div class="attendance-row">
      <div>
        <span class="roll-no">${r.roll_no}</span>
        <span class="student-name">${r.student_name}</span>
      </div>
      <span class="scan-time">${formatTime(r.scanned_at)}</span>
    </div>
  `).join('');
}

// ── Close session ────────────────────────────
async function closeSession() {
  if (!confirm('Close this session? Students will no longer be able to scan.')) return;

  await apiFetch(`/api/sessions/${currentSessionId}/close`, { method: 'PATCH' });

  clearInterval(attendanceInterval);
  clearInterval(timerInterval);

  document.getElementById('timer').textContent = 'Session closed';
  document.getElementById('timer').className   = 'timer timer-expired';
}

// ── Logout ────────────────────────────────────
function logout() {
  localStorage.removeItem('markme_token');
  localStorage.removeItem('markme_user');
  window.location.href = '/pages/login.html';
}

// ── Helpers ──────────────────────────────────
function apiFetch(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${token}`,
      ...options.headers,
    },
  });
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}