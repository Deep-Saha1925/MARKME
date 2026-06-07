# MarkMe 📋

A QR-based attendance system for colleges. Teachers generate a QR code at the start of each class, students scan it on their phones to mark attendance — no paper, no proxies.

---

## What it does

- **Teachers** log in, generate a time-limited QR code for their class session, and display it on a projector
- **Students** open the app on their phone, scan the QR, and attendance is marked instantly
- **Admins** manage students, teachers, and courses from a web dashboard
- Attendance records are stored in a database and can be exported as CSV or PDF

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Plain HTML + CSS + JavaScript |
| Backend | Node.js + Express |
| Database | PostgreSQL |
| Token cache | Redis |
| Auth | JWT (JSON Web Tokens) |
| QR generation | `qrcode` npm package |

---

## Project structure

```
markme/
├── backend/
│   ├── routes/
│   │   ├── auth.js          → login & register
│   │   ├── sessions.js      → teacher creates QR session
│   │   └── attendance.js    → student scans QR
│   ├── middleware/
│   │   └── auth.js          → JWT verification
│   ├── db.js                → PostgreSQL connection
│   └── server.js            → main entry point
│
├── public/
│   ├── pages/
│   │   ├── login.html
│   │   ├── dashboard.html
│   │   ├── qr-display.html
│   │   └── attendance.html
│   ├── css/
│   │   └── style.css
│   └── js/
│       ├── login.js
│       ├── dashboard.js
│       └── scanner.js
│
├── .env                     → secrets & DB credentials (never commit this)
└── package.json
```

---

## Database tables

| Table | Purpose |
|---|---|
| `users` | Teachers and admins |
| `students` | Student accounts (roll no, branch, year) |
| `courses` | Subjects assigned to teachers |
| `sessions` | Each QR session a teacher creates |
| `attendance` | Scan records per student per session |

---

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org) (LTS version)
- [PostgreSQL](https://www.postgresql.org)
- [Redis](https://redis.io)

### 1. Clone and install

```bash
git clone https://github.com/yourusername/markme.git
cd markme
npm install
```

### 2. Set up environment variables

Create a `.env` file in the root folder:

```env
PORT=3000
JWT_SECRET=your_secret_key_here
DATABASE_URL=postgresql://postgres:yourpassword@localhost:5432/markme
REDIS_URL=redis://localhost:6379
```

### 3. Set up the database

Open PostgreSQL and run:

```sql
CREATE DATABASE markme;
```

Then run the full schema from `backend/db.sql` to create all tables.

### 4. Start the server

```bash
node backend/server.js
```

Visit `http://localhost:3000` in your browser.

---

## How the QR flow works

1. Teacher logs in and selects a course session
2. Backend generates a signed token and stores it in Redis with a 10-minute expiry
3. A QR code is generated from the token and displayed on screen
4. Student opens the app, scans the QR — app sends token + location to the server
5. Server validates: token not expired, student not already scanned, location within geo-fence
6. Attendance is recorded in PostgreSQL

---

## Security features

- QR tokens expire in 5–10 minutes
- Each student can only scan once per session
- Device ID is bound to the student account on first login
- Geo-fencing rejects scans from outside the classroom radius
- Passwords are hashed with bcrypt
- All routes are protected with JWT

---

## Roadmap

- [x] Project setup
- [x] Database schema
- [x] Folder structure
- [ ] Login API + login page
- [ ] Teacher dashboard
- [ ] QR generation
- [ ] Student scanner page
- [ ] Geo-fence validation
- [ ] Attendance history
- [ ] Admin panel + CSV export

---

## Built with ❤️ for college attendance management