const express = require('express');
const sql = require('../db');
const redis = require('../redis');
const authMiddleware = require('../middlewares/auth');

const router = express.Router();

// ── Haversine distance formula ───────────────
function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── POST /api/attendance/scan ─────────────────
router.post('/scan', authMiddleware, async (req, res) => {
  const { token, device_id, lat, lng } = req.body;
  const studentId = req.user.id;

  if (!token) {
    return res.status(400).json({ error: 'QR token is required' });
  }

  try {
    // 1. Check token exists in Redis (not expired)
    const sessionId = await redis.get(`qr:${token}`);
    if (!sessionId) {
      return res.status(400).json({ error: 'QR code has expired. Ask your teacher for a new one.' });
    }

    // 2. Fetch session details from PostgreSQL
    const sessions = await sql`
      SELECT s.*, c.name AS course_name
      FROM sessions s
      JOIN courses c ON c.id = s.course_id
      WHERE s.id = ${sessionId} AND s.is_active = true
    `;
    if (!sessions.length) {
      return res.status(400).json({ error: 'Session is no longer active.' });
    }
    const session = sessions[0];

    // 3. Check student hasn't already scanned this session
    const existing = await sql`
      SELECT id FROM attendance
      WHERE session_id = ${session.id} AND student_id = ${studentId}
    `;
    if (existing.length) {
      return res.status(400).json({ error: 'You have already marked attendance for this session.' });
    }

    // 4. Geo-fence check (only if session has coordinates)
    if (session.classroom_lat && session.classroom_lng && lat && lng) {
      const distance = haversineDistance(
        session.classroom_lat, session.classroom_lng,
        parseFloat(lat), parseFloat(lng)
      );
      if (distance > session.fence_radius_m) {
        return res.status(403).json({
          error: `You are ${Math.round(distance)}m away from the classroom. Must be within ${session.fence_radius_m}m.`
        });
      }
    }

    // 5. Bind device ID on first scan (anti-proxy)
    if (device_id) {
      const student = await sql`SELECT device_id FROM students WHERE id = ${studentId}`;
      if (!student[0].device_id) {
        await sql`UPDATE students SET device_id = ${device_id} WHERE id = ${studentId}`;
      } else if (student[0].device_id !== device_id) {
        return res.status(403).json({ error: 'Attendance can only be marked from your registered device.' });
      }
    }

    // 6. Record attendance
    await sql`
      INSERT INTO attendance (session_id, student_id, lat, lng, status)
      VALUES (${session.id}, ${studentId}, ${lat || null}, ${lng || null}, 'present')
    `;

    res.json({
      success:     true,
      course_name: session.course_name,
      scanned_at:  new Date().toISOString(),
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/attendance/history ───────────────
router.get('/history', authMiddleware, async (req, res) => {
  try {
    const records = await sql`
      SELECT
        c.name        AS course_name,
        c.code        AS course_code,
        COUNT(a.id)   AS attended,
        COUNT(se.id)  AS total_sessions,
        ROUND(
          COUNT(a.id) * 100.0 / NULLIF(COUNT(se.id), 0), 1
        )             AS percentage
      FROM courses c
      JOIN sessions se ON se.course_id = c.id
      LEFT JOIN attendance a
        ON a.session_id = se.id AND a.student_id = ${req.user.id}
      GROUP BY c.id, c.name, c.code
      ORDER BY c.name
    `;
    res.json(records);
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch history' });
  }
});

router.get('/detailed-history', authMiddleware, async (req, res) => {
  try {
    const records = await sql`
      SELECT
        a.id,
        a.scanned_at,
        a.status,
        c.name  AS course_name,
        c.code  AS course_code
      FROM attendance a
      JOIN sessions se ON se.id = a.session_id
      JOIN courses  c  ON c.id  = se.course_id
      WHERE a.student_id = ${req.user.id}
      ORDER BY a.scanned_at DESC
      LIMIT 100
    `;
    res.json(records);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not fetch history' });
  }
});

module.exports = router;