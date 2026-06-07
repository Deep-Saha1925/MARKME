const express = require('express');
const qrcode = require('qrcode');
const crypto = require('crypto');
const sql = require('../db');
const redis = require('../redis');
const authMiddleware = require('../middlewares/auth.js');
require('dotenv').config();

const router = express.Router();

// POST /api/sessions/generate  — teacher generates a QR
router.post('/generate', authMiddleware, async (req, res) => {
  const { course_id, lat, lng, fence_radius_m, expiry_minutes } = req.body;

  if (!course_id) {
    return res.status(400).json({ error: 'course_id is required' });
  }

  try {
    // Make sure this course belongs to the logged-in teacher
    const courses = await sql`
      SELECT * FROM courses
      WHERE id = ${course_id} AND teacher_id = ${req.user.id}
    `;
    if (!courses.length) {
      return res.status(403).json({ error: 'Course not found or not yours' });
    }

    // Generate a unique token
    const token = crypto.randomUUID();
    const expiryMins = expiry_minutes || 10;
    const expiresAt = new Date(Date.now() + expiryMins * 60 * 1000);

    // Save session to PostgreSQL
    const sessions = await sql`
      INSERT INTO sessions
        (course_id, teacher_id, qr_token, classroom_lat, classroom_lng,
         fence_radius_m, expires_at)
      VALUES
        (${course_id}, ${req.user.id}, ${token},
         ${lat || null}, ${lng || null},
         ${fence_radius_m || 100}, ${expiresAt})
      RETURNING *
    `;
    const session = sessions[0];

    // Store token in Upstash Redis with TTL
    await redis.set(`qr:${token}`, session.id, { ex: expiryMins * 60 });

    // Generate QR code as base64 image
    const qrImage = await qrcode.toDataURL(token, {
      width: 300,
      margin: 2,
      color: { dark: '#1a1a18', light: '#ffffff' }
    });

    res.json({
      session_id: session.id,
      token,
      qr_image:   qrImage,       // base64 PNG — drop straight into <img src="">
      expires_at: expiresAt,
      expiry_mins: expiryMins,
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not generate QR' });
  }
});

// GET /api/sessions/my-courses  — teacher fetches their courses
router.get('/my-courses', authMiddleware, async (req, res) => {
  try {
    const courses = await sql`
      SELECT * FROM courses
      WHERE teacher_id = ${req.user.id}
      ORDER BY name
    `;
    res.json(courses);
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch courses' });
  }
});

// GET /api/sessions/:id/attendance  — live attendance for a session
router.get('/:id/attendance', authMiddleware, async (req, res) => {
  try {
    const records = await sql`
      SELECT
        a.id, a.scanned_at, a.status,
        s.name AS student_name,
        s.roll_no
      FROM attendance a
      JOIN students s ON s.id = a.student_id
      WHERE a.session_id = ${req.params.id}
      ORDER BY a.scanned_at DESC
    `;
    res.json(records);
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch attendance' });
  }
});

// PATCH /api/sessions/:id/close  — teacher closes session
router.patch('/:id/close', authMiddleware, async (req, res) => {
  try {
    await sql`
      UPDATE sessions SET is_active = false
      WHERE id = ${req.params.id} AND teacher_id = ${req.user.id}
    `;
    res.json({ message: 'Session closed' });
  } catch (err) {
    res.status(500).json({ error: 'Could not close session' });
  }
});

module.exports = router;