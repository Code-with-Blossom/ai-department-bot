# 🤖 AI Department Assistant Bot

A production-ready WhatsApp Business group assistant bot designed specifically for managing and broadcasting academic timetables, announcement delivery, and department student engagement. 

All settings, timetable data, announcements, and classroom records are backed by local **JSON database files** stored in `./data/`.

---

## 💾 JSON Database Integration

The application uses local JSON files for persistent data storage. The files are located in the `./data` directory:

1.  **`timetable.json`**: Centralized weekly course timetable. Automatically seeded from the root `timetable.json` on the first run.
2.  **`assignments.json`**: List of class assignments with deadlines, titles, and creation dates.
3.  **`attendance.json`**: Lagos-timezone check-in history records mapping student JIDs to courses and dates.
4.  **`config.json`**: Stores system settings (reminders paused, overrides), admin profiles, shared notes/links, exam schedules, official announcements history, and schedule override logs.

### ⚙️ Automatic Data Seeding
On the first run:
- The bot detects if `data/timetable.json` is missing. If missing, it copies the default `timetable.json` from the root directory.
- It initializes default values inside `data/config.json`, `data/assignments.json`, and `data/attendance.json` if they do not exist.

---

## 🎮 Student & Admin Commands

The assistant processes commands inside groups and private messages.

| Command | Permission | Description | Example |
| :--- | :--- | :--- | :--- |
| `/help` | Everyone | Displays the help menu with all commands. | `/help` |
| `/today` | Everyone | Queries SQLite and prints today's classes. | `/today` |
| `/tomorrow` | Everyone | Queries SQLite and prints tomorrow's classes. | `/tomorrow` |
| `/schedule` | Everyone | Queries SQLite and prints full weekly timetable. | `/schedule` |
| `/test` | Everyone | Check if the AI Assistant is online. | `/test` |
| `/groupid` | Everyone | Prints the current Group JID for `.env` setup. | `/groupid` |
| `/assignments` | Everyone | Lists upcoming assignments from database. | `/assignments` |
| `/notes` | Everyone | Lists shared note links from database. | `/notes` |
| `/exams` | Everyone | Lists exam timetables from database. | `/exams` |
| `/attendance checkin <Course>` | Everyone | Logs attendance presence into SQLite. | `/attendance checkin AIT 323` |
| `/announcement <msg>` | Admin Only | Formats, logs, and broadcasts an announcement to the group. | `/announcement Exam tomorrow!` |
| `/change Thursday <time>` | Admin Only | Update Thursday class time override (e.g. `11:00 AM - 1:00 PM`). | `/change Thursday 11:00 AM - 1:00 PM` |
| `/cancel` | Admin Only | Toggles pause/resume on class reminders. | `/cancel` |

### 🛠️ Adding SQLite Timetable Data via Chat
You can easily populate your database tables directly via the following commands:
*   **Add Assignment**: `/assignment add <course> | <title> | <deadline>`
    *   *Example:* `/assignment add AIT 323 | Neural Networks Lab | Monday 2:00 PM`
*   **Add Lecture Note**: `/notes add <course> | <title> | <link>`
    *   *Example:* `/notes add AIT 321 | Practical Guide PDF | https://google.com/...`
*   **Add Exam Timetable**: `/exam add <course> | <date> | <time> | <venue>`
    *   *Example:* `/exam add AIT 325 | Oct 12, 2026 | 9:00 AM | Lecture Room 2`

## 📚 PDF Library Feature

The bot includes a PDF library feature. When a student requests a course's lecture notes or slides, the bot automatically searches the `./pdfs/` folder for a matching PDF and sends it directly as a document.

### Supported Courses
*   `AIT321`
*   `AIT323`
*   `AIT324`
*   `AIT325`
*   `AIT326`
*   `AIT327`
*   `EED`
*   `GNS302`

### Request Commands (Case-insensitive)
Students can send any of the following queries:
*   `/pdf AIT323`
*   `/note AIT323`
*   `AIT323 PDF`
*   `pdf ait323`
*   `notes ait323`
*   `lecture note ait323`

If a file exists (e.g., `./pdfs/ait323.pdf`), it is uploaded. If not, the bot replies: `"❌ Sorry, no lecture note is available yet for this course."`

---

## 🚀 Local Quick Start

### 1. Install Dependencies
Run the command:
```bash
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Fill out the parameters inside `.env`:
*   `GROUP_JID`: The ID of the WhatsApp group where class reminders are sent.
*   `TZ`: Must be set to `Africa/Lagos` for correct scheduling offsets.
*   `ADMIN_JIDS`: Comma-separated list of admin phone numbers (e.g. `23480xxxxxxxx@s.whatsapp.net`).
*   `THURSDAY_CLASS_TIME`: Thursday session fallback time (e.g. `11:00 AM - 1:00 PM`).

### 3. Launch Bot & Authenticate
Run the command:
```bash
npm start
```
Scan the rendered QR Code printed on the terminal using WhatsApp **Linked Devices**.

---

## 🌐 Cloud Deployment Guide

### 💾 Database Persistence (Critical)
Because JSON database files use local file storage, containerized cloud environments (Render/Railway) will reset the database on restarts. 
To prevent data loss:
- **Mount a Persistent Disk/Volume** to the `./data` directory (Mount Path: `/app/data` if your root is `/app`). Since all database tables and session credentials/keys (`data/baileys_auth.json`) are stored within the `./data` directory, mounting this single folder is sufficient to persist everything across redeploys and restarts.
