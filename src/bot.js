const { default: makeWASocket, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const { Boom } = require('@hapi/boom');
const http = require('http');
const fs = require('fs');
const path = require('path');

const logger = require('./logger');
const config = require('./config');
const commands = require('./commands');
const scheduler = require('./scheduler');
const database = require('./database');

let sock = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 15;

// Network error codes/messages that mean internet is temporarily down.
// These should retry indefinitely rather than counting toward the exit limit.
const NETWORK_ERROR_PATTERNS = [
  'ENOTFOUND',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'getaddrinfo',
  'Opening handshake has timed out',
  'Connection was lost'
];

/**
 * Returns true if the error is a temporary network/internet outage.
 * These errors should not count against the reconnect limit.
 */
function isNetworkOutageError(errorMessage) {
  if (!errorMessage) return false;
  return NETWORK_ERROR_PATTERNS.some(pattern =>
    errorMessage.toLowerCase().includes(pattern.toLowerCase())
  );
}
let healthCheckServer = null;

/**
 * Normalizes user/bot ID to clean JID format
 */
function cleanJid(id) {
  if (!id) return '';
  return id.split(':')[0] + '@s.whatsapp.net';
}

/**
 * Connects to WhatsApp using Baileys multi-file authentication state.
 */
async function connectToWhatsApp() {
  const { state, saveCreds } = await database.getAuthState();

  logger.info('Initializing WhatsApp connection...');

  sock = makeWASocket({
    logger: pino({ level: 'silent' }), // Suppress internal Baileys logger outputs to clean CLI
    auth: state,
    printQRInTerminal: false // We handle rendering QR manually to log it cleanly
  });

  // Attach credential updater
  sock.ev.on('creds.update', saveCreds);

  // Connection events listener
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    // 1. Render QR Code if provided
    if (qr) {
      logger.info('New authentication QR Code generated! Scan it with WhatsApp Business / Multi-Device:');
      qrcode.generate(qr, { small: true });
    }

    // 2. Log connection states
    if (connection === 'connecting') {
      logger.info('Connecting to WhatsApp Web services...');
    }

    if (connection === 'open') {
      reconnectAttempts = 0;
      const botJid = cleanJid(sock.user.id);
      logger.info(`WhatsApp connection successfully established! Logged in as: ${botJid}`);

      // List and print all joined groups
      try {
        const groups = await sock.groupFetchAllParticipating();
        logger.info(`Fetching all joined WhatsApp groups (${Object.keys(groups).length} total):`);
        for (const [jid, metadata] of Object.entries(groups)) {
          logger.info(`👥 Group Name: "${metadata.subject}" | ID: ${jid}`);
        }
      } catch (err) {
        logger.error('Failed to list joined groups:', err);
      }


      // Initialize node-cron schedules
      scheduler.initialize(sock);
    }

    // 3. Handle reconnection on connection close
    if (connection === 'close') {
      const error = lastDisconnect?.error;
      let statusCode = null;

      if (error) {
        if (error instanceof Boom) {
          statusCode = error.output.statusCode;
        } else if (error.statusCode) {
          statusCode = error.statusCode;
        }
      }

      const errorMessage = error ? error.message : 'Unknown issue';
      logger.warn(`WhatsApp connection closed. Message: "${errorMessage}" | Status Code: ${statusCode}`);

      // Reconnect if not explicitly logged out
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      if (shouldReconnect) {
        // Check if this is just a temporary internet/network outage
        const isNetworkError = isNetworkOutageError(errorMessage);

        if (isNetworkError) {
          // Network is down — do NOT count against the reconnect limit.
          // Keep retrying every 60 seconds until internet comes back.
          const delay = 60000;
          logger.warn(`Network outage detected ("${errorMessage}"). Internet may be down. Retrying in 60 seconds... (attempt counter NOT incremented)`);
          scheduler.stop();
          setTimeout(connectToWhatsApp, delay);
        } else {
          // Real WhatsApp error — use exponential backoff and count attempts
          reconnectAttempts++;
          if (reconnectAttempts <= MAX_RECONNECT_ATTEMPTS) {
            // Exponential backoff with ceiling at 30 seconds
            const delay = Math.min(1000 * Math.pow(1.5, reconnectAttempts), 30000);
            logger.info(`Attempting reconnect #${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} in ${(delay / 1000).toFixed(1)} seconds...`);

            // Stop scheduler if running to prevent double execution or memory leaks during downtime
            scheduler.stop();

            setTimeout(connectToWhatsApp, delay);
          } else {
            logger.error(`Exceeded maximum reconnect attempts (${MAX_RECONNECT_ATTEMPTS}). Terminating process.`);
            process.exit(1);
          }
        }
      } else {
        logger.error('Session logged out or expired. Automatically clearing "data/baileys_auth.json" to request a new QR Code.');
        try {
          const authPath = path.join(__dirname, '../data/baileys_auth.json');
          if (fs.existsSync(authPath)) {
            fs.unlinkSync(authPath);
          }
        } catch (e) {
          logger.error('Failed to automatically clear auth file:', e);
        }
        reconnectAttempts = 0;
        scheduler.stop();
        setTimeout(connectToWhatsApp, 1000);
      }
    }
  });

  // Message event listener
  sock.ev.on('messages.upsert', async ({ type, messages: list }) => {
    if (type !== 'notify') return; // Ignore append/historical sync messages

    for (const msg of list) {
      try {
        await commands.handleMessage(sock, msg);
      } catch (err) {
        logger.error('Error handling incoming WhatsApp message event:', err);
      }
    }
  });

  return sock;
}

/**
 * Launches a bare-minimum HTTP service for hosting environments (like Render or Railway)
 * that require binding to a PORT and passing dynamic health check calls.
 */
function startHealthCheckServer() {
  const port = process.env.PORT || 3000;
  
  healthCheckServer = http.createServer((req, res) => {
    if (req.url === '/health' || req.url === '/') {
      const cfg = config.get();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'online',
        uptime_seconds: Math.round(process.uptime()),
        timezone: cfg.timezone,
        reminders_paused: cfg.isRemindersPaused,
        configured_group: cfg.groupJid || 'NONE',
        configured_admins_count: cfg.adminJids.length
      }));
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Endpoint Not Found');
    }
  });

  healthCheckServer.listen(port, () => {
    logger.info(`Health check HTTP server is listening on port ${port}`);
  });
}

/**
 * Initializes and starts the entire bot stack.
 */
async function start() {
  try {
    // 1. Initialize JSON Database
    await database.init();

    // 2. Load settings from JSON database
    await config.load();

    // 3. Bind HTTP server (crucial for Cloud hosts)
    startHealthCheckServer();

    // 4. Initiate WhatsApp socket
    await connectToWhatsApp();
  } catch (err) {
    logger.error('Fatal initialization exception caught:', err);
    process.exit(1);
  }
}

module.exports = {
  start,
  getSocket: () => sock
};
