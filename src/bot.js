const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const { Boom } = require('@hapi/boom');
const http = require('http');

const logger = require('./logger');
const config = require('./config');
const commands = require('./commands');
const scheduler = require('./scheduler');
const database = require('./database');

let sock = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 15;
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
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');

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

      // Send a startup test message if a valid group JID is configured
      const cfg = config.get();
      if (cfg.groupJid && cfg.groupJid !== 'your_group_jid_here@g.us' && cfg.groupJid !== '120363000000000000@g.us') {
        try {
          logger.info(`Sending startup test message to group: ${cfg.groupJid}`);
          await sock.sendMessage(cfg.groupJid, { text: '🤖 AI Department Assistant is now online and active!' });
          logger.info('Startup test message sent successfully.');
        } catch (err) {
          logger.error('Failed to send startup test message:', err);
        }
      } else {
        logger.warn('Startup test message skipped: GROUP_JID is not configured in .env.');
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
      } else {
        logger.error('Session logged out or expired. Please delete "auth_info/" directory and restart the bot to re-authenticate. Exiting.');
        process.exit(1);
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
