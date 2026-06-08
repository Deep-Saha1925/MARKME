async function handleLogin() {
  const email    = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const role     = document.getElementById('role').value;
  const errorBox = document.getElementById('error-msg');
  const btn      = document.getElementById('login-btn');

  // Basic validation
  if (!email || !password) {
    showError('Please fill in all fields');
    return;
  }

  btn.textContent = 'Signing in...';
  btn.disabled = true;

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, role })
    });

    const data = await res.json();
    console.log(data);

    if (!res.ok) {
      showError(data.error || 'Login failed');
      return;
    }

    // Save token and user info
    localStorage.setItem('markme_token', data.token);
    localStorage.setItem('markme_user',  JSON.stringify(data.user));

    // Redirect based on role
    if (data.user.role === 'student') {
      window.location.href = '/pages/attendance.html';
    } else if (data.user.role === 'admin') {
      window.location.href = '/pages/admin.html';
    } else {
      window.location.href = '/pages/dashboard.html';
    }

  } catch (err) {
    showError('Could not connect to server');
  } finally {
    btn.textContent = 'Sign in';
    btn.disabled = false;
  }
}

function showError(msg) {
  const box = document.getElementById('error-msg');
  box.textContent = msg;
  box.classList.remove('hidden');
}

// Allow Enter key to submit
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleLogin();
});