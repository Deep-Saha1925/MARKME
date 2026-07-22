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
         ${fence_radius_m || 20}, ${expiresAt})
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
      qr_image:   qrImage,
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

// GET /api/sessions/:id/attendance  — attendance for a session (live or past)
router.get('/:id/attendance', authMiddleware, async (req, res) => {
  try {
    // Confirm this session actually belongs to the requesting teacher
    // before returning any student records for it.
    const owned = await sql`
      SELECT id FROM sessions
      WHERE id = ${req.params.id} AND teacher_id = ${req.user.id}
    `;
    if (!owned.length) {
      return res.status(403).json({ error: 'Session not found or not yours' });
    }

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

// GET /api/sessions/:id/share
// Public endpoint — no auth required
// Returns session info + QR image for the share page
router.get('/:id/share', async (req, res) => {
  try {
    const sessions = await sql`
      SELECT s.id, s.expires_at, s.is_active, s.qr_token,
             c.name AS course_name, c.code AS course_code,
             u.name AS teacher_name
      FROM sessions s
      JOIN courses c ON c.id = s.course_id
      JOIN users   u ON u.id = s.teacher_id
      WHERE s.id = ${req.params.id}
    `;

    if (!sessions.length) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const session = sessions[0];

    // Check if expired or closed
    const now       = new Date();
    const expiresAt = new Date(session.expires_at);
    const expired   = !session.is_active || now > expiresAt;

    // Generate fresh QR image from the token
    const qrImage = await qrcode.toDataURL(session.qr_token, {
      width: 300, margin: 2,
      color: { dark: '#1a1a18', light: '#ffffff' }
    });

    res.json({
      course_name:  session.course_name,
      course_code:  session.course_code,
      teacher_name: session.teacher_name,
      expires_at:   session.expires_at,
      expired,
      qr_image:     expired ? null : qrImage,
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/sessions/my-active
// Teacher recovery — if the teacher accidentally logs out (or the tab
// closes/refreshes) while a QR session is still live, logging back in
// will find that same session here so they can pick up right where
// they left off, instead of having to generate a fresh QR.
router.get('/my-active', authMiddleware, async (req, res) => {
  try {
    const now = new Date();
    const sessions = await sql`
      SELECT
        s.id, s.qr_token, s.expires_at, s.created_at,
        s.classroom_lat, s.classroom_lng, s.fence_radius_m,
        c.id AS course_id, c.name AS course_name, c.code AS course_code
      FROM sessions s
      JOIN courses c ON c.id = s.course_id
      WHERE s.teacher_id = ${req.user.id}
        AND s.is_active  = true
        AND s.expires_at > ${now}
      ORDER BY s.created_at DESC
      LIMIT 1
    `;

    if (!sessions.length) {
      return res.json({ active: false });
    }

    const session = sessions[0];

    // Regenerate the QR image from the stored token — we never persisted
    // the image itself, only the token, so it's rebuilt on demand.
    const qrImage = await qrcode.toDataURL(session.qr_token, {
      width: 300, margin: 2,
      color: { dark: '#1a1a18', light: '#ffffff' }
    });

    const secondsLeft = Math.max(
      0,
      Math.round((new Date(session.expires_at) - now) / 1000)
    );

    res.json({
      active:         true,
      session_id:     session.id,
      course_id:      session.course_id,
      course_name:    session.course_name,
      course_code:    session.course_code,
      qr_image:       qrImage,
      expires_at:     session.expires_at,
      seconds_left:   secondsLeft,
      geo_enabled:    !!(session.classroom_lat && session.classroom_lng),
      fence_radius_m: session.fence_radius_m,
    });
  } catch (err) {
    console.error('[my-active]', err);
    res.status(500).json({ error: 'Could not check for an active session' });
  }
});

// GET /api/sessions/history
// Teacher's recent classes — closed/expired/active sessions with a
// live present-count, so a teacher can look back at earlier classes.
router.get('/history', authMiddleware, async (req, res) => {
  try {
    const now = new Date();
    const sessions = await sql`
      SELECT
        s.id, s.created_at, s.expires_at, s.is_active,
        c.name AS course_name, c.code AS course_code,
        COUNT(a.id) AS present_count
      FROM sessions s
      JOIN courses c ON c.id = s.course_id
      LEFT JOIN attendance a ON a.session_id = s.id
      WHERE s.teacher_id = ${req.user.id}
      GROUP BY s.id, c.name, c.code
      ORDER BY s.created_at DESC
      LIMIT 20
    `;

    const withStatus = sessions.map(s => ({
      ...s,
      status: (s.is_active && new Date(s.expires_at) > now)
        ? 'active'
        : (s.is_active ? 'expired' : 'closed'),
    }));

    res.json(withStatus);
  } catch (err) {
    console.error('[sessions-history]', err);
    res.status(500).json({ error: 'Could not fetch class history' });
  }
});

// GET /api/sessions/active
// Returns all currently live sessions (not expired, is_active = true)
router.get('/active', authMiddleware, async (req, res) => {
  try {
    const now = new Date();
    const sessions = await sql`
      SELECT
        s.id,
        s.expires_at,
        s.created_at,
        s.fence_radius_m,
        c.name  AS course_name,
        c.code  AS course_code,
        u.name  AS teacher_name,
        EXISTS (
          SELECT 1 FROM attendance a
          WHERE a.session_id = s.id
          AND   a.student_id = ${req.user.id}
        ) AS already_scanned
      FROM sessions s
      JOIN courses c ON c.id = s.course_id
      JOIN users   u ON u.id = s.teacher_id
      WHERE s.is_active  = true
      AND   s.expires_at > ${now}
      ORDER BY s.created_at DESC
    `;
    res.json(sessions);
  } catch (err) {
    console.error('[active-sessions]', err);
    res.status(500).json({ error: 'Could not fetch active sessions' });
  }
});

module.exports = router;