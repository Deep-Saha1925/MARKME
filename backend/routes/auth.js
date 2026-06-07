const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sql = require('../db');
require('dotenv').config();

const router = express.Router();

router.post('/login', async (req, res) => {
  const { email, password, role } = req.body;

  if (!email || !password || !role) {
    return res.status(400).json({ error: 'Email, password and role are required' });
  }

  try {
    let user = null;

    if (role === 'student') {
      // Students log in with roll number as email
      const rows = await sql`
        SELECT * FROM students WHERE email = ${email} LIMIT 1
      `;
      user = rows[0];
    } else {
      // Teachers and admins
      const rows = await sql`
        SELECT * FROM users WHERE email = ${email} LIMIT 1
      `;
      user = rows[0];
    }

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: role },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      token,
      user: {
        id:   user.id,
        name: user.name,
        email: user.email,
        role,
      }
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/seed-teacher  (run once to create your first teacher account)
router.post('/seed-teacher', async (req, res) => {
  const { name, email, password } = req.body;
  try {
    const hash = await bcrypt.hash(password, 10);
    const rows = await sql`
      INSERT INTO users (name, email, password, role)
      VALUES (${name}, ${email}, ${hash}, 'teacher')
      RETURNING id, name, email, role
    `;
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not create teacher' });
  }
});

module.exports = router;