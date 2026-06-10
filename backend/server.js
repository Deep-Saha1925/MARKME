const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();

app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname, '../public')));

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/pages/login.html'));
});
app.use('/api/auth',       require('./routes/auth.js'));
app.use('/api/sessions',   require('./routes/sessions.js'));
app.use('/api/attendance', require('./routes/attendance.js'));
app.use('/api/admin',      require('./routes/admin'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`MarkMe server running on http://localhost:${PORT}`);
});