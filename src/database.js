const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { BufferJSON, initAuthCreds, proto } = require('@whiskeysockets/baileys');
const logger = require('./logger');

const DATA_DIR = path.join(__dirname, '../data');
const TIMETABLE_PATH = path.join(DATA_DIR, 'timetable.json');
const ASSIGNMENTS_PATH = path.join(DATA_DIR, 'assignments.json');
const ATTENDANCE_PATH = path.join(DATA_DIR, 'attendance.json');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const AUTH_PATH = path.join(DATA_DIR, 'baileys_auth.json');

// Ensure data folder exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * Writes data atomically to a JSON file to prevent corruption.
 */
function writeJsonAtomic(filePath, data) {
  const tempPath = filePath + '.tmp';
  try {
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tempPath, filePath);
  } catch (err) {
    logger.error(`Failed to write JSON atomically to ${filePath}:`, err);
    if (fs.existsSync(tempPath)) {
      try { fs.unlinkSync(tempPath); } catch (_) {}
    }
    throw err;
  }
}

/**
 * Reads and parses a JSON file, returning a default value on error/absence.
 */
function readJson(filePath, defaultValue = {}) {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(content);
    }
  } catch (err) {
    logger.error(`Error reading/parsing JSON file ${filePath}:`, err);
  }
  return defaultValue;
}

/**
 * Initializes the JSON database files.
 */
async function init() {
  logger.info('Initializing JSON database system...');

  // 1. Initialize timetable.json
  if (!fs.existsSync(TIMETABLE_PATH)) {
    const rootTimetablePath = path.join(__dirname, '../timetable.json');
    if (fs.existsSync(rootTimetablePath)) {
      try {
        logger.info('Seeding data/timetable.json from root timetable.json...');
        fs.copyFileSync(rootTimetablePath, TIMETABLE_PATH);
      } catch (err) {
        logger.error('Failed to copy root timetable.json to data/timetable.json:', err);
        writeJsonAtomic(TIMETABLE_PATH, {});
      }
    } else {
      logger.warn('Root timetable.json not found. Initializing empty timetable.');
      writeJsonAtomic(TIMETABLE_PATH, {});
    }
  }

  // 2. Initialize assignments.json
  if (!fs.existsSync(ASSIGNMENTS_PATH)) {
    writeJsonAtomic(ASSIGNMENTS_PATH, []);
  }

  // 3. Initialize attendance.json
  if (!fs.existsSync(ATTENDANCE_PATH)) {
    writeJsonAtomic(ATTENDANCE_PATH, []);
  }

  // 4. Initialize config.json
  if (!fs.existsSync(CONFIG_PATH)) {
    const initialConfig = {
      settings: {
        is_reminders_paused: 'false',
        thursday_class_time: process.env.THURSDAY_CLASS_TIME || '11:00 AM - 1:00 PM'
      },
      users: [],
      notes: [],
      exams: [],
      announcements: [],
      schedule_changes: []
    };
    writeJsonAtomic(CONFIG_PATH, initialConfig);
  }

  logger.info('JSON database files successfully checked/created.');
}

/**
 * Returns the weekly timetable object.
 */
async function getTimetable() {
  return readJson(TIMETABLE_PATH, {});
}

/**
 * Returns all assignments, ordered by ID descending (newest first).
 */
async function getAssignments() {
  const list = readJson(ASSIGNMENTS_PATH, []);
  return [...list].sort((a, b) => b.id - a.id);
}

/**
 * Adds a new assignment.
 */
async function addAssignment(course, title, deadline) {
  const list = readJson(ASSIGNMENTS_PATH, []);
  const nextId = list.reduce((max, item) => Math.max(max, item.id || 0), 0) + 1;
  const newItem = {
    id: nextId,
    course,
    title,
    deadline,
    created_at: new Date().toISOString()
  };
  list.push(newItem);
  writeJsonAtomic(ASSIGNMENTS_PATH, list);
  return newItem;
}

/**
 * Adds an attendance record.
 */
async function addAttendance(userJid, course, date, status = 'present') {
  const list = readJson(ATTENDANCE_PATH, []);
  const nextId = list.reduce((max, item) => Math.max(max, item.id || 0), 0) + 1;
  const newItem = {
    id: nextId,
    user_jid: userJid,
    course,
    date,
    status,
    created_at: new Date().toISOString()
  };
  list.push(newItem);
  writeJsonAtomic(ATTENDANCE_PATH, list);
  return newItem;
}

/**
 * Returns the settings map.
 */
async function getSettings() {
  const configData = readJson(CONFIG_PATH, {});
  return configData.settings || {};
}

/**
 * Saves a setting key-value pair.
 */
async function saveSetting(key, value) {
  const configData = readJson(CONFIG_PATH, {});
  if (!configData.settings) {
    configData.settings = {};
  }
  configData.settings[key] = value.toString();
  writeJsonAtomic(CONFIG_PATH, configData);
  return true;
}

/**
 * Returns list of admin JIDs.
 */
async function getAdmins() {
  const configData = readJson(CONFIG_PATH, {});
  const users = configData.users || [];
  return users.filter(u => u.role === 'admin').map(u => u.jid);
}

/**
 * Returns all notes, ordered by ID descending (newest first).
 */
async function getNotes() {
  const configData = readJson(CONFIG_PATH, {});
  const list = configData.notes || [];
  return [...list].sort((a, b) => b.id - a.id);
}

/**
 * Adds a new shared note.
 */
async function addNote(course, title, url) {
  const configData = readJson(CONFIG_PATH, {});
  if (!configData.notes) {
    configData.notes = [];
  }
  const nextId = configData.notes.reduce((max, item) => Math.max(max, item.id || 0), 0) + 1;
  const newItem = {
    id: nextId,
    course,
    title,
    url,
    created_at: new Date().toISOString()
  };
  configData.notes.push(newItem);
  writeJsonAtomic(CONFIG_PATH, configData);
  return newItem;
}

/**
 * Returns all exams, sorted by date ascending.
 */
async function getExams() {
  const configData = readJson(CONFIG_PATH, {});
  const list = configData.exams || [];
  return [...list].sort((a, b) => {
    const dateA = Date.parse(a.date);
    const dateB = Date.parse(b.date);
    if (!isNaN(dateA) && !isNaN(dateB)) {
      return dateA - dateB;
    }
    return a.id - b.id;
  });
}

/**
 * Adds a new exam schedule.
 */
async function addExam(course, date, time, venue) {
  const configData = readJson(CONFIG_PATH, {});
  if (!configData.exams) {
    configData.exams = [];
  }
  const nextId = configData.exams.reduce((max, item) => Math.max(max, item.id || 0), 0) + 1;
  const newItem = {
    id: nextId,
    course,
    date,
    time,
    venue,
    created_at: new Date().toISOString()
  };
  configData.exams.push(newItem);
  writeJsonAtomic(CONFIG_PATH, configData);
  return newItem;
}

/**
 * Adds an announcement.
 */
async function addAnnouncement(senderJid, content) {
  const configData = readJson(CONFIG_PATH, {});
  if (!configData.announcements) {
    configData.announcements = [];
  }
  const nextId = configData.announcements.reduce((max, item) => Math.max(max, item.id || 0), 0) + 1;
  const newItem = {
    id: nextId,
    sender_jid: senderJid,
    content,
    created_at: new Date().toISOString()
  };
  configData.announcements.push(newItem);
  writeJsonAtomic(CONFIG_PATH, configData);
  return newItem;
}

/**
 * Adds a schedule change record.
 */
async function addScheduleChange(day, course, originalTime, newTime) {
  const configData = readJson(CONFIG_PATH, {});
  if (!configData.schedule_changes) {
    configData.schedule_changes = [];
  }
  const nextId = configData.schedule_changes.reduce((max, item) => Math.max(max, item.id || 0), 0) + 1;
  const newItem = {
    id: nextId,
    day,
    course,
    original_time: originalTime,
    new_time: newTime,
    created_at: new Date().toISOString()
  };
  configData.schedule_changes.push(newItem);
  writeJsonAtomic(CONFIG_PATH, configData);
  return newItem;
}

/**
 * Returns a custom Baileys authentication state synced to a single JSON file.
 * On Railway (or any cloud host), if SESSION_DATA env variable is set, it loads
 * the session from there instead of the local file so it survives redeploys.
 */
async function getAuthState() {
  let authData = {
    creds: {},
    keys: {}
  };

  // --- Cloud mode: load session from split SESSION_DATA environment variables ---
  let combinedSessionData = '';
  let partIndex = 1;
  while (process.env[`SESSION_DATA_${partIndex}`]) {
    combinedSessionData += process.env[`SESSION_DATA_${partIndex}`];
    partIndex++;
  }

  // Fallback to single SESSION_DATA if it is set and fits within limits
  if (!combinedSessionData && process.env.SESSION_DATA) {
    combinedSessionData = process.env.SESSION_DATA;
  }

  if (combinedSessionData) {
    try {
      const rawBuffer = Buffer.from(combinedSessionData, 'base64');
      let decoded;
      
      // Check for gzip magic bytes (0x1f 0x8b)
      if (rawBuffer.length > 2 && rawBuffer[0] === 0x1f && rawBuffer[1] === 0x8b) {
        decoded = zlib.gunzipSync(rawBuffer).toString('utf8');
        logger.info('Loaded and decompressed Baileys authentication state from split SESSION_DATA env variables.');
      } else {
        decoded = rawBuffer.toString('utf8');
        logger.info('Loaded Baileys authentication state from SESSION_DATA.');
      }
      
      authData = JSON.parse(decoded, BufferJSON.reviver);
    } catch (err) {
      logger.error('Failed to parse SESSION_DATA, starting fresh:', err);
    }
  // --- Local mode: load session from JSON file ---
  } else if (fs.existsSync(AUTH_PATH)) {
    try {
      const fileContent = fs.readFileSync(AUTH_PATH, 'utf8');
      authData = JSON.parse(fileContent, BufferJSON.reviver);
      logger.info('Loaded Baileys authentication state from JSON database.');
    } catch (err) {
      logger.error('Failed to parse baileys_auth.json, starting fresh:', err);
    }
  } else {
    logger.info('No existing Baileys authentication state found. Starting fresh session...');
  }

  if (!authData.creds || Object.keys(authData.creds).length === 0) {
    authData.creds = initAuthCreds();
  }

  const saveState = () => {
    logger.debug('Saving Baileys authentication state to JSON database...');
    const tempPath = AUTH_PATH + '.tmp';
    try {
      fs.writeFileSync(tempPath, JSON.stringify(authData, BufferJSON.replacer, 2), 'utf8');
      fs.renameSync(tempPath, AUTH_PATH);
      logger.debug('Baileys authentication state successfully saved.');
    } catch (err) {
      logger.error('Failed to save authentication state atomically:', err);
    }
  };

  return {
    state: {
      creds: authData.creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          ids.forEach((id) => {
            let value = authData.keys[`${type}-${id}`];
            if (type === 'app-state-sync-key' && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            }
            data[id] = value;
          });
          return data;
        },
        set: async (data) => {
          let updated = false;
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              const key = `${category}-${id}`;
              if (value) {
                authData.keys[key] = value;
              } else {
                delete authData.keys[key];
              }
              updated = true;
            }
          }
          if (updated) {
            saveState();
          }
        }
      }
    },
    saveCreds: async () => {
      saveState();
    }
  };
}

module.exports = {
  init,
  getTimetable,
  getAssignments,
  addAssignment,
  addAttendance,
  getSettings,
  saveSetting,
  getAdmins,
  getNotes,
  addNote,
  getExams,
  addExam,
  addAnnouncement,
  addScheduleChange,
  getAuthState
};
