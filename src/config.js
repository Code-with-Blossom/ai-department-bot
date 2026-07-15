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
    const dbSettings = await db.getSettings();

    // Query admin users
    const dbAdminJids = await db.getAdmins();

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

    logger.info('Successfully loaded configuration from JSON database.');
  } catch (error) {
    logger.error('Failed to load configuration from JSON database, falling back to environment defaults.', error);
    loadedConfig = { ...defaultConfig };
  }

  return loadedConfig;
}

/**
 * Saves a setting key-value pair asynchronously to settings config and updates the in-memory cache.
 */
async function saveSetting(key, value) {
  try {
    await db.saveSetting(key, value);
    return true;
  } catch (error) {
    logger.error(`Failed to save settings key "${key}" to JSON:`, error);
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
