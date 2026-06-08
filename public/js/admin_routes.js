const token = localStorage.getItem('markme_token');
const user  = JSON.parse(localStorage.getItem('markme_user') || '{}');

// Redirect if not admin
if (!token || user.role !== 'admin') window.location.href = '/pages/login.html';

document.getElementById('admin-name').textContent = user.name || 'Admin';

let allStudents = []; // for client-side search

// ─────────────────────────────────────────────
// Tab switching
// ─────────────────────────────────────────────
function switchTab(name) {
  ['students', 'teachers', 'courses'].forEach(t => {
    document.getElementById(`tab-${t}`).classList.toggle('hidden', t !== name);
  });
  document.querySelectorAll('.tab').forEach((btn, i) => {
    btn.classList.toggle('active', ['students','teachers','courses'][i] === name);
  });

  if (name === 'students') loadStudents();
  if (name === 'teachers') { loadTeachers(); }
  if (name === 'courses')  { loadCourses(); loadTeachersForSelect(); }
}

// ─────────────────────────────────────────────
// API helper
// ─────────────────────────────────────────────
function api(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${token}`,
      ...options.headers,
    },
  });
}

// ─────────────────────────────────────────────
// STUDENTS
// ─────────────────────────────────────────────
async function loadStudents() {
  const res  = await api('/api/admin/students');
  const data = await res.json();
  allStudents = data;
  updateStats(data);
  renderStudentsTable(data);
}

function updateStats(data) {
  const total   = data.length;
  const pending = data.filter(s => s.password === 'PENDING').length;
  document.getElementById('stat-total').textContent   = total;
  document.getElementById('stat-active').textContent  = total - pending;
  document.getElementById('stat-pending').textContent = pending;
}

function renderStudentsTable(data) {
  const container = document.getElementById('students-table');

  if (!data.length) {
    container.innerHTML = '<p class="text-muted">No students registered yet.</p>';
    return;
  }

  container.innerHTML = `
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Roll no</th>
            <th>Name</th>
            <th>Email</th>
            <th>Branch</th>
            <th>Year</th>
            <th>Section</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${data.map(s => `
            <tr>
              <td><span class="roll-tag">${s.roll_no}</span></td>
              <td>${s.name}</td>
              <td class="text-muted">${s.email}</td>
              <td>${s.branch || '—'}</td>
              <td>${s.year   || '—'}</td>
              <td>${s.section || '—'}</td>
              <td>
                <span class="status-badge ${s.password === 'PENDING' ? 'badge-pending' : 'badge-active'}">
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

function filterStudents() {
  const q = document.getElementById('search-input').value.toLowerCase();
  const filtered = allStudents.filter(s =>
    s.name.toLowerCase().includes(q) || s.roll_no.toLowerCase().includes(q)
  );
  renderStudentsTable(filtered);
}

async function registerStudent() {
  const roll_no = document.getElementById('s-roll').value.trim();
  const name    = document.getElementById('s-name').value.trim();
  const email   = document.getElementById('s-email').value.trim();
  const branch  = document.getElementById('s-branch').value.trim();
  const year    = document.getElementById('s-year').value;
  const section = document.getElementById('s-section').value.trim();

  clearMsg('student');

  if (!roll_no || !name || !email) {
    showMsg('student', 'error', 'Roll number, name and email are required');
    return;
  }

  const res  = await api('/api/auth/register/student', {
    method: 'POST',
    body: JSON.stringify({ roll_no, name, email, branch, year: year ? parseInt(year) : null, section }),
  });
  const data = await res.json();

  if (!res.ok) {
    showMsg('student', 'error', data.error || 'Failed to register student');
    return;
  }

  showMsg('student', 'success', `${name} (${roll_no}) registered successfully`);
  clearForm(['s-roll','s-name','s-email','s-branch','s-section']);
  document.getElementById('s-year').value = '';
  loadStudents();
}

// ─────────────────────────────────────────────
// BULK CSV IMPORT
// ─────────────────────────────────────────────
let parsedStudents = [];

function previewCSV() {
  const raw = document.getElementById('csv-input').value.trim();
  clearMsg('bulk');

  if (!raw) {
    showMsg('bulk', 'error', 'Please paste some CSV data first');
    return;
  }

  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);

  // Skip header row if present
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
    showMsg('bulk', 'error', 'No valid rows found in CSV');
    return;
  }

  // Show preview table
  const preview = document.getElementById('bulk-preview');
  preview.classList.remove('hidden');
  preview.innerHTML = `
    <div class="preview-header">${parsedStudents.length} students ready to import</div>
    <div class="table-wrap" style="max-height:180px;overflow-y:auto">
      <table class="data-table">
        <thead><tr><th>Roll no</th><th>Name</th><th>Email</th><th>Branch</th><th>Year</th><th>Sec</th></tr></thead>
        <tbody>
          ${parsedStudents.map(s => `
            <tr>
              <td>${s.roll_no}</td>
              <td>${s.name}</td>
              <td class="text-muted">${s.email}</td>
              <td>${s.branch || '—'}</td>
              <td>${s.year   || '—'}</td>
              <td>${s.section || '—'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  document.getElementById('bulk-btn').classList.remove('hidden');
}

async function bulkImport() {
  const btn = document.getElementById('bulk-btn');
  btn.textContent = 'Importing...';
  btn.disabled    = true;
  clearMsg('bulk');

  const res  = await api('/api/auth/register/students/bulk', {
    method: 'POST',
    body:   JSON.stringify({ students: parsedStudents }),
  });
  const data = await res.json();

  if (!res.ok) {
    showMsg('bulk', 'error', data.error || 'Import failed');
  } else {
    showMsg('bulk', 'success',
      `${data.created.length} imported successfully` +
      (data.failed.length ? `, ${data.failed.length} skipped (duplicates)` : '')
    );
    document.getElementById('csv-input').value = '';
    document.getElementById('bulk-preview').classList.add('hidden');
    btn.classList.add('hidden');
    parsedStudents = [];
    loadStudents();
  }

  btn.textContent = 'Import all';
  btn.disabled    = false;
}

// ─────────────────────────────────────────────
// TEACHERS
// ─────────────────────────────────────────────
async function loadTeachers() {
  const res  = await api('/api/admin/teachers');
  const data = await res.json();

  const list = document.getElementById('teachers-list');
  if (!data.length) {
    list.innerHTML = '<p class="text-muted">No teachers yet.</p>';
    return;
  }

  list.innerHTML = data.map(t => `
    <div class="list-row">
      <div class="list-avatar">${t.name.charAt(0)}</div>
      <div>
        <div class="list-name">${t.name}</div>
        <div class="text-muted" style="font-size:12px">${t.email}</div>
      </div>
    </div>
  `).join('');
}

async function registerTeacher() {
  const name     = document.getElementById('t-name').value.trim();
  const email    = document.getElementById('t-email').value.trim();
  const password = document.getElementById('t-password').value;

  clearMsg('teacher');

  if (!name || !email || !password) {
    showMsg('teacher', 'error', 'All fields are required');
    return;
  }
  if (password.length < 8) {
    showMsg('teacher', 'error', 'Password must be at least 8 characters');
    return;
  }

  const res  = await api('/api/auth/register/teacher', {
    method: 'POST',
    body:   JSON.stringify({ name, email, password }),
  });
  const data = await res.json();

  if (!res.ok) {
    showMsg('teacher', 'error', data.error || 'Failed to add teacher');
    return;
  }

  showMsg('teacher', 'success', `${name} added successfully`);
  clearForm(['t-name', 't-email', 't-password']);
  loadTeachers();
  loadTeachersForSelect();
}

// ─────────────────────────────────────────────
// COURSES
// ─────────────────────────────────────────────
async function loadTeachersForSelect() {
  const res  = await api('/api/admin/teachers');
  const data = await res.json();
  const sel  = document.getElementById('c-teacher');
  sel.innerHTML = data.length
    ? data.map(t => `<option value="${t.id}">${t.name}</option>`).join('')
    : '<option value="">No teachers yet</option>';
}

async function loadCourses() {
  const res  = await api('/api/admin/courses');
  const data = await res.json();

  const list = document.getElementById('courses-list');
  if (!data.length) {
    list.innerHTML = '<p class="text-muted">No courses yet.</p>';
    return;
  }

  list.innerHTML = data.map(c => `
    <div class="list-row">
      <div>
        <div class="list-name">${c.name}
          <span class="roll-tag" style="margin-left:6px">${c.code}</span>
        </div>
        <div class="text-muted" style="font-size:12px">${c.teacher_name || 'Unassigned'}</div>
      </div>
    </div>
  `).join('');
}

async function addCourse() {
  const name       = document.getElementById('c-name').value.trim();
  const code       = document.getElementById('c-code').value.trim();
  const teacher_id = document.getElementById('c-teacher').value;

  clearMsg('course');

  if (!name || !code) {
    showMsg('course', 'error', 'Course name and code are required');
    return;
  }

  const res  = await api('/api/admin/courses', {
    method: 'POST',
    body:   JSON.stringify({ name, code, teacher_id: teacher_id ? parseInt(teacher_id) : null }),
  });
  const data = await res.json();

  if (!res.ok) {
    showMsg('course', 'error', data.error || 'Failed to add course');
    return;
  }

  showMsg('course', 'success', `${name} (${code}) added`);
  clearForm(['c-name', 'c-code']);
  loadCourses();
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function showMsg(prefix, type, msg) {
  const el = document.getElementById(`${prefix}-${type}`);
  el.textContent = msg;
  el.classList.remove('hidden');
}

function clearMsg(prefix) {
  ['error', 'success'].forEach(t => {
    const el = document.getElementById(`${prefix}-${t}`);
    if (el) el.classList.add('hidden');
  });
}

function clearForm(ids) {
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
}

function logout() {
  localStorage.removeItem('markme_token');
  localStorage.removeItem('markme_user');
  window.location.href = '/pages/login.html';
}

// ─────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', loadStudents);