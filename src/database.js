const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const DATA_DIR = path.join(__dirname, '../data');
const DB_PATH = path.join(DATA_DIR, 'ai_department.db');

// Ensure data folder exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Establish DB connection
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    logger.error('Failed to connect to SQLite database:', err);
  } else {
    logger.info(`Connected to SQLite database at: ${DB_PATH}`);
  }
});

/**
 * Executes a run query (INSERT/UPDATE/DELETE) wrapped in a Promise
 */
function dbQueryRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) {
        logger.error(`Database Error on SQL Run: "${sql}"`, err);
        reject(err);
      } else {
        resolve({ lastID: this.lastID, changes: this.changes });
      }
    });
  });
}

/**
 * Executes a single-row SELECT query wrapped in a Promise
 */
function dbQueryGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        logger.error(`Database Error on SQL Get: "${sql}"`, err);
        reject(err);
      } else {
        resolve(row);
      }
    });
  });
}

/**
 * Executes a multi-row SELECT query wrapped in a Promise
 */
function dbQueryAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        logger.error(`Database Error on SQL All: "${sql}"`, err);
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
}

/**
 * Auto-creates all required tables and seeds timetable if empty
 */
async function init() {
  logger.info('Initializing SQLite database schema...');

  // 1. Users table
  await dbQueryRun(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      jid TEXT UNIQUE NOT NULL,
      name TEXT,
      role TEXT NOT NULL DEFAULT 'student',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 2. Notes table
  await dbQueryRun(`
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course TEXT NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 3. Assignments table
  await dbQueryRun(`
    CREATE TABLE IF NOT EXISTS assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course TEXT NOT NULL,
      title TEXT NOT NULL,
      deadline TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 4. Exams table
  await dbQueryRun(`
    CREATE TABLE IF NOT EXISTS exams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course TEXT NOT NULL,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      venue TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 5. Attendance table
  await dbQueryRun(`
    CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_jid TEXT NOT NULL,
      course TEXT NOT NULL,
      date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'present',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 6. Announcements table
  await dbQueryRun(`
    CREATE TABLE IF NOT EXISTS announcements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_jid TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 7. Schedule Changes table
  await dbQueryRun(`
    CREATE TABLE IF NOT EXISTS schedule_changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day TEXT NOT NULL,
      course TEXT NOT NULL,
      original_time TEXT NOT NULL,
      new_time TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 8. Timetable table (Centralized timetable database)
  await dbQueryRun(`
    CREATE TABLE IF NOT EXISTS timetable (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day TEXT NOT NULL,
      course TEXT NOT NULL,
      time TEXT NOT NULL
    );
  `);

  // 9. Key-value Settings table
  await dbQueryRun(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  logger.info('Database tables successfully checked/created.');

  // 10. Automatically seed timetable table from timetable.json if empty
  const timetableCount = await dbQueryGet('SELECT COUNT(*) as count FROM timetable');
  if (timetableCount.count === 0) {
    const timetableJsonPath = path.join(__dirname, '../timetable.json');
    if (fs.existsSync(timetableJsonPath)) {
      try {
        logger.info('Timetable table is empty. Seeding from timetable.json...');
        const fileContent = fs.readFileSync(timetableJsonPath, 'utf8');
        const timetableData = JSON.parse(fileContent);

        for (const [day, classes] of Object.entries(timetableData)) {
          for (const item of classes) {
            await dbQueryRun(
              'INSERT INTO timetable (day, course, time) VALUES (?, ?, ?)',
              [day, item.course, item.time]
            );
          }
        }
        logger.info('Timetable table seeded successfully.');
      } catch (err) {
        logger.error('Failed to seed timetable table from JSON file:', err);
      }
    } else {
      logger.warn('timetable.json not found. Could not seed database timetable.');
    }
  }

  // 11. Automatically seed settings table with initial defaults if empty
  const settingsCount = await dbQueryGet('SELECT COUNT(*) as count FROM settings');
  if (settingsCount.count === 0) {
    logger.info('Settings table is empty. Seeding defaults...');
    await dbQueryRun('INSERT INTO settings (key, value) VALUES (?, ?)', ['is_reminders_paused', 'false']);
    await dbQueryRun('INSERT INTO settings (key, value) VALUES (?, ?)', ['thursday_class_time', process.env.THURSDAY_CLASS_TIME || '11:00 AM - 1:00 PM']);
    logger.info('Settings defaults seeded successfully.');
  }
}

module.exports = {
  init,
  dbQueryRun,
  dbQueryGet,
  dbQueryAll,
  dbInstance: db
};
