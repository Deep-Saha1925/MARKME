const jwt = require('jsonwebtoken');
require('dotenv').config();

module.exports = (req, res, next) => {
  const header = req.headers['authorization'];
  const token = header && header.split(' ')[1]; // "Bearer <token>"

  if (!token) return res.status(401).json({ error: 'No token provided' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { id, email, role }
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};