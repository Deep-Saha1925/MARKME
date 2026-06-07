const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
    res.json({ message: 'Sessions route working' });
});

module.exports = router;