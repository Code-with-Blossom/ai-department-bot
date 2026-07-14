# 🤖 AI Department Assistant Bot

A production-ready WhatsApp Business group assistant bot designed specifically for managing and broadcasting academic timetables, announcement delivery, and department student engagement. 

All settings, timetable data, announcements, and classroom records are backed by a local **SQLite database** stored in `./data/ai_department.db`.

---

## 💾 SQLite Database Integration

The application has migrated from JSON file storage to SQLite using the `sqlite3` driver. The database file is located at `./data/ai_department.db`.

### 📊 Table Schema Specifications
The database automatically initializes the following tables upon boot:

1.  **`users`**: Student register with fields `id`, `jid` (unique), `name`, `role` (e.g. `'admin'`, `'student'`), and `created_at`.
2.  **`notes`**: Slide slide/resource URLs shared with the class: `id`, `course`, `title`, `url`, `created_at`.
3.  **`assignments`**: Deadline manager: `id`, `course`, `title`, `deadline`, `created_at`.
4.  **`exams`**: Department exam roster: `id`, `course`, `date`, `time`, `venue`, `created_at`.
5.  **`attendance`**: Log checks for lectures: `id`, `user_jid`, `course`, `date`, `status`, `created_at`.
6.  **`announcements`**: History of broadcasted announcements: `id`, `sender_jid`, `content`, `created_at`.
7.  **`schedule_changes`**: Timetable overrides history log: `id`, `day`, `course`, `original_time`, `new_time`, `created_at`.
8.  **`timetable`**: Centralized weekly course timetable: `id`, `day`, `course`, `time`.
9.  **`settings`**: Key-value settings repository replacing `config.json` (stores reminders status and overrides).

### ⚙️ Automatic Data Migration (Seeding)
On the first run:
- The bot detects if the `timetable` table is empty. If empty, it reads `timetable.json` and imports all classes automatically.
- Seeding configuration settings (like `is_reminders_paused` and `thursday_class_time`) takes place automatically.

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
Because SQLite uses local file storage, containerized cloud environments (Render/Railway) will reset the database on restarts. 
To prevent data loss:
- **Mount a Persistent Disk/Volume** to the `./data` directory (Mount Path: `/app/data` if your root is `/app`).
- Keep your `auth_info/` directory persisted on the volume as well to maintain WhatsApp session logins.
