const { neon } = require('@neondatabase/serverless');
const path = require('path');

require('dotenv').config({
  path: path.join(__dirname, '../.env')
});

const sql = neon(process.env.DATABASE_URL);

module.exports = sql;