const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sql = require('../db');
const authMiddleware = require('../middlewares/auth');
require('dotenv').config();

const router = express.Router();

// Helper — generate JWT
function generateToken(user, role) {
  return jwt.sign(
    { id: user.id, email: user.email, role },
    process.env.JWT_SECRET,
    { expiresIn: '8h' }
  );
}

// POST /api/auth/login  (all roles)
router.post('/login', async (req, res) => {
  const { email, password, role } = req.body;

  if (!email || !password || !role) {
    return res.status(400).json({ error: 'Email, password and role are required' });
  }

  try {
    let user = null;

    if (role === 'student') {
      const rows = await sql`SELECT * FROM students WHERE email = ${email} LIMIT 1`;
      user = rows[0];
    } else {
      const rows = await sql`SELECT * FROM users WHERE email = ${email} AND role = ${role} LIMIT 1`;
      user = rows[0];
    }

    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    const token = generateToken(user, role);

    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role }
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/register/admin
// Creates the very first admin (run once)
router.post('/register/admin', async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'name, email and password are required' });
  }

  try {
    // Only allow if no admin exists yet
    const existing = await sql`SELECT id FROM users WHERE role = 'admin' LIMIT 1`;
    if (existing.length) {
      return res.status(403).json({ error: 'An admin already exists. Use the admin panel to add more users.' });
    }

    const hash = password ? await bcrypt.hash(password, 10) : 'PENDING';
    const rows = await sql`
      INSERT INTO users (name, email, password, role)
      VALUES (${name}, ${email}, ${hash}, 'admin')
      RETURNING id, name, email, role
    `;

    const token = generateToken(rows[0], 'admin');
    res.status(201).json({ user: rows[0], token });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not create admin' });
  }
});

// POST /api/auth/register/teacher
// Admin only — creates a teacher account
router.post('/register/teacher', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Only admins can create teacher accounts' });
  }

  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'name, email and password are required' });
  }

  try {
    const existing = await sql`SELECT id FROM users WHERE email = ${email} LIMIT 1`;
    if (existing.length) {
      return res.status(400).json({ error: 'Email already in use' });
    }

    const hash = await bcrypt.hash(password, 10);
    const rows = await sql`
      INSERT INTO users (name, email, password, role)
      VALUES (${name}, ${email}, ${hash}, 'teacher')
      RETURNING id, name, email, role
    `;

    res.status(201).json({ message: 'Teacher created', user: rows[0] });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not create teacher' });
  }
});

// ─────────────────────────────────────────────
// POST /api/auth/register/student
// Admin only — register a single student
// ─────────────────────────────────────────────
router.post('/register/student', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Only admins can register students' });
  }

  const { roll_no, name, email, password, branch, year, section } = req.body;

  if (!roll_no || !name || !email || !password) {
    return res.status(400).json({ error: 'roll_no, name, email and password are required' });
  }

  try {
    const existing = await sql`
      SELECT id FROM students WHERE roll_no = ${roll_no} OR email = ${email} LIMIT 1
    `;
    if (existing.length) {
      return res.status(400).json({ error: 'Roll number or email already exists' });
    }

    const hash = await bcrypt.hash(password, 10);
    const rows = await sql`
      INSERT INTO students (roll_no, name, email, password, branch, year, section)
      VALUES (${roll_no}, ${name}, ${email}, ${hash}, ${branch || null}, ${year || null}, ${section || null})
      RETURNING id, roll_no, name, email, branch, year, section
    `;

    res.status(201).json({ message: 'Student registered', student: rows[0] });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not register student' });
  }
});

// ─────────────────────────────────────────────
// POST /api/auth/register/students/bulk
// Admin only — register multiple students from JSON array
// ─────────────────────────────────────────────
router.post('/register/students/bulk', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Only admins can bulk register students' });
  }

  const { students } = req.body; // array of student objects
  

  if (!Array.isArray(students) || !students.length) {
    return res.status(400).json({ error: 'Provide a non-empty students array' });
  }

  const results = { created: [], failed: [] };

  for (const s of students) {
    const { roll_no, name, email, password, branch, year, section } = s;

    if (!roll_no || !name || !email || !password) {
      results.failed.push({ roll_no, reason: 'Missing required fields' });
      continue;
    }

    try {
      const hash = await bcrypt.hash(password, 10);
      await sql`
        INSERT INTO students (roll_no, name, email, password, branch, year, section)
        VALUES (${roll_no}, ${name}, ${email}, ${hash}, ${branch || null}, ${year || null}, ${section || null})
      `;
      results.created.push(roll_no);
    } catch (err) {
      results.failed.push({ roll_no, reason: 'Duplicate roll number or email' });
    }
  }

  res.status(201).json({
    message: `${results.created.length} students created, ${results.failed.length} failed`,
    ...results
  });
});

// ─────────────────────────────────────────────
// POST /api/auth/student/set-password
// Student sets their own password on first login
// ─────────────────────────────────────────────
router.post('/student/set-password', authMiddleware, async (req, res) => {
  if (req.user.role !== 'student') {
    return res.status(403).json({ error: 'Only students can use this endpoint' });
  }

  const { new_password } = req.body;
  if (!new_password || new_password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  try {
    const hash = await bcrypt.hash(new_password, 10);
    await sql`UPDATE students SET password = ${hash} WHERE id = ${req.user.id}`;
    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Could not update password' });
  }
});

// ─────────────────────────────────────────────
// GET /api/auth/me  — get current user info
// ─────────────────────────────────────────────
router.get('/me', authMiddleware, async (req, res) => {
  try {
    let user = null;

    if (req.user.role === 'student') {
      const rows = await sql`
        SELECT id, roll_no, name, email, branch, year, section
        FROM students WHERE id = ${req.user.id}
      `;
      user = rows[0];
    } else {
      const rows = await sql`
        SELECT id, name, email, role FROM users WHERE id = ${req.user.id}
      `;
      user = rows[0];
    }

    res.json({ ...user, role: req.user.role });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch user' });
  }
});

// ─────────────────────────────────────────────
// POST /api/auth/verify-student
// Step 1 of signup — checks roll no + email match
// ─────────────────────────────────────────────
router.post('/verify-student', async (req, res) => {
  const { roll_no, email } = req.body;

  if (!roll_no || !email) {
    return res.status(400).json({ error: 'Roll number and email are required' });
  }

  try {
    const rows = await sql`
      SELECT id, roll_no, name, email, branch, year, section, password
      FROM students
      WHERE roll_no = ${roll_no} AND email = ${email}
      LIMIT 1
    `;

    if (!rows.length) {
      return res.status(404).json({
        error: 'No student found with this roll number and email. Contact your admin.'
      });
    }

    const student = rows[0];

    // Check if already activated (password was changed from default)
    if (student.password !== 'PENDING') {
      return res.status(400).json({
        error: 'This account is already activated. Please login instead.'
      });
    }

    res.json({
      student: {
        roll_no:  student.roll_no,
        name:     student.name,
        email:    student.email,
        branch:   student.branch,
        year:     student.year,
        section:  student.section,
      }
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────
// POST /api/auth/student/activate
// Step 2 of signup — sets the student's password
// ─────────────────────────────────────────────
router.post('/student/activate', async (req, res) => {
  const { roll_no, email, password } = req.body;

  if (!roll_no || !email || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  try {
    const rows = await sql`
      SELECT id FROM students
      WHERE roll_no = ${roll_no} AND email = ${email} AND password = 'PENDING'
      LIMIT 1
    `;

    if (!rows.length) {
      return res.status(400).json({ error: 'Invalid request or account already activated' });
    }

    const hash = await bcrypt.hash(password, 10);
    await sql`
      UPDATE students SET password = ${hash} WHERE id = ${rows[0].id}
    `;

    res.json({ message: 'Account activated successfully' });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not activate account' });
  }
});

// POST /api/auth/student/change-password
// Student changes their own password (verifies current password first)
router.post('/student/change-password', authMiddleware, async (req, res) => {
  if (req.user.role !== 'student') {
    return res.status(403).json({ error: 'Students only' });
  }

  const { current_password, new_password } = req.body;

  if (!current_password || !new_password) {
    return res.status(400).json({ error: 'Both current and new password are required' });
  }
  if (new_password.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }

  try {
    const rows = await sql`SELECT password FROM students WHERE id = ${req.user.id}`;
    if (!rows.length) return res.status(404).json({ error: 'Student not found' });

    // Verify current password
    const match = await bcrypt.compare(current_password, rows[0].password);
    if (!match) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const hash = await bcrypt.hash(new_password, 10);
    await sql`UPDATE students SET password = ${hash} WHERE id = ${req.user.id}`;

    res.json({ message: 'Password updated successfully' });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not update password' });
  }
});

module.exports = router;