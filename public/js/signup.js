let verifiedStudent = null; // stores student info after step 1

// Step 1 — Verify roll number + email
async function verifyRollNo() {
  const rollNo = document.getElementById('roll-no').value.trim();
  const email  = document.getElementById('email').value.trim();
  const btn    = document.getElementById('verify-btn');

  clearMessages();

  if (!rollNo || !email) {
    showError('Please fill in both fields');
    return;
  }

  btn.textContent = 'Verifying...';
  btn.disabled    = true;

  try {
    const res  = await fetch('/api/auth/verify-student', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ roll_no: rollNo, email }),
    });

    const data = await res.json();

    if (!res.ok) {
      showError(data.error || 'Verification failed');
      return;
    }

    verifiedStudent = data.student;
    goToStep2();

  } catch (err) {
    showError('Could not connect to server');
  } finally {
    btn.textContent = 'Verify & continue';
    btn.disabled    = false;
  }
}

// Step 2 — Set password
async function handleSignup() {
  const password = document.getElementById('new-password').value;
  const confirm  = document.getElementById('confirm-password').value;
  const btn      = document.getElementById('signup-btn');

  clearMessages();

  if (!password || !confirm) {
    showError('Please fill in both password fields');
    return;
  }

  if (password !== confirm) {
    showError('Passwords do not match');
    return;
  }

  if (password.length < 8) {
    showError('Password must be at least 8 characters');
    return;
  }

  btn.textContent = 'Creating account...';
  btn.disabled    = true;

  try {
    const res  = await fetch('/api/auth/student/activate', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        roll_no:  verifiedStudent.roll_no,
        email:    verifiedStudent.email,
        password,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      showError(data.error || 'Could not create account');
      return;
    }

    goToStep3();

  } catch (err) {
    showError('Could not connect to server');
  } finally {
    btn.textContent = 'Create account';
    btn.disabled    = false;
  }
}

// Step navigation
function goToStep2() {
  document.getElementById('step-1').classList.add('hidden');
  document.getElementById('step-2').classList.remove('hidden');
  setActiveStep(2);

  // Show student info banner
  document.getElementById('student-banner').innerHTML = `
    <div class="banner-row">
      <span class="banner-label">Name</span>
      <span class="banner-value">${verifiedStudent.name}</span>
    </div>
    <div class="banner-row">
      <span class="banner-label">Roll no</span>
      <span class="banner-value">${verifiedStudent.roll_no}</span>
    </div>
    <div class="banner-row">
      <span class="banner-label">Branch</span>
      <span class="banner-value">${verifiedStudent.branch || '—'} · Year ${verifiedStudent.year || '—'} · Sec ${verifiedStudent.section || '—'}</span>
    </div>
  `;
}

function goBackToStep1() {
  document.getElementById('step-2').classList.add('hidden');
  document.getElementById('step-1').classList.remove('hidden');
  setActiveStep(1);
  clearMessages();
}

function goToStep3() {
  document.getElementById('step-2').classList.add('hidden');
  document.getElementById('step-3').classList.remove('hidden');
  setActiveStep(3);
  document.getElementById('welcome-msg').textContent =
    `Welcome, ${verifiedStudent.name}! You can now sign in with your email and password.`;
}

function setActiveStep(n) {
  [1, 2, 3].forEach(i => {
    const dot = document.getElementById(`step-dot-${i}`);
    dot.classList.toggle('active', i === n);
    dot.classList.toggle('done',   i < n);
  });
}

// Password strength checker
function checkStrength(val) {
  const bar   = document.getElementById('strength-bar');
  const label = document.getElementById('strength-label');

  const hasLength  = val.length >= 8;
  const hasNumber  = /\d/.test(val);
  const hasSpecial = /[!@#$%^&*]/.test(val);

  // Update rule indicators
  setRule('rule-length',  hasLength);
  setRule('rule-number',  hasNumber);
  setRule('rule-special', hasSpecial);

  const score = [hasLength, hasNumber, hasSpecial].filter(Boolean).length;

  const levels = [
    { width: '0%',   color: '',        text: '' },
    { width: '33%',  color: '#A32D2D', text: 'Weak' },
    { width: '66%',  color: '#854F0B', text: 'Medium' },
    { width: '100%', color: '#0F6E56', text: 'Strong' },
  ];

  bar.style.width      = levels[score].width;
  bar.style.background = levels[score].color;
  label.textContent    = levels[score].text;
  label.style.color    = levels[score].color;
}

function setRule(id, passed) {
  const el = document.getElementById(id);
  el.classList.toggle('rule-pass', passed);
  el.classList.toggle('rule-fail', !passed);
}

// Message helpers
function showError(msg) {
  const el = document.getElementById('error-msg');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function clearMessages() {
  document.getElementById('error-msg').classList.add('hidden');
  document.getElementById('success-msg').classList.add('hidden');
}