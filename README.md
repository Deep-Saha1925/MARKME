# MarkMe 📋

A QR-based attendance system for colleges. Teachers generate a QR code at the start of each class, students scan it on their phones to mark attendance — no paper, no proxies.

---

## What it does

- **Admins** manage students, teachers, and courses from a web dashboard — including bulk import via CSV or Excel
- **Teachers** log in, generate a time-limited QR code for their class session, display it on a projector, share it via link or image, and export attendance as CSV or print it
- **Students** scan the QR via camera or upload a QR image (like UPI), with GPS verification to confirm physical presence
- Attendance records are stored in a database with full history, per-course percentage tracking, and colour-coded alerts

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend |  HTML + CSS + JavaScript |
| Backend | Node.js + Express |
| Database | Neon (serverless PostgreSQL) |
| Token cache | Upstash (serverless Redis) |
| Auth | JWT (JSON Web Tokens) |
| QR generation | `qrcode` npm package |
| QR scanning | `html5-qrcode` (camera + image upload) |
| Excel parsing | SheetJS (`xlsx`) |

---

## Project structure

```
markme/
├── backend/
│   ├── routes/
│   │   ├── auth.js          → login, register, password change
│   │   ├── sessions.js      → teacher creates QR, share endpoint
│   │   ├── attendance.js    → student scans QR, history
│   │   └── admin.js         → admin manage students/teachers/courses
│   ├── middlewares/
│   │   └── auth.js          → JWT verification
│   ├── db.js                → Neon PostgreSQL connection
│   ├── redis.js             → Upstash Redis connection
│   ├── schema.sql           → full database schema
│   └── server.js            → main entry point
│
├── public/
│   ├── pages/
│   │   ├── login.html       → login for all roles
│   │   ├── admin.html       → admin dashboard
│   │   ├── dashboard.html   → teacher dashboard
│   │   ├── attendance.html  → student scanner + history
│   │   └── qr-share.html    → public QR share page
│   └── js/
│       ├── login.js
│       ├── admin.js
│       ├── dashboard.js
│       └── scanner.js
│
├── .env                     → secrets & credentials (never commit this)
└── package.json
```

---

## Database tables

| Table | Purpose |
|---|---|
| `users` | Teachers and admins |
| `students` | Student accounts (roll no, branch, year, device ID) |
| `courses` | Subjects assigned to teachers |
| `sessions` | Each QR session — token, expiry, geo-fence coords |
| `attendance` | Scan records — student, session, GPS coords, status |

---

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org) (LTS version)
- [Neon](https://neon.tech) account — free serverless PostgreSQL
- [Upstash](https://upstash.com) account — free serverless Redis
- [ngrok](https://ngrok.com) — required for GPS on mobile during local testing

### 1. Clone and install

```bash
git clone https://github.com/Deep-Saha1925/MARKME.git
cd markme
npm install
```

### 2. Set up Neon (PostgreSQL)

1. Go to [neon.tech](https://neon.tech) and create a free account
2. Create a new project called `markme`
3. Open **SQL Editor** and paste the contents of `backend/schema.sql` to create all tables

### 3. Set up Upstash (Redis)

1. Go to [upstash.com](https://upstash.com) and create a free account
2. Create a new Redis database — pick the region closest to you (Mumbai for India)
3. Copy the **REST URL** and **REST Token** from the dashboard

### 4. Seed the admin account

Run this in the Neon SQL Editor (password: `test` — change after first login):

```sql
INSERT INTO users (name, email, password, role)
VALUES (
  'Admin',
  'admin@college.edu',
  '$2b$10$wn4EDI.USv9fimkCHm1ep.gig0meLh2ehvYJbLuahzuOq3JE2S4hq',
  'admin'
);
```

To use a custom password, generate a hash first:

```bash
node -e "const b = require('bcryptjs'); b.hash('yourpassword', 10).then(console.log)"
```

### 5. Set up environment variables

Create a `.env` file in the root folder:

```env
PORT=3000
JWT_SECRET=your_secret_key_here

# Neon PostgreSQL
DATABASE_URL=postgresql://user:password@ep-xxxx.us-east-2.aws.neon.tech/markme?sslmode=require

# Upstash Redis
UPSTASH_REDIS_REST_URL=https://your-url.upstash.io
UPSTASH_REDIS_REST_TOKEN=your_token_here
```

### 6. Start the server

```bash
node backend/server.js
```

Visit `http://localhost:3000/pages/login.html` in your browser.

<!-- ### 7. Testing on mobile (GPS required)

Browsers block GPS on plain HTTP. Use ngrok to get a secure HTTPS URL:

```bash
ngrok http 3000
```

Open the `https://` URL on your phone — GPS will work normally. -->

---

## How the QR flow works

1. Teacher logs in → selects course, geo-fence radius, and QR expiry
2. Backend generates a signed token → stored in Upstash Redis with TTL
3. QR code displayed on screen — teacher can also download it as PNG or share a link
4. Student opens the app → scans via camera **or uploads a QR screenshot** (like UPI)
5. App fetches fresh GPS coordinates at scan time
6. Token + GPS sent to server — validated for expiry, duplicate scan, geo-fence distance, and device ID
7. Attendance recorded in Neon PostgreSQL
8. Teacher sees live attendance, can export as CSV or print a formatted report

---

## Security features

- QR tokens expire in 5–30 minutes (teacher configurable)
- GPS is **mandatory** — scans without location are blocked
- Each student can only scan once per session
- Device ID is bound to the student account on first scan (anti-proxy)
- Geo-fencing rejects scans outside the classroom radius (configurable: 50–500m)
- Two-layer geo validation — frontend blocks before server, server validates independently
- Passwords are hashed with bcrypt
- All routes are protected with JWT
- HTTPS required for GPS — plain HTTP shows a clear warning

---

## Features by role

### Admin
- Register students one-by-one or bulk import via CSV / Excel (.xlsx)
- Register teachers and create courses
- Bulk import teachers and courses via CSV / Excel
- View all students with pagination, sorting, and search
- Filter students by activation status (Active / Pending)
- Remove students, teachers, and courses
- Dashboard overview with live counts

### Teacher
- Generate QR code per session with configurable expiry and geo-fence radius
- Display QR on projector, download as PNG, or share via link
- View live attendance as students scan
- Export attendance as CSV (Roll No, Name, Time, Status)
- Print a formatted attendance report
- Session close button to stop scanning early

### Student
- Scan QR via phone camera
- Upload a QR image from gallery (like UPI payment)
- GPS verification at scan time — mandatory
- View attendance history per course with percentage bar
- Colour-coded attendance alerts (green ≥75%, amber ≥60%, red <60%)
- Change password from profile tab

---

## API endpoints

| Method | Endpoint | Role | Purpose |
|---|---|---|---|
| `POST` | `/api/auth/login` | All | Login |
| `POST` | `/api/auth/register/admin` | Public (once) | Create first admin |
| `POST` | `/api/auth/register/teacher` | Admin | Add teacher |
| `POST` | `/api/auth/register/student` | Admin | Add student |
| `POST` | `/api/auth/register/students/bulk` | Admin | Bulk import students |
| `POST` | `/api/auth/student/change-password` | Student | Change own password |
| `GET`  | `/api/auth/me` | Any | Get own profile |
| `POST` | `/api/sessions/generate` | Teacher | Generate QR session |
| `GET`  | `/api/sessions/my-courses` | Teacher | List assigned courses |
| `GET`  | `/api/sessions/:id/attendance` | Teacher | Live attendance list |
| `PATCH`| `/api/sessions/:id/close` | Teacher | Close session |
| `GET`  | `/api/sessions/:id/share` | Public | Share page data |
| `POST` | `/api/attendance/scan` | Student | Submit scan |
| `GET`  | `/api/attendance/history` | Student | Per-course summary |
| `GET`  | `/api/attendance/detailed-history` | Student | Individual scan records |
| `GET`  | `/api/admin/students` | Admin | List all students |
| `GET`  | `/api/admin/teachers` | Admin | List all teachers |
| `GET`  | `/api/admin/courses` | Admin | List all courses |
| `POST` | `/api/admin/courses` | Admin | Add course |
| `DELETE`| `/api/admin/students/:id` | Admin | Remove student |
| `DELETE`| `/api/admin/teachers/:id` | Admin | Remove teacher |
| `DELETE`| `/api/admin/courses/:id` | Admin | Remove course |

---

## Roadmap

- [x] Project setup + folder structure
- [x] Database schema (Neon)
- [x] Redis token store (Upstash)
- [x] Login for all roles (admin, teacher, student)
- [x] Admin dashboard — student, teacher, course management
- [x] Bulk import via CSV and Excel
- [x] Teacher dashboard — QR generation with geo-fence
- [x] Live attendance polling
- [x] QR download + shareable link
- [x] Student scanner — camera scan
- [x] Student scanner — QR image upload (like UPI)
- [x] GPS verification — mandatory, fresh at scan time
- [x] HTTPS detection + clear error messages
- [x] Device binding — anti-proxy
- [x] Attendance history with % and colour-coded bars
- [x] Change password from profile
- [x] Export attendance as CSV
- [x] Print attendance report
- [ ] Email notifications for low attendance
- [ ] Admin attendance reports across all sessions
- [ ] Deployment (Railway + Vercel)

---

## Built with ❤️ for college attendance management

## AUTHOR
DEEP SAHA