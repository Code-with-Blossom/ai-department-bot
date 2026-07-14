const logger = require('./logger');
const db = require('./database');

// Load variables from .env
require('dotenv').config();

const defaultConfig = {
  groupJid: process.env.GROUP_JID || '',
  adminJids: (process.env.ADMIN_JIDS || '').split(',').map(j => j.trim()).filter(Boolean),
  timezone: process.env.TZ || 'Africa/Lagos',
  thursdayClassTime: process.env.THURSDAY_CLASS_TIME || '11:00 AM - 1:00 PM',
  isRemindersPaused: false
};

let loadedConfig = { ...defaultConfig };

/**
 * Loads configuration from SQLite database and merges with environment variables.
 */
async function loadConfigFromDb() {
  const envGroupJid = process.env.GROUP_JID || '';
  const envAdminJids = (process.env.ADMIN_JIDS || '').split(',').map(j => j.trim()).filter(Boolean);
  const envTimezone = process.env.TZ || 'Africa/Lagos';
  const envThursdayTime = process.env.THURSDAY_CLASS_TIME || '11:00 AM - 1:00 PM';

  try {
    // Query all settings key-values
    const settingsRows = await db.dbQueryAll('SELECT key, value FROM settings');
    const dbSettings = {};
    settingsRows.forEach(row => {
      dbSettings[row.key] = row.value;
    });

    // Query admin users from users table
    const adminRows = await db.dbQueryAll("SELECT jid FROM users WHERE role = 'admin'");
    const dbAdminJids = adminRows.map(r => r.jid);

    // Merge environmental admins with database-defined admins
    const combinedAdminJids = Array.from(new Set([
      ...dbAdminJids,
      ...envAdminJids
    ]));

    loadedConfig = {
      groupJid: envGroupJid, // Keep JID static from environment for security
      adminJids: combinedAdminJids,
      timezone: envTimezone,
      thursdayClassTime: dbSettings['thursday_class_time'] || envThursdayTime,
      isRemindersPaused: dbSettings['is_reminders_paused'] === 'true'
    };

    logger.info('Successfully loaded configuration from SQLite database.');
  } catch (error) {
    logger.error('Failed to load configuration from SQLite database, falling back to environment defaults.', error);
    loadedConfig = { ...defaultConfig };
  }

  return loadedConfig;
}

/**
 * Saves a setting key-value pair asynchronously to settings table and updates the in-memory cache.
 */
async function saveSetting(key, value) {
  try {
    await db.dbQueryRun(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, value.toString()]
    );
    return true;
  } catch (error) {
    logger.error(`Failed to save settings key "${key}" to SQLite:`, error);
    return false;
  }
}

module.exports = {
  get: () => loadedConfig,
  load: loadConfigFromDb,
  
  /**
   * Sets reminder time for Thursday override
   * @param {string} day 
   * @param {string} time 
   */
  setReminderTime: async (day, time) => {
    const normDay = day.toLowerCase();
    if (normDay === 'all' || normDay === 'thursday') {
      logger.info(`Setting Thursday class time override in DB to ${time}`);
      loadedConfig.thursdayClassTime = time;
      return await saveSetting('thursday_class_time', time);
    } else {
      logger.warn(`SetOverride skipped: Setting schedules overrides for individual weekdays like "${day}" is handled in timetable database.`);
      return false;
    }
  },

  /**
   * Toggles the paused state of automatic reminder messages
   * @param {boolean} isPaused 
   */
  setRemindersPaused: async (isPaused) => {
    logger.info(`Reminders paused state set in DB to: ${isPaused}`);
    loadedConfig.isRemindersPaused = isPaused;
    return await saveSetting('is_reminders_paused', isPaused ? 'true' : 'false');
  }
};
