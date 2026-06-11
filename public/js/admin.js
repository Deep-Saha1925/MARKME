const token = localStorage.getItem('markme_token');
const user  = JSON.parse(localStorage.getItem('markme_user') || '{}');
if (!token || user.role !== 'admin') window.location.href = '/pages/login.html';

window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('admin-name').textContent = user.name || 'Admin';
  loadDashboard();
});

// ─────────────────────────────────────────────
// PAGE NAVIGATION
// ─────────────────────────────────────────────
function showPage(name, btn) {
  document.querySelectorAll('[id^="page-"]').forEach(p => p.classList.add('hidden'));
  document.getElementById('page-' + name).classList.remove('hidden');
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');

  if (name === 'dashboard') loadDashboard();
  if (name === 'students')  { loadStudents(); }
  if (name === 'teachers')  { loadTeachers(); }
  if (name === 'courses')   { loadCourses(); loadTeachersDropdown(); }
  if (name === 'import')    { updateImportHints(); }
}

// ─────────────────────────────────────────────
// API HELPER
// ─────────────────────────────────────────────
async function api(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token, ...(options.headers || {}) }
  });
  const data = await res.json();
  return { ok: res.ok, data };
}

// ─────────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────────
async function loadDashboard() {
  const [sRes, tRes, cRes] = await Promise.all([
    api('/api/admin/students'),
    api('/api/admin/teachers'),
    api('/api/admin/courses'),
  ]);

  const students = sRes.data || [];
  const teachers = tRes.data || [];
  const courses  = cRes.data || [];
  const pending  = students.filter(s => s.password === 'PENDING').length;

  document.getElementById('dash-students').textContent = students.length;
  document.getElementById('dash-active').textContent   = students.length - pending;
  document.getElementById('dash-teachers').textContent = teachers.length;
  document.getElementById('dash-courses').textContent  = courses.length;

  // Sidebar counts
  document.getElementById('sb-students').textContent = students.length;
  document.getElementById('sb-teachers').textContent = teachers.length;
  document.getElementById('sb-courses').textContent  = courses.length;

  // Recent students (last 5)
  const recent = [...students].sort((a,b) => new Date(b.created_at) - new Date(a.created_at)).slice(0,5);
  const rsEl = document.getElementById('dash-recent-students');
  rsEl.innerHTML = recent.length ? recent.map(s => `
    <div class="list-item">
      <div class="avatar">${s.name.charAt(0).toUpperCase()}</div>
      <div style="flex:1">
        <div class="list-name">${s.name} <span class="roll-tag" style="margin-left:4px">${s.roll_no}</span></div>
        <div class="list-detail">${s.branch || '—'} · Year ${s.year || '—'} · Sec ${s.section || '—'}</div>
      </div>
      <span class="badge ${s.password === 'PENDING' ? 'badge-yellow' : 'badge-green'}">${s.password === 'PENDING' ? 'Pending' : 'Active'}</span>
    </div>`).join('') : '<div class="empty-state"><div class="empty-icon">🎓</div>No students yet</div>';

  // Teachers list
  const tlEl = document.getElementById('dash-teacher-list');
  tlEl.innerHTML = teachers.length ? teachers.map(t => `
    <div class="list-item">
      <div class="avatar">${t.name.charAt(0).toUpperCase()}</div>
      <div><div class="list-name">${t.name}</div><div class="list-detail">${t.email}</div></div>
    </div>`).join('') : '<div class="empty-state"><div class="empty-icon">👨‍🏫</div>No teachers yet</div>';
}

// ─────────────────────────────────────────────
// STUDENTS — with pagination + sort + filter
// ─────────────────────────────────────────────
let allStudents  = [];
let filteredStudents = [];
let currentPage  = 1;
let pageSize     = 10;
let sortField    = 'roll_no';
let sortDir      = 'asc';
let statusFilter = '';
let searchQuery  = '';

async function loadStudents() {
  const { ok, data } = await api('/api/admin/students');
  if (!ok) return showMsg('s-msg', 'error', 'Failed to load students');
  allStudents = data;
  document.getElementById('sb-students').textContent = data.length;
  applyFilters();
}

function searchStudents(q) { searchQuery = q; currentPage = 1; applyFilters(); }
function filterByStatus(v) { statusFilter = v; currentPage = 1; applyFilters(); }
function changePageSize(n) { pageSize = n; currentPage = 1; applyFilters(); }

function sortBy(field) {
  if (sortField === field) {
    sortDir = sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    sortField = field;
    sortDir   = 'asc';
  }
  // Update header icons
  document.querySelectorAll('#students-table th').forEach(th => {
    th.classList.remove('sort-asc','sort-desc');
  });
  const thMap = { roll_no:0, name:1, branch:3, year:4, status:6 };
  const idx = thMap[field];
  if (idx !== undefined) {
    const ths = document.querySelectorAll('#students-table th');
    ths[idx].classList.add(sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
  }
  applyFilters();
}

function applyFilters() {
  let data = [...allStudents];

  // Search
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    data = data.filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.roll_no.toLowerCase().includes(q) ||
      (s.email && s.email.toLowerCase().includes(q))
    );
  }

  // Status filter
  if (statusFilter === 'active')  data = data.filter(s => s.password !== 'PENDING');
  if (statusFilter === 'pending') data = data.filter(s => s.password === 'PENDING');

  // Sort
  data.sort((a, b) => {
    let va = a[sortField] || '';
    let vb = b[sortField] || '';
    if (sortField === 'status') { va = a.password === 'PENDING' ? 'pending' : 'active'; vb = b.password === 'PENDING' ? 'pending' : 'active'; }
    if (sortField === 'year')   { va = parseInt(va)||0; vb = parseInt(vb)||0; return sortDir === 'asc' ? va-vb : vb-va; }
    va = va.toString().toLowerCase();
    vb = vb.toString().toLowerCase();
    return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
  });

  filteredStudents = data;
  renderStudentsTable();
  renderPagination();
}

function renderStudentsTable() {
  const start = (currentPage - 1) * pageSize;
  const page  = filteredStudents.slice(start, start + pageSize);
  const tbody = document.getElementById('students-tbody');

  if (!filteredStudents.length) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><div class="empty-icon">🔍</div>No students found</div></td></tr>`;
    return;
  }

  tbody.innerHTML = page.map(s => `
    <tr>
      <td><span class="roll-tag">${s.roll_no}</span></td>
      <td><strong>${s.name}</strong></td>
      <td style="color:#73726c;font-size:12px">${s.email}</td>
      <td>${s.branch  || '—'}</td>
      <td>${s.year    || '—'}</td>
      <td>${s.section || '—'}</td>
      <td><span class="badge ${s.password==='PENDING'?'badge-yellow':'badge-green'}">${s.password==='PENDING'?'Pending':'Active'}</span></td>
      <td><button class="btn-sm btn-sm-danger" onclick="deleteStudent(${s.id},'${s.name}')">Remove</button></td>
    </tr>`).join('');
}

function renderPagination() {
  const total   = filteredStudents.length;
  const pages   = Math.ceil(total / pageSize);
  const start   = total ? (currentPage - 1) * pageSize + 1 : 0;
  const end     = Math.min(currentPage * pageSize, total);

  document.getElementById('pagination-info').textContent =
    total ? `Showing ${start}–${end} of ${total} students` : 'No results';

  const btns = document.getElementById('pagination-btns');
  if (pages <= 1) { btns.innerHTML = ''; return; }

  let html = `<button class="pg-btn" onclick="goPage(${currentPage-1})" ${currentPage===1?'disabled':''}>‹</button>`;

  // Show page numbers with ellipsis
  for (let i = 1; i <= pages; i++) {
    if (i === 1 || i === pages || (i >= currentPage - 1 && i <= currentPage + 1)) {
      html += `<button class="pg-btn ${i===currentPage?'active':''}" onclick="goPage(${i})">${i}</button>`;
    } else if (i === currentPage - 2 || i === currentPage + 2) {
      html += `<button class="pg-btn" disabled>…</button>`;
    }
  }

  html += `<button class="pg-btn" onclick="goPage(${currentPage+1})" ${currentPage===pages?'disabled':''}>›</button>`;
  btns.innerHTML = html;
}

function goPage(n) {
  const pages = Math.ceil(filteredStudents.length / pageSize);
  if (n < 1 || n > pages) return;
  currentPage = n;
  renderStudentsTable();
  renderPagination();
}

async function deleteStudent(id, name) {
  if (!confirm('Remove ' + name + '? This cannot be undone.')) return;
  const { ok, data } = await api('/api/admin/students/' + id, { method: 'DELETE' });
  if (!ok) return alert(data.error || 'Failed to remove');
  loadStudents();
}

// Add student form toggle
function toggleAddForm() {
  const form   = document.getElementById('add-student-form');
  const toggle = document.getElementById('add-form-toggle');
  const hidden = form.classList.toggle('hidden');
  toggle.textContent = hidden ? 'Show ▼' : 'Hide ▲';
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
  resetBtn('s-btn', 'Add student');

  if (!ok) return showMsg('s-msg', 'error', data.error || 'Failed to register');
  showMsg('s-msg', 'success', name + ' (' + roll_no + ') registered!');
  ['s-roll','s-name','s-email','s-password','s-branch','s-section'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('s-year').value = '';
  loadStudents();
}

// ─────────────────────────────────────────────
// TEACHERS
// ─────────────────────────────────────────────
async function loadTeachers() {
  const { ok, data } = await api('/api/admin/teachers');
  if (!ok) return;
  document.getElementById('sb-teachers').textContent = data.length;
  const el = document.getElementById('t-list');
  el.innerHTML = data.length ? data.map(t => `
    <div class="list-item">
      <div class="avatar">${t.name.charAt(0).toUpperCase()}</div>
      <div style="flex:1"><div class="list-name">${t.name}</div><div class="list-detail">${t.email}</div></div>
      <button class="btn-sm btn-sm-danger" onclick="deleteTeacher(${t.id},'${t.name}')">Remove</button>
    </div>`).join('')
    : '<div class="empty-state"><div class="empty-icon">👨‍🏫</div>No teachers yet</div>';
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
  resetBtn('t-btn', 'Add teacher');
  if (!ok) return showMsg('t-msg', 'error', data.error || 'Failed');
  showMsg('t-msg', 'success', name + ' added');
  ['t-name','t-email','t-pass'].forEach(id => document.getElementById(id).value = '');
  loadTeachers();
}

async function deleteTeacher(id, name) {
  if (!confirm('Remove ' + name + '?')) return;
  await api('/api/admin/teachers/' + id, { method: 'DELETE' });
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
  document.getElementById('sb-courses').textContent = ok ? data.length : 0;
  const el = document.getElementById('c-list');
  el.innerHTML = ok && data.length ? data.map(c => `
    <div class="list-item">
      <div class="avatar" style="border-radius:8px;background:#f4f4f0;color:#534AB7;font-size:10px;font-weight:700">${c.code.slice(0,3)}</div>
      <div style="flex:1">
        <div class="list-name">${c.name} <span class="roll-tag" style="margin-left:4px">${c.code}</span></div>
        <div class="list-detail">${c.teacher_name || 'Unassigned'}</div>
      </div>
      <button class="btn-sm btn-sm-danger" onclick="deleteCourse(${c.id},'${c.name}')">Remove</button>
    </div>`).join('')
    : '<div class="empty-state"><div class="empty-icon">📚</div>No courses yet</div>';
}

async function addCourse() {
  const name       = document.getElementById('c-name').value.trim();
  const code       = document.getElementById('c-code').value.trim();
  const teacher_id = document.getElementById('c-teacher').value;
  clearMsg('c-msg');
  if (!name || !code) return showMsg('c-msg', 'error', 'Name and code required');
  const btn = setLoading('c-btn', 'Adding...');
  const { ok, data } = await api('/api/admin/courses', { method: 'POST', body: JSON.stringify({ name, code, teacher_id: teacher_id ? parseInt(teacher_id) : null }) });
  resetBtn('c-btn', 'Add course');
  if (!ok) return showMsg('c-msg', 'error', data.error || 'Failed');
  showMsg('c-msg', 'success', name + ' (' + code + ') added');
  document.getElementById('c-name').value = '';
  document.getElementById('c-code').value = '';
  loadCourses();
}

async function deleteCourse(id, name) {
  if (!confirm('Remove ' + name + '?')) return;
  await api('/api/admin/courses/' + id, { method: 'DELETE' });
  loadCourses();
}

// ─────────────────────────────────────────────
// BULK IMPORT
// ─────────────────────────────────────────────
let importType = 'students';
let importRows = [];

const formatHints = {
  students: 'roll_no,name,email,password,branch,year,section\n22CS045,Riya,riya@college.edu,pass123,CSE,3,B',
  teachers: 'name,email,password\nProf. Sharma,sharma@college.edu,pass1234',
  courses:  'name,code,teacher_email\nData Structures,CS301,sharma@college.edu',
};

function switchImportType(type) {
  importType = type;
  importRows = [];
  document.getElementById('imp-preview').classList.add('hidden');
  document.getElementById('imp-import-btn').disabled = true;
  document.getElementById('imp-filename').textContent = '';
  const csv = document.getElementById('imp-csv-input');
  if (csv) csv.value = '';

  ['students','teachers','courses'].forEach(t => {
    const btn = document.getElementById('import-type-' + t);
    btn.style.border = t === type ? '2px solid #534AB7' : '2px solid transparent';
  });
  updateImportHints();
}

function updateImportHints() {
  const hint = document.getElementById('imp-format-hint');
  if (hint) hint.textContent = formatHints[importType];
}

function switchImportMode(mode) {
  document.getElementById('imp-file-area').classList.toggle('hidden',  mode !== 'file');
  document.getElementById('imp-paste-area').classList.toggle('hidden', mode !== 'paste');
  document.getElementById('imp-toggle-file').classList.toggle('active',  mode === 'file');
  document.getElementById('imp-toggle-paste').classList.toggle('active', mode === 'paste');
  importRows = [];
  document.getElementById('imp-preview').classList.add('hidden');
  document.getElementById('imp-import-btn').disabled = true;
}

function handleDragOver(e, zoneId) { e.preventDefault(); document.getElementById(zoneId).classList.add('drag-over'); }
function handleDragLeave(zoneId)   { document.getElementById(zoneId).classList.remove('drag-over'); }
function handleDrop(e) {
  e.preventDefault();
  document.getElementById('imp-drop-zone').classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) processFile(file);
}
function handleFileSelect(e) { const file = e.target.files[0]; if (file) processFile(file); }

function processFile(file) {
  document.getElementById('imp-filename').textContent = '📄 ' + file.name;
  const reader = new FileReader();
  if (file.name.endsWith('.csv')) {
    reader.onload = e => { importRows = parseCSV(e.target.result); };
    reader.readAsText(file);
  } else {
    reader.onload = e => {
      const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      importRows = normalizeExcel(XLSX.utils.sheet_to_json(ws, { defval: '' }));
    };
    reader.readAsArrayBuffer(file);
  }
}

function parseCSV(raw) {
  const lines = raw.trim().split('\n').map(l => l.trim()).filter(Boolean);
  const hasHeader = /[a-z_]/i.test(lines[0].split(',')[0]);
  const start = hasHeader ? 1 : 0;
  const result = [];
  for (let i = start; i < lines.length; i++) {
    const c = lines[i].split(',').map(x => x.trim());
    if (importType === 'students' && c.length >= 3)
      result.push({ roll_no: c[0].toUpperCase(), name: c[1], email: c[2], password: c[3]||null, branch: c[4]||null, year: c[5]?parseInt(c[5]):null, section: c[6]||null });
    else if (importType === 'teachers' && c.length >= 2)
      result.push({ name: c[0], email: c[1], password: c[2]||null });
    else if (importType === 'courses' && c.length >= 2)
      result.push({ name: c[0], code: c[1].toUpperCase(), teacher_email: c[2]||null });
  }
  return result;
}

function normalizeExcel(rows) {
  return rows.map(r => {
    const row = {};
    Object.keys(r).forEach(k => row[k.toLowerCase().trim()] = r[k]);
    if (importType === 'students') return {
      roll_no: (row['roll_no']||row['rollno']||row['roll no']||'').toString().toUpperCase(),
      name: row['name']||'', email: row['email']||'', password: row['password']||null,
      branch: row['branch']||null, year: row['year']?parseInt(row['year']):null, section: row['section']||null
    };
    if (importType === 'teachers') return { name: row['name']||'', email: row['email']||'', password: row['password']||null };
    if (importType === 'courses')  return { name: row['name']||row['course name']||'', code: (row['code']||row['course code']||'').toString().toUpperCase(), teacher_email: row['teacher_email']||row['teacher email']||null };
  }).filter(r => r && (r.name || r.roll_no));
}

function previewImport() {
  clearMsg('import-msg');

  // Get rows from paste if in paste mode
  const pasteArea = document.getElementById('imp-paste-area');
  if (!pasteArea.classList.contains('hidden')) {
    importRows = parseCSV(document.getElementById('imp-csv-input').value);
  }

  if (!importRows.length) return showMsg('import-msg', 'error', 'No valid rows found. Check your format.');

  const headers = {
    students: ['Roll no','Name','Email','Password','Branch','Year','Sec'],
    teachers: ['Name','Email','Password'],
    courses:  ['Name','Code','Teacher email'],
  };
  const rowFn = {
    students: s => `<td><span class="roll-tag">${s.roll_no}</span></td><td>${s.name}</td><td style="color:#73726c">${s.email}</td><td>${s.password||'<span class="badge badge-yellow">PENDING</span>'}</td><td>${s.branch||'—'}</td><td>${s.year||'—'}</td><td>${s.section||'—'}</td>`,
    teachers: t => `<td>${t.name}</td><td style="color:#73726c">${t.email}</td><td>${t.password?'••••':'<span style="color:#9c9a92">—</span>'}</td>`,
    courses:  c => `<td>${c.name}</td><td><span class="roll-tag">${c.code}</span></td><td style="color:#73726c">${c.teacher_email||'—'}</td>`,
  };

  const preview = document.getElementById('imp-preview');
  preview.classList.remove('hidden');
  preview.innerHTML = `
    <div class="preview-box">
      <div class="preview-title">✓ ${importRows.length} ${importType} ready to import</div>
      <div style="overflow-x:auto">
        <table>
          <thead><tr>${headers[importType].map(h=>`<th>${h}</th>`).join('')}</tr></thead>
          <tbody>${importRows.map(r=>`<tr>${rowFn[importType](r)}</tr>`).join('')}</tbody>
        </table>
      </div>
      ${importType==='students'?'<p class="preview-note">ⓘ Blank password → student sets their own password on first login.</p>':''}
    </div>`;
  document.getElementById('imp-import-btn').disabled = false;
}

async function runImport() {
  clearMsg('import-msg');
  if (!importRows.length) return;
  const btn = setLoading('imp-import-btn', 'Importing...');

  let msg = '';

  if (importType === 'students') {
    const { ok, data } = await api('/api/auth/register/students/bulk', { method: 'POST', body: JSON.stringify({ students: importRows }) });
    if (!ok) { resetBtn('imp-import-btn', 'Import'); return showMsg('import-msg', 'error', data.error || 'Import failed'); }
    const skipped = data.failed.length ? ', ' + data.failed.length + ' skipped (duplicates)' : '';
    msg = '✓ ' + data.created.length + ' students imported' + skipped;
  }

  if (importType === 'teachers') {
    let created = 0, failed = 0;
    for (const t of importRows) {
      if (!t.name || !t.email || !t.password) { failed++; continue; }
      const { ok } = await api('/api/auth/register/teacher', { method: 'POST', body: JSON.stringify(t) });
      ok ? created++ : failed++;
    }
    msg = '✓ ' + created + ' teachers imported' + (failed ? ', ' + failed + ' skipped' : '');
  }

  if (importType === 'courses') {
    const { data: teachers } = await api('/api/admin/teachers');
    const tMap = {};
    teachers.forEach(t => tMap[t.email.toLowerCase()] = t.id);
    let created = 0, failed = 0;
    for (const c of importRows) {
      if (!c.name || !c.code) { failed++; continue; }
      const teacher_id = c.teacher_email ? (tMap[c.teacher_email.toLowerCase()] || null) : null;
      const { ok } = await api('/api/admin/courses', { method: 'POST', body: JSON.stringify({ name: c.name, code: c.code, teacher_id }) });
      ok ? created++ : failed++;
    }
    msg = '✓ ' + created + ' courses imported' + (failed ? ', ' + failed + ' skipped' : '');
  }

  resetBtn('imp-import-btn', 'Import');
  showMsg('import-msg', 'success', msg);
  document.getElementById('imp-preview').classList.add('hidden');
  document.getElementById('imp-import-btn').disabled = true;
  document.getElementById('imp-filename').textContent = '';
  const csv = document.getElementById('imp-csv-input');
  if (csv) csv.value = '';
  importRows = [];

  // Refresh counts
  loadDashboard();
  if (importType === 'students') loadStudents();
  if (importType === 'teachers') loadTeachers();
  if (importType === 'courses')  loadCourses();
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
function showMsg(id, type, text) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = type === 'error' ? 'msg-error' : 'msg-success';
  el.textContent = text;
  el.style.display = 'block';
}
function clearMsg(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = '';
  el.style.display = 'none';
}
function setLoading(btnId, text) {
  const btn = document.getElementById(btnId);
  btn.textContent = text;
  btn.disabled = true;
}
function resetBtn(btnId, text) {
  const btn = document.getElementById(btnId);
  btn.textContent = text;
  btn.disabled = false;
}
function logout() {
  localStorage.removeItem('markme_token');
  localStorage.removeItem('markme_user');
  window.location.href = '/pages/login.html';
}