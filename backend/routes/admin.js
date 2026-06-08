// backend/routes/admin.js

const express = require('express');
const sql = require('../db');
const authMiddleware = require('../middlewares/auth');

const router = express.Router();

// Guard — all admin routes require admin role
router.use(authMiddleware, (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access only' });
  }
  next();
});

// ─────────────────────────────────────────────
// GET /api/admin/students
// ─────────────────────────────────────────────
router.get('/students', async (req, res) => {
  try {
    const rows = await sql`
      SELECT id, roll_no, name, email, branch, year, section, password, created_at
      FROM students
      ORDER BY created_at DESC
    `;
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not fetch students' });
  }
});

// ─────────────────────────────────────────────
// GET /api/admin/teachers
// ─────────────────────────────────────────────
router.get('/teachers', async (req, res) => {
  try {
    const rows = await sql`
      SELECT id, name, email, created_at
      FROM users WHERE role = 'teacher'
      ORDER BY name
    `;
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not fetch teachers' });
  }
});

// ─────────────────────────────────────────────
// GET /api/admin/courses
// ─────────────────────────────────────────────
router.get('/courses', async (req, res) => {
  try {
    const rows = await sql`
      SELECT c.id, c.name, c.code, c.created_at,
             u.name AS teacher_name
      FROM courses c
      LEFT JOIN users u ON u.id = c.teacher_id
      ORDER BY c.name
    `;
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not fetch courses' });
  }
});

// ─────────────────────────────────────────────
// POST /api/admin/courses
// ─────────────────────────────────────────────
router.post('/courses', async (req, res) => {
  const { name, code, teacher_id } = req.body;

  if (!name || !code) {
    return res.status(400).json({ error: 'name and code are required' });
  }

  try {
    const existing = await sql`SELECT id FROM courses WHERE code = ${code}`;
    if (existing.length) {
      return res.status(400).json({ error: 'Course code already exists' });
    }

    const rows = await sql`
      INSERT INTO courses (name, code, teacher_id)
      VALUES (${name}, ${code}, ${teacher_id || null})
      RETURNING *
    `;
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not add course' });
  }
});

module.exports = router;