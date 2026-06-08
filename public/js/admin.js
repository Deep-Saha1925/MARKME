// public/js/admin.js

// ── Auth check ───────────────────────────────
const token = localStorage.getItem('markme_token');
const user  = JSON.parse(localStorage.getItem('markme_user') || '{}');
if (!token || user.role !== 'admin') window.location.href = '/pages/login.html';

window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('admin-name').textContent = user.name || 'Admin';
  loadStudents();
});

// ── Tab switching ─────────────────────────────
function switchTab(name, btn) {
  ['students','teachers','courses'].forEach(t =>
    document.getElementById('tab-' + t).classList.add('hidden')
  );
  document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + name).classList.remove('hidden');
  btn.classList.add('active');
  if (name === 'students') loadStudents();
  if (name === 'teachers') loadTeachers();
  if (name === 'courses')  { loadCourses(); loadTeachersDropdown(); }
}

// ── API helper ────────────────────────────────
async function api(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token, ...(options.headers || {}) }
  });
  const data = await res.json();
  return { ok: res.ok, data };
}

// ─────────────────────────────────────────────
// FILE IMPORT HELPERS
// ─────────────────────────────────────────────

// Parsed data stores for each type
const parsed = { students: [], teachers: [], courses: [] };

// Toggle between file upload and paste CSV
function switchImportMode(type, mode) {
  const prefix = type === 'students' ? 's' : type === 'teachers' ? 't' : 'c';
  document.getElementById(prefix + '-file-area').classList.toggle('hidden',  mode !== 'file');
  document.getElementById(prefix + '-paste-area').classList.toggle('hidden', mode !== 'paste');
  document.getElementById(prefix + '-toggle-file').classList.toggle('active',  mode === 'file');
  document.getElementById(prefix + '-toggle-paste').classList.toggle('active', mode === 'paste');
}

// Drag & drop handlers
function handleDragOver(e, zoneId) {
  e.preventDefault();
  document.getElementById(zoneId).classList.add('drag-over');
}
function handleDragLeave(zoneId) {
  document.getElementById(zoneId).classList.remove('drag-over');
}
function handleDrop(e, type) {
  e.preventDefault();
  const prefix = type === 'students' ? 's' : type === 'teachers' ? 't' : 'c';
  document.getElementById(prefix + '-drop-zone').classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) processFile(file, type);
}
function handleFileSelect(e, type) {
  const file = e.target.files[0];
  if (file) processFile(file, type);
}

// Process uploaded file — CSV or Excel
function processFile(file, type) {
  const prefix   = type === 'students' ? 's' : type === 'teachers' ? 't' : 'c';
  const filenameEl = document.getElementById(prefix + '-filename');
  filenameEl.textContent = '📄 ' + file.name;

  const reader = new FileReader();

  if (file.name.endsWith('.csv')) {
    reader.onload = e => {
      const rows = parseCSVText(e.target.result, type);
      parsed[type] = rows;
    };
    reader.readAsText(file);
  } else {
    // Excel — use SheetJS
    reader.onload = e => {
      const wb   = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
      const ws   = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
      parsed[type] = normalizeRows(rows, type);
    };
    reader.readAsArrayBuffer(file);
  }
}

// Parse raw CSV text into objects
function parseCSVText(raw, type) {
  const lines = raw.trim().split('\n').map(l => l.trim()).filter(Boolean);
  const hasHeader = lines[0].toLowerCase().includes(',') &&
    (lines[0].toLowerCase().startsWith('roll') ||
     lines[0].toLowerCase().startsWith('name') ||
     lines[0].toLowerCase().startsWith('code'));
  const start = hasHeader ? 1 : 0;
  const result = [];

  for (let i = start; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim());
    if (type === 'students' && cols.length >= 3) {
      result.push({
        roll_no:  cols[0].toUpperCase(),
        name:     cols[1],
        email:    cols[2],
        password: cols[3] || null,
        branch:   cols[4] || null,
        year:     cols[5] ? parseInt(cols[5]) : null,
        section:  cols[6] || null,
      });
    } else if (type === 'teachers' && cols.length >= 2) {
      result.push({ name: cols[0], email: cols[1], password: cols[2] || null });
    } else if (type === 'courses' && cols.length >= 2) {
      result.push({ name: cols[0], code: cols[1].toUpperCase(), teacher_email: cols[2] || null });
    }
  }
  return result;
}

// Normalize Excel rows (keys from header row) into same shape
function normalizeRows(rows, type) {
  return rows.map(r => {
    const k = obj => {
      const lower = {};
      Object.keys(obj).forEach(key => lower[key.toLowerCase().trim()] = obj[key]);
      return lower;
    };
    const row = k(r);
    if (type === 'students') return {
      roll_no:  (row['roll_no'] || row['rollno'] || row['roll no'] || '').toString().toUpperCase(),
      name:     row['name']     || '',
      email:    row['email']    || '',
      password: row['password'] || null,
      branch:   row['branch']   || null,
      year:     row['year']     ? parseInt(row['year']) : null,
      section:  row['section']  || null,
    };
    if (type === 'teachers') return {
      name:     row['name']     || '',
      email:    row['email']    || '',
      password: row['password'] || null,
    };
    if (type === 'courses') return {
      name:         row['name']          || row['course name'] || '',
      code:         (row['code']         || row['course code'] || '').toString().toUpperCase(),
      teacher_email: row['teacher_email'] || row['teacher email'] || null,
    };
  }).filter(r => r.name || r.roll_no);
}

// Get parsed data — from file or paste textarea
function getRows(type) {
  const prefix = type === 'students' ? 's' : type === 'teachers' ? 't' : 'c';
  const pasteArea = document.getElementById(prefix + '-paste-area');
  const isPaste   = !pasteArea.classList.contains('hidden');

  if (isPaste) {
    const textareaId = type === 'students' ? 'csv-input' : prefix + '-csv-input';
    const raw = document.getElementById(textareaId).value.trim();
    return parseCSVText(raw, type);
  }
  return parsed[type] || [];
}

// Generic preview renderer
function renderPreview(rows, type, previewId, importBtnId, msgId) {
  clearMsg(msgId);
  if (!rows.length) return showMsg(msgId, 'error', 'No valid rows found. Check your file format.');

  const headers = {
    students: ['Roll no','Name','Email','Password','Branch','Year','Sec'],
    teachers: ['Name','Email','Password'],
    courses:  ['Name','Code','Teacher email'],
  };
  const rowFn = {
    students: s => `<td><span class="roll-tag">${s.roll_no}</span></td><td>${s.name}</td><td style="color:#73726c">${s.email}</td><td>${s.password || '<span class="badge badge-yellow">PENDING</span>'}</td><td>${s.branch||'—'}</td><td>${s.year||'—'}</td><td>${s.section||'—'}</td>`,
    teachers: t => `<td>${t.name}</td><td style="color:#73726c">${t.email}</td><td>${t.password ? '••••••' : '<span style="color:#9c9a92">—</span>'}</td>`,
    courses:  c => `<td>${c.name}</td><td><span class="roll-tag">${c.code}</span></td><td style="color:#73726c">${c.teacher_email||'—'}</td>`,
  };

  document.getElementById(previewId).classList.remove('hidden');
  document.getElementById(previewId).innerHTML = `
    <div class="preview-box">
      <div class="preview-title">✓ ${rows.length} ${type} ready to import</div>
      <div style="overflow-x:auto">
        <table>
          <thead><tr>${headers[type].map(h=>`<th>${h}</th>`).join('')}</tr></thead>
          <tbody>${rows.map(r=>`<tr>${rowFn[type](r)}</tr>`).join('')}</tbody>
        </table>
      </div>
      ${type==='students' ? '<p class="preview-note">ⓘ Blank password → student sets own password on first login.</p>' : ''}
    </div>
  `;
  document.getElementById(importBtnId).disabled = false;
}

// ─────────────────────────────────────────────
// STUDENTS
// ─────────────────────────────────────────────
let allStudents = [];

async function loadStudents() {
  const { ok, data } = await api('/api/admin/students');
  if (!ok) return showMsg('s-msg', 'error', data.error || 'Failed to load');
  allStudents = data;
  const pending = data.filter(s => s.password === 'PENDING').length;
  document.getElementById('stat-total').textContent   = data.length;
  document.getElementById('stat-active').textContent  = data.length - pending;
  document.getElementById('stat-pending').textContent = pending;
  renderTable(data);
}

function filterStudents(q) {
  renderTable(allStudents.filter(s =>
    s.name.toLowerCase().includes(q.toLowerCase()) ||
    s.roll_no.toLowerCase().includes(q.toLowerCase())
  ));
}

function renderTable(data) {
  const el = document.getElementById('s-table');
  if (!data.length) { el.innerHTML = '<p style="color:#73726c;font-size:14px">No students found.</p>'; return; }
  el.innerHTML = `
    <div style="overflow-x:auto"><table>
      <thead><tr><th>Roll no</th><th>Name</th><th>Email</th><th>Branch</th><th>Year</th><th>Sec</th><th>Status</th></tr></thead>
      <tbody>${data.map(s => `
        <tr>
          <td><span class="roll-tag">${s.roll_no}</span></td>
          <td>${s.name}</td>
          <td style="color:#73726c">${s.email}</td>
          <td>${s.branch||'—'}</td><td>${s.year||'—'}</td><td>${s.section||'—'}</td>
          <td><span class="badge ${s.password==='PENDING'?'badge-yellow':'badge-green'}">${s.password==='PENDING'?'Pending':'Active'}</span></td>
        </tr>`).join('')}
      </tbody>
    </table></div>`;
}

async function registerStudent() {
  const roll_no  = document.getElementById('s-roll').value.trim();
  const name     = document.getElementById('s-name').value.trim();
  const email    = document.getElementById('s-email').value.trim();
  const password = document.getElementById('s-password').value;
  const branch   = document.getElementById('s-branch').value.trim();
  const year     = document.getElementById('s-year').value;
  const section  = document.getElementById('s-section').value.trim();
  clearMsg('s-msg');
  if (!roll_no || !name || !email) return showMsg('s-msg', 'error', 'Roll number, name and email are required');
  const btn = setLoading('s-btn', 'Adding...');
  const { ok, data } = await api('/api/auth/register/student', {
    method: 'POST',
    body: JSON.stringify({ roll_no, name, email, password: password || null, branch, year: year ? parseInt(year) : null, section })
  });
  resetBtn('s-btn', 'Add student', btn);
  if (!ok) return showMsg('s-msg', 'error', data.error || 'Failed to register');
  showMsg('s-msg', 'success', name + ' (' + roll_no + ') registered!');
  ['s-roll','s-name','s-email','s-password','s-branch','s-section'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('s-year').value = '';
  loadStudents();
}

function previewStudents() {
  const rows = getRows('students');
  renderPreview(rows, 'students', 'b-preview', 'b-import-btn', 'b-msg');
}

async function bulkImportStudents() {
  const rows = getRows('students');
  clearMsg('b-msg');
  if (!rows.length) return;
  const btn = setLoading('b-import-btn', 'Importing...');
  const { ok, data } = await api('/api/auth/register/students/bulk', { method: 'POST', body: JSON.stringify({ students: rows }) });
  resetBtn('b-import-btn', 'Import', btn);
  if (!ok) return showMsg('b-msg', 'error', data.error || 'Import failed');
  const skipped = data.failed.length ? ', ' + data.failed.length + ' skipped (duplicates)' : '';
  showMsg('b-msg', 'success', '✓ ' + data.created.length + ' students imported' + skipped);
  document.getElementById('b-preview').classList.add('hidden');
  document.getElementById('b-import-btn').disabled = true;
  document.getElementById('csv-input') && (document.getElementById('csv-input').value = '');
  document.getElementById('s-filename').textContent = '';
  parsed.students = [];
  loadStudents();
}

// ─────────────────────────────────────────────
// TEACHERS
// ─────────────────────────────────────────────
async function loadTeachers() {
  const { ok, data } = await api('/api/admin/teachers');
  if (!ok) return;
  const el = document.getElementById('t-list');
  if (!data.length) { el.innerHTML = '<p style="color:#73726c;font-size:14px">No teachers yet.</p>'; return; }
  el.innerHTML = data.map(t => `
    <div class="list-item">
      <div class="avatar">${t.name.charAt(0).toUpperCase()}</div>
      <div><div class="list-name">${t.name}</div><div class="list-detail">${t.email}</div></div>
    </div>`).join('');
}

async function registerTeacher() {
  const name     = document.getElementById('t-name').value.trim();
  const email    = document.getElementById('t-email').value.trim();
  const password = document.getElementById('t-pass').value;
  clearMsg('t-msg');
  if (!name || !email || !password) return showMsg('t-msg', 'error', 'All fields are required');
  if (password.length < 8) return showMsg('t-msg', 'error', 'Password must be at least 8 characters');
  const btn = setLoading('t-btn', 'Adding...');
  const { ok, data } = await api('/api/auth/register/teacher', { method: 'POST', body: JSON.stringify({ name, email, password }) });
  resetBtn('t-btn', 'Add teacher', btn);
  if (!ok) return showMsg('t-msg', 'error', data.error || 'Failed to add teacher');
  showMsg('t-msg', 'success', name + ' added successfully');
  ['t-name','t-email','t-pass'].forEach(id => document.getElementById(id).value = '');
  loadTeachers();
}

function previewTeachers() {
  const rows = getRows('teachers');
  renderPreview(rows, 'teachers', 'tb-preview', 'tb-import-btn', 'tb-msg');
}

async function bulkImportTeachers() {
  const rows = getRows('teachers');
  clearMsg('tb-msg');
  if (!rows.length) return;
  const btn = setLoading('tb-import-btn', 'Importing...');
  let created = 0, failed = 0;

  for (const t of rows) {
    if (!t.name || !t.email || !t.password) { failed++; continue; }
    const { ok } = await api('/api/auth/register/teacher', { method: 'POST', body: JSON.stringify(t) });
    ok ? created++ : failed++;
  }

  resetBtn('tb-import-btn', 'Import', btn);
  const skipped = failed ? ', ' + failed + ' skipped' : '';
  showMsg('tb-msg', 'success', '✓ ' + created + ' teachers imported' + skipped);
  document.getElementById('tb-preview').classList.add('hidden');
  document.getElementById('tb-import-btn').disabled = true;
  document.getElementById('t-filename').textContent = '';
  parsed.teachers = [];
  loadTeachers();
}

// ─────────────────────────────────────────────
// COURSES
// ─────────────────────────────────────────────
async function loadTeachersDropdown() {
  const { ok, data } = await api('/api/admin/teachers');
  const sel = document.getElementById('c-teacher');
  sel.innerHTML = ok && data.length
    ? '<option value="">— Select teacher —</option>' + data.map(t => `<option value="${t.id}">${t.name}</option>`).join('')
    : '<option value="">No teachers yet</option>';
}

async function loadCourses() {
  const { ok, data } = await api('/api/admin/courses');
  const el = document.getElementById('c-list');
  if (!ok || !data.length) { el.innerHTML = '<p style="color:#73726c;font-size:14px">No courses yet.</p>'; return; }
  el.innerHTML = data.map(c => `
    <div class="list-item">
      <div class="avatar" style="border-radius:8px;background:#f4f4f0;color:#534AB7;font-size:11px;font-weight:700">${c.code.slice(0,3)}</div>
      <div>
        <div class="list-name">${c.name} <span class="roll-tag" style="margin-left:6px">${c.code}</span></div>
        <div class="list-detail">${c.teacher_name || 'Unassigned'}</div>
      </div>
    </div>`).join('');
}

async function addCourse() {
  const name       = document.getElementById('c-name').value.trim();
  const code       = document.getElementById('c-code').value.trim();
  const teacher_id = document.getElementById('c-teacher').value;
  clearMsg('c-msg');
  if (!name || !code) return showMsg('c-msg', 'error', 'Course name and code are required');
  const btn = setLoading('c-btn', 'Adding...');
  const { ok, data } = await api('/api/admin/courses', { method: 'POST', body: JSON.stringify({ name, code, teacher_id: teacher_id ? parseInt(teacher_id) : null }) });
  resetBtn('c-btn', 'Add course', btn);
  if (!ok) return showMsg('c-msg', 'error', data.error || 'Failed to add course');
  showMsg('c-msg', 'success', name + ' (' + code + ') added');
  document.getElementById('c-name').value = '';
  document.getElementById('c-code').value = '';
  loadCourses();
}

function previewCourses() {
  const rows = getRows('courses');
  renderPreview(rows, 'courses', 'cb-preview', 'cb-import-btn', 'cb-msg');
}

async function bulkImportCourses() {
  const rows = getRows('courses');
  clearMsg('cb-msg');
  if (!rows.length) return;

  // Resolve teacher emails to IDs
  const { data: teachers } = await api('/api/admin/teachers');
  const teacherMap = {};
  teachers.forEach(t => teacherMap[t.email.toLowerCase()] = t.id);

  const btn = setLoading('cb-import-btn', 'Importing...');
  let created = 0, failed = 0;

  for (const c of rows) {
    if (!c.name || !c.code) { failed++; continue; }
    const teacher_id = c.teacher_email ? (teacherMap[c.teacher_email.toLowerCase()] || null) : null;
    const { ok } = await api('/api/admin/courses', { method: 'POST', body: JSON.stringify({ name: c.name, code: c.code, teacher_id }) });
    ok ? created++ : failed++;
  }

  resetBtn('cb-import-btn', 'Import', btn);
  const skipped = failed ? ', ' + failed + ' skipped (duplicates or errors)' : '';
  showMsg('cb-msg', 'success', '✓ ' + created + ' courses imported' + skipped);
  document.getElementById('cb-preview').classList.add('hidden');
  document.getElementById('cb-import-btn').disabled = true;
  document.getElementById('c-filename').textContent = '';
  parsed.courses = [];
  loadCourses();
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function showMsg(id, type, text) {
  const el = document.getElementById(id);
  el.className   = type === 'error' ? 'msg-error' : 'msg-success';
  el.textContent = text;
  el.style.display = 'block';
}
function clearMsg(id) {
  const el = document.getElementById(id);
  el.textContent = '';
  el.style.display = 'none';
}
function setLoading(btnId, text) {
  const btn = document.getElementById(btnId);
  const prev = btn.textContent; 
  btn.textContent = text;
  btn.disabled = true;
  return prev;
}
function resetBtn(btnId, text, _prev) {
  const btn = document.getElementById(btnId);
  btn.textContent = text;
  btn.disabled = false;
}
function logout() {
  localStorage.removeItem('markme_token');
  localStorage.removeItem('markme_user');
  window.location.href = '/pages/login.html';
}