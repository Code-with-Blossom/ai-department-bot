const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { BufferJSON, initAuthCreds, proto } = require('@whiskeysockets/baileys');
const logger = require('./logger');

const DATA_DIR = path.join(__dirname, '../data');
const AUTH_PATH = path.join(DATA_DIR, 'baileys_auth.json');
const BACKUP_PATH = path.join(DATA_DIR, 'baileys_auth_backup.json');

// Ensure data folder exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * SessionManager handles session persistence, backups, corruption recovery,
 * and loading credentials from environment variables or local disk.
 */

function verifySessionData(sessionString) {
  if (!sessionString || typeof sessionString !== 'string' || sessionString.trim() === '') {
    return { valid: false, reason: 'SESSION_DATA string is empty or missing.', creds: null };
  }

  try {
    const rawBuffer = Buffer.from(sessionString.trim(), 'base64');
    if (rawBuffer.length < 10) {
      return { valid: false, reason: 'Decoded buffer is too short — payload is corrupted or truncated.', creds: null };
    }

    let decoded;
    if (rawBuffer[0] === 0x1f && rawBuffer[1] === 0x8b) {
      decoded = zlib.gunzipSync(rawBuffer).toString('utf8');
    } else {
      decoded = rawBuffer.toString('utf8');
    }

    const parsed = JSON.parse(decoded, BufferJSON.reviver);

    if (!parsed || typeof parsed !== 'object') {
      return { valid: false, reason: 'Parsed SESSION_DATA is not a valid JSON object.', creds: null };
    }
    if (!parsed.creds || Object.keys(parsed.creds).length === 0) {
      return { valid: false, reason: 'SESSION_DATA has no credentials (creds is empty).', creds: null };
    }
    if (!parsed.creds.me) {
      return { valid: false, reason: 'SESSION_DATA credentials are unregistered (creds.me is undefined).', creds: parsed.creds };
    }

    return { valid: true, reason: `Credentials registered for: ${parsed.creds.me.id}`, creds: parsed.creds };
  } catch (err) {
    return { valid: false, reason: `Failed to parse SESSION_DATA: ${err.message}`, creds: null };
  }
}

/**
 * Creates an automatic backup of the current auth state.
 */
function createBackup(authData) {
  try {
    const backupTemp = BACKUP_PATH + '.tmp';
    fs.writeFileSync(backupTemp, JSON.stringify(authData, BufferJSON.replacer, 2), 'utf8');
    fs.renameSync(backupTemp, BACKUP_PATH);
    logger.debug('Session backup successfully created.');
  } catch (err) {
    logger.warn('Failed to create session backup:', err.message);
  }
}

/**
 * Attempts to recover auth state from backup if main file is corrupted.
 */
function recoverFromBackup() {
  if (!fs.existsSync(BACKUP_PATH)) {
    return null;
  }
  try {
    logger.warn('Attempting session recovery from backup file...');
    const fileContent = fs.readFileSync(BACKUP_PATH, 'utf8');
    const authData = JSON.parse(fileContent, BufferJSON.reviver);
    if (authData && authData.creds && authData.creds.me) {
      logger.info('Successfully recovered session from backup file.');
      return authData;
    }
  } catch (err) {
    logger.error('Failed to recover session from backup file:', err.message);
  }
  return null;
}

/**
 * Returns Baileys authentication state synced to local file and backup.
 */
async function getAuthState() {
  let authData = {
    creds: {},
    keys: {}
  };
  let authSource = 'none';

  logger.info('[SessionManager] Initializing authentication state...');

  // 1. Check for SESSION_DATA env var (cloud host mode)
  let combinedSessionData = '';
  let partIndex = 1;
  while (process.env[`SESSION_DATA_${partIndex}`]) {
    combinedSessionData += process.env[`SESSION_DATA_${partIndex}`];
    partIndex++;
  }
  if (!combinedSessionData && process.env.SESSION_DATA) {
    combinedSessionData = process.env.SESSION_DATA;
  }

  if (combinedSessionData) {
    try {
      const rawBuffer = Buffer.from(combinedSessionData.trim(), 'base64');
      let decoded;
      if (rawBuffer.length > 2 && rawBuffer[0] === 0x1f && rawBuffer[1] === 0x8b) {
        decoded = zlib.gunzipSync(rawBuffer).toString('utf8');
        logger.info('[SessionManager] Loaded gzip-compressed SESSION_DATA from environment.');
      } else {
        decoded = rawBuffer.toString('utf8');
        logger.info('[SessionManager] Loaded plain Base64 SESSION_DATA from environment.');
      }

      authData = JSON.parse(decoded, BufferJSON.reviver);
      authSource = 'SESSION_DATA';

      // Persist to local disk as runtime backup
      try {
        const tempPath = AUTH_PATH + '.tmp';
        fs.writeFileSync(tempPath, decoded, 'utf8');
        fs.renameSync(tempPath, AUTH_PATH);
      } catch (_) {}
    } catch (err) {
      logger.error('[SessionManager] Failed to parse SESSION_DATA:', err.message);
    }
  }

  // 2. Check local disk auth file if SESSION_DATA is not set or failed
  if (authSource === 'none' && fs.existsSync(AUTH_PATH)) {
    try {
      const fileContent = fs.readFileSync(AUTH_PATH, 'utf8');
      authData = JSON.parse(fileContent, BufferJSON.reviver);
      authSource = 'local_file';
      logger.info(`[SessionManager] Session loaded successfully from disk (${AUTH_PATH}).`);
    } catch (err) {
      logger.error(`[SessionManager] Main auth file corrupted. Trying recovery... Error: ${err.message}`);
      const recovered = recoverFromBackup();
      if (recovered) {
        authData = recovered;
        authSource = 'backup_file';
      }
    }
  }

  if (authSource === 'none') {
    logger.info('[SessionManager] No existing valid session found. Preparing fresh session...');
  }

  const credsEmpty = !authData.creds || Object.keys(authData.creds).length === 0;
  const credsRegistered = !credsEmpty && !!authData.creds.me;

  if (credsEmpty) {
    authData.creds = initAuthCreds();
  }

  if (credsRegistered) {
    logger.info(`[SessionManager] Valid session verified. Logged-in user JID: ${authData.creds.me.id}`);
  } else {
    logger.warn('[SessionManager] Credentials are not yet registered with a WhatsApp account.');
  }

  const saveState = () => {
    logger.debug('[SessionManager] Saving credentials update...');
    const tempPath = AUTH_PATH + '.tmp';
    try {
      fs.writeFileSync(tempPath, JSON.stringify(authData, BufferJSON.replacer, 2), 'utf8');
      fs.renameSync(tempPath, AUTH_PATH);
      logger.debug('Session saved successfully.');
      createBackup(authData);
    } catch (err) {
      logger.error('Failed to save session state:', err.message);
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

/**
 * Exports active local session into compressed Base64 string.
 */
function exportSessionData() {
  if (!fs.existsSync(AUTH_PATH)) {
    console.error('❌ Error: No local auth file found at data/baileys_auth.json.');
    return;
  }

  try {
    const rawContent = fs.readFileSync(AUTH_PATH, 'utf8');
    const compressed = zlib.gzipSync(Buffer.from(rawContent, 'utf8'));
    const base64Str = compressed.toString('base64');
    
    console.log('\n================================================================================');
    console.log('🔑 PRODUCTION SESSION_DATA EXPORT SUCCESSFUL!');
    console.log('================================================================================\n');
    console.log('Copy the string below and paste it as SESSION_DATA in Railway Environment Variables:\n');
    console.log(`SESSION_DATA=${base64Str}\n`);
    console.log('================================================================================\n');
  } catch (err) {
    console.error('❌ Error exporting session data:', err.message);
  }
}

module.exports = {
  getAuthState,
  exportSessionData,
  verifySessionData
};
