const fs = require('fs');
const path = require('path');

const LOGS_DIR = path.join(__dirname, '../logs');
const LOG_FILE = path.join(LOGS_DIR, 'bot.log');

// Ensure logs directory exists
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

function getTimestamp() {
  return new Date().toISOString();
}

function formatMsg(level, message, meta) {
  const metaStr = meta ? ` | ${meta instanceof Error ? meta.stack : JSON.stringify(meta)}` : '';
  return `[${getTimestamp()}] [${level.toUpperCase()}] ${message}${metaStr}`;
}

function writeToFile(line) {
  try {
    fs.appendFileSync(LOG_FILE, line + '\n', 'utf8');
  } catch (err) {
    console.error('Failed to write log to file:', err);
  }
}

const logger = {
  info: (message, meta) => {
    const formatted = formatMsg('info', message, meta);
    console.log(`\x1b[32m${formatted}\x1b[0m`); // Green text
    writeToFile(formatted);
  },
  warn: (message, meta) => {
    const formatted = formatMsg('warn', message, meta);
    console.warn(`\x1b[33m${formatted}\x1b[0m`); // Yellow text
    writeToFile(formatted);
  },
  error: (message, meta) => {
    const formatted = formatMsg('error', message, meta);
    console.error(`\x1b[31m${formatted}\x1b[0m`); // Red text
    writeToFile(formatted);
  },
  debug: (message, meta) => {
    const formatted = formatMsg('debug', message, meta);
    console.log(`\x1b[36m${formatted}\x1b[0m`); // Cyan text
    writeToFile(formatted);
  }
};

module.exports = logger;
