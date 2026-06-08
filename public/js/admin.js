// public/js/admin.js

// ── Auth check ───────────────────────────────
const token = localStorage.getItem('markme_token');
const user  = JSON.parse(localStorage.getItem('markme_user') || '{}');

if (!token || user.role !== 'admin') {
  window.location.href = '/pages/login.html';
}

// ── Init ─────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('admin-name').textContent = user.name || 'Admin';
  loadStudents();
});

// ── Tab switching ─────────────────────────────
function switchTab(name, btn) {
  // Hide all tabs
  ['students', 'teachers', 'courses'].forEach(t => {
    document.getElementById('tab-' + t).classList.add('hidden');
  });
  // Deactivate all tab buttons
  document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));

  // Show selected tab + activate button
  document.getElementById('tab-' + name).classList.remove('hidden');
  btn.classList.add('active');

  // Load data for the tab
  if (name === 'students') loadStudents();
  if (name === 'teachers') loadTeachers();
  if (name === 'courses')  { loadCourses(); loadTeachersDropdown(); }
}

// ── API helper ────────────────────────────────
async function api(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token,
      ...(options.headers || {})
    }
  });
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}

// ─────────────────────────────────────────────
// STUDENTS
// ─────────────────────────────────────────────
let allStudents = [];

async function loadStudents() {
  const { ok, data } = await api('/api/admin/students');
  if (!ok) return showMsg('s-msg', 'error', data.error || 'Failed to load students');

  allStudents = data;

  // Stats
  const pending = data.filter(s => s.password === 'PENDING').length;
  document.getElementById('stat-total').textContent   = data.length;
  document.getElementById('stat-active').textContent  = data.length - pending;
  document.getElementById('stat-pending').textContent = pending;

  renderTable(data);
}

function filterStudents(q) {
  const filtered = allStudents.filter(s =>
    s.name.toLowerCase().includes(q.toLowerCase()) ||
    s.roll_no.toLowerCase().includes(q.toLowerCase())
  );
  renderTable(filtered);
}

function renderTable(data) {
  const el = document.getElementById('s-table');

  if (!data.length) {
    el.innerHTML = '<p style="color:#73726c;font-size:14px">No students found.</p>';
    return;
  }

  el.innerHTML = `
    <div style="overflow-x:auto">
      <table>
        <thead>
          <tr>
            <th>Roll no</th>
            <th>Name</th>
            <th>Email</th>
            <th>Branch</th>
            <th>Year</th>
            <th>Sec</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${data.map(s => `
            <tr>
              <td><span class="roll-tag">${s.roll_no}</span></td>
              <td>${s.name}</td>
              <td style="color:#73726c">${s.email}</td>
              <td>${s.branch  || '—'}</td>
              <td>${s.year    || '—'}</td>
              <td>${s.section || '—'}</td>
              <td>
                <span class="badge ${s.password === 'PENDING' ? 'badge-yellow' : 'badge-green'}">
                  ${s.password === 'PENDING' ? 'Pending' : 'Active'}
                </span>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

async function registerStudent() {
  const roll_no = document.getElementById('s-roll').value.trim();
  const name    = document.getElementById('s-name').value.trim();
  const email   = document.getElementById('s-email').value.trim();
  const password= document.getElementById('s-password').value;
  const branch  = document.getElementById('s-branch').value.trim();
  const year    = document.getElementById('s-year').value;
  const section = document.getElementById('s-section').value.trim();

  clearMsg('s-msg');

  if (!roll_no || !name || !email || !password) {
    return showMsg('s-msg', 'error', 'Roll number, name, email and password are required');
  }

  const btn = document.getElementById('s-btn');
  btn.textContent = 'Adding...';
  btn.disabled = true;

  const { ok, data } = await api('/api/auth/register/student', {
    method: 'POST',
    body: JSON.stringify({
      roll_no, name, email, password, branch,
      year: year ? parseInt(year) : null,
      section
    })
  });

  btn.textContent = 'Add student';
  btn.disabled = false;

  if (!ok) return showMsg('s-msg', 'error', data.error || 'Failed to register');

  showMsg('s-msg', 'success', name + ' (' + roll_no + ') registered!');
  document.getElementById('s-roll').value    = '';
  document.getElementById('s-name').value    = '';
  document.getElementById('s-email').value   = '';
  document.getElementById('s-branch').value  = '';
  document.getElementById('s-year').value    = '';
  document.getElementById('s-section').value = '';
  loadStudents();
}

// ─────────────────────────────────────────────
// BULK IMPORT
// ─────────────────────────────────────────────
let parsedStudents = [];

function previewCSV() {
  clearMsg('b-msg');
  const raw = document.getElementById('csv-input').value.trim();

  if (!raw) return showMsg('b-msg', 'error', 'Please paste CSV data first');

  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  const start = lines[0].toLowerCase().startsWith('roll_no') ? 1 : 0;

  parsedStudents = [];
  for (let i = start; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim());
    if (cols.length < 3) continue;
    parsedStudents.push({
      roll_no: cols[0].toUpperCase(),
      name:    cols[1],
      email:   cols[2],
      branch:  cols[3] || null,
      year:    cols[4] ? parseInt(cols[4]) : null,
      section: cols[5] || null,
    });
  }

  if (!parsedStudents.length) {
    return showMsg('b-msg', 'error', 'No valid rows found');
  }

  // Show preview
  const preview = document.getElementById('b-preview');
  preview.classList.remove('hidden');
  preview.innerHTML = `
    <div class="preview-box">
      <div class="preview-title">${parsedStudents.length} students ready to import</div>
      <div style="overflow-x:auto">
        <table>
          <thead><tr>
            <th>Roll no</th><th>Name</th><th>Email</th>
            <th>Branch</th><th>Year</th><th>Sec</th>
          </tr></thead>
          <tbody>
            ${parsedStudents.map(s => `
              <tr>
                <td>${s.roll_no}</td>
                <td>${s.name}</td>
                <td style="color:#73726c">${s.email}</td>
                <td>${s.branch  || '—'}</td>
                <td>${s.year    || '—'}</td>
                <td>${s.section || '—'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById('b-import-btn').disabled = false;
}

async function bulkImport() {
  clearMsg('b-msg');
  if (!parsedStudents.length) return;

  const btn = document.getElementById('b-import-btn');
  btn.textContent = 'Importing...';
  btn.disabled = true;

  const { ok, data } = await api('/api/auth/register/students/bulk', {
    method: 'POST',
    body: JSON.stringify({ students: parsedStudents })
  });

  btn.textContent = 'Import';
  btn.disabled = true; // keep disabled after import

  if (!ok) return showMsg('b-msg', 'error', data.error || 'Import failed');

  const skipped = data.failed.length
    ? ', ' + data.failed.length + ' skipped (duplicates)' : '';
  showMsg('b-msg', 'success', data.created.length + ' students imported' + skipped);

  document.getElementById('csv-input').value = '';
  document.getElementById('b-preview').classList.add('hidden');
  parsedStudents = [];
  loadStudents();
}

// ─────────────────────────────────────────────
// TEACHERS
// ─────────────────────────────────────────────
async function loadTeachers() {
  const { ok, data } = await api('/api/admin/teachers');
  if (!ok) return;

  const el = document.getElementById('t-list');
  if (!data.length) {
    el.innerHTML = '<p style="color:#73726c;font-size:14px">No teachers yet.</p>';
    return;
  }

  el.innerHTML = data.map(t => `
    <div class="list-item">
      <div class="avatar">${t.name.charAt(0).toUpperCase()}</div>
      <div>
        <div class="list-name">${t.name}</div>
        <div class="list-detail">${t.email}</div>
      </div>
    </div>
  `).join('');
}

async function registerTeacher() {
  const name     = document.getElementById('t-name').value.trim();
  const email    = document.getElementById('t-email').value.trim();
  const password = document.getElementById('t-pass').value;

  clearMsg('t-msg');

  if (!name || !email || !password) {
    return showMsg('t-msg', 'error', 'All fields are required');
  }
  if (password.length < 8) {
    return showMsg('t-msg', 'error', 'Password must be at least 8 characters');
  }

  const btn = document.getElementById('t-btn');
  btn.textContent = 'Adding...';
  btn.disabled = true;

  const { ok, data } = await api('/api/auth/register/teacher', {
    method: 'POST',
    body: JSON.stringify({ name, email, password })
  });

  btn.textContent = 'Add teacher';
  btn.disabled = false;

  if (!ok) return showMsg('t-msg', 'error', data.error || 'Failed to add teacher');

  showMsg('t-msg', 'success', name + ' added successfully');
  document.getElementById('t-name').value = '';
  document.getElementById('t-email').value = '';
  document.getElementById('t-pass').value = '';
  loadTeachers();
}

// ─────────────────────────────────────────────
// COURSES
// ─────────────────────────────────────────────
async function loadTeachersDropdown() {
  const { ok, data } = await api('/api/admin/teachers');
  const sel = document.getElementById('c-teacher');
  sel.innerHTML = ok && data.length
    ? '<option value="">— Select teacher —</option>' +
      data.map(t => `<option value="${t.id}">${t.name}</option>`).join('')
    : '<option value="">No teachers yet — add one first</option>';
}

async function loadCourses() {
  const { ok, data } = await api('/api/admin/courses');
  const el = document.getElementById('c-list');
  if (!ok || !data.length) {
    el.innerHTML = '<p style="color:#73726c;font-size:14px">No courses yet.</p>';
    return;
  }

  el.innerHTML = data.map(c => `
    <div class="list-item">
      <div class="avatar" style="border-radius:8px;background:#f4f4f0;color:#534AB7;font-size:11px;font-weight:700">
        ${c.code.slice(0,3)}
      </div>
      <div>
        <div class="list-name">
          ${c.name}
          <span class="roll-tag" style="margin-left:6px">${c.code}</span>
        </div>
        <div class="list-detail">${c.teacher_name || 'Unassigned'}</div>
      </div>
    </div>
  `).join('');
}

async function addCourse() {
  const name       = document.getElementById('c-name').value.trim();
  const code       = document.getElementById('c-code').value.trim();
  const teacher_id = document.getElementById('c-teacher').value;

  clearMsg('c-msg');

  if (!name || !code) {
    return showMsg('c-msg', 'error', 'Course name and code are required');
  }

  const btn = document.getElementById('c-btn');
  btn.textContent = 'Adding...';
  btn.disabled = true;

  const { ok, data } = await api('/api/admin/courses', {
    method: 'POST',
    body: JSON.stringify({
      name, code,
      teacher_id: teacher_id ? parseInt(teacher_id) : null
    })
  });

  btn.textContent = 'Add course';
  btn.disabled = false;

  if (!ok) return showMsg('c-msg', 'error', data.error || 'Failed to add course');

  showMsg('c-msg', 'success', name + ' (' + code + ') added');
  document.getElementById('c-name').value = '';
  document.getElementById('c-code').value = '';
  loadCourses();
}

// ─────────────────────────────────────────────
// Message helpers
// ─────────────────────────────────────────────
function showMsg(id, type, text) {
  const el = document.getElementById(id);
  el.className = type === 'error' ? 'msg-error' : 'msg-success';
  el.textContent = text;
  el.style.display = 'block';
}

function clearMsg(id) {
  const el = document.getElementById(id);
  el.textContent = '';
  el.style.display = 'none';
}

// ─────────────────────────────────────────────
// Logout
// ─────────────────────────────────────────────
function logout() {
  localStorage.removeItem('markme_token');
  localStorage.removeItem('markme_user');
  window.location.href = '/pages/login.html';
}