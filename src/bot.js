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
const sessionManager = require('./sessionManager');

let sock = null;
let activeSocket = null;
let isConnecting = false;
let reconnectTimer = null;
let reconnectAttempts = 0;
let isConnected = false;
const MAX_RECONNECT_LOG_ATTEMPTS = 10;

// Railway deployment environment detection
const isRailway = !!(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_STATIC_URL || process.env.RAILWAY_GIT_COMMIT_SHA || process.env.PORT);

// Network/socket error patterns for resilience
const NETWORK_ERROR_PATTERNS = [
  'ENOTFOUND',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'getaddrinfo',
  'Opening handshake has timed out',
  'Connection was lost',
  'Stream Errored'
];

let healthCheckServer = null;

function cleanJid(id) {
  if (!id) return '';
  return id.split(':')[0] + '@s.whatsapp.net';
}

/**
 * ConnectionManager handles WhatsApp Baileys socket lifecycle, single socket enforcement,
 * automatic reconnects with exponential backoff, and state logging.
 */
async function connectToWhatsApp() {
  if (isConnecting) {
    logger.warn('Connection attempt already in progress. Skipping duplicate call.');
    return activeSocket;
  }

  isConnecting = true;

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  // Ensure strict single socket instance — close and detach previous active socket
  if (activeSocket) {
    try {
      logger.info('Cleaning up existing WhatsApp socket instance...');
      activeSocket.ev.removeAllListeners('connection.update');
      activeSocket.ev.removeAllListeners('creds.update');
      activeSocket.ev.removeAllListeners('messages.upsert');
      activeSocket.end(new Error('Reconnecting new socket instance'));
    } catch (e) {
      logger.debug('Error closing active socket:', e.message);
    }
    activeSocket = null;
  }

  try {
    const { state, saveCreds } = await sessionManager.getAuthState();

    logger.info('Connecting to WhatsApp...');

    sock = makeWASocket({
      logger: pino({ level: 'silent' }), // Suppress internal Baileys verbose logs
      auth: state,
      printQRInTerminal: false
    });

    activeSocket = sock;

    // Attach credentials updater listener
    sock.ev.on('creds.update', saveCreds);

    // Connection state update listener
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      // 1. QR Code generation
      if (qr) {
        logger.info('Waiting for QR Scan...');
        if (!isRailway) {
          qrcode.generate(qr, { small: true });
        } else {
          logger.info(`[Railway QR Raw Payload]: ${qr}`);
          qrcode.generate(qr, { small: true });
        }
      }

      // 2. Connection open event
      if (connection === 'open') {
        isConnecting = false;
        isConnected = true;
        const previousAttempts = reconnectAttempts;
        reconnectAttempts = 0;

        const botJid = cleanJid(sock.user.id);
        
        if (previousAttempts > 0) {
          logger.info('Connected successfully.');
        } else {
          logger.info(`Bot authenticated successfully.`);
          logger.info(`Bot connected (${botJid})`);
        }

        // Auto-export SESSION_DATA string to logs for cloud deployment convenience
        try {
          const authPath = path.join(__dirname, '../data/baileys_auth.json');
          if (fs.existsSync(authPath)) {
            const rawContent = fs.readFileSync(authPath, 'utf8');
            const compressed = require('zlib').gzipSync(Buffer.from(rawContent, 'utf8'));
            const base64Str = compressed.toString('base64');
            console.log(`\nSESSION_DATA=${base64Str}\n`);
          }
        } catch (_) {}

        // List joined groups
        try {
          const groups = await sock.groupFetchAllParticipating();
          logger.info(`Fetching all joined WhatsApp groups (${Object.keys(groups).length} total):`);
          for (const [jid, metadata] of Object.entries(groups)) {
            logger.info(`👥 Group Name: "${metadata.subject}" | ID: ${jid}`);
          }
        } catch (err) {
          logger.error('Failed to list joined groups:', err.message);
        }

        // Initialize cron scheduler
        scheduler.initialize(sock);
        logger.info('Ready.');
      }

      // 3. Connection close event & reconnection handling
      if (connection === 'close') {
        isConnecting = false;
        isConnected = false;
        const error = lastDisconnect?.error;
        let statusCode = null;

        if (error) {
          if (error instanceof Boom) {
            statusCode = error.output.statusCode;
          } else if (error.statusCode) {
            statusCode = error.statusCode;
          }
        }

        const errorMessage = error ? error.message : 'Connection closed';
        
        scheduler.stop();

        const isLoggedOut = statusCode === DisconnectReason.loggedOut;

        if (!isLoggedOut) {
          reconnectAttempts++;
          const attemptNum = Math.min(reconnectAttempts, MAX_RECONNECT_LOG_ATTEMPTS);
          logger.warn(`Lost connection. Attempt ${attemptNum}/${MAX_RECONNECT_LOG_ATTEMPTS}... (Reason: ${errorMessage})`);

          // Exponential backoff capped at 60s
          const delay = Math.min(1500 * Math.pow(1.5, Math.min(reconnectAttempts, 10)), 60000);
          
          reconnectTimer = setTimeout(() => {
            connectToWhatsApp();
          }, delay);
        } else {
          logger.error('Authentication failed. Session logged out or expired. Clearing local auth file to request new QR...');
          try {
            const authPath = path.join(__dirname, '../data/baileys_auth.json');
            if (fs.existsSync(authPath)) {
              fs.unlinkSync(authPath);
            }
          } catch (e) {
            logger.error('Failed to remove auth file:', e.message);
          }
          reconnectAttempts = 0;
          reconnectTimer = setTimeout(() => {
            connectToWhatsApp();
          }, 3000);
        }
      }
    });

    // Message upsert handler
    sock.ev.on('messages.upsert', async ({ type, messages: list }) => {
      if (type !== 'notify') return;

      for (const msg of list) {
        try {
          await commands.handleMessage(sock, msg);
        } catch (err) {
          logger.error('Error handling incoming WhatsApp message event:', err);
        }
      }
    });

  } catch (err) {
    isConnecting = false;
    isConnected = false;
    logger.error('Exception during connectToWhatsApp():', err);
    reconnectTimer = setTimeout(connectToWhatsApp, 10000);
  }

  return sock;
}

/**
 * Health check server for Railway dynamic port binding.
 */
function startHealthCheckServer() {
  if (healthCheckServer) return;

  const port = process.env.PORT || 3000;

  healthCheckServer = http.createServer((req, res) => {
    if (req.url === '/health' || req.url === '/') {
      const cfg = config.get();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'online',
        bot: isConnected ? 'online' : 'reconnecting',
        uptime_seconds: Math.round(process.uptime()),
        connected: isConnected,
        scheduler: cfg.isRemindersPaused ? 'paused' : 'active',
        timestamp: new Date().toISOString()
      }));
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Endpoint Not Found');
    }
  });

  healthCheckServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      logger.warn(`Health check HTTP server port ${port} is already in use (EADDRINUSE). Continuing...`);
    } else {
      logger.error('Health check HTTP server error:', err);
    }
  });

  healthCheckServer.listen(port, () => {
    logger.info(`Health Check HTTP server listening on port ${port}`);
  });
}

/**
 * Starts the complete bot stack.
 */
async function start() {
  try {
    logger.info('Bot starting...');

    // 1. Initialize Database
    await database.init();

    // 2. Load Config from Database
    await config.load();
    logger.info('Database loaded');

    // 3. Start Health Server
    startHealthCheckServer();

    // 4. Connect to WhatsApp
    await connectToWhatsApp();
  } catch (err) {
    logger.error('Fatal bot startup error:', err);
    setTimeout(start, 10000);
  }
}

module.exports = {
  start,
  getSocket: () => sock,
  isConnected: () => isConnected
};
