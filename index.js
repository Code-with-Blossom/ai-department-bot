const bot = require('./src/bot');
const logger = require('./src/logger');

logger.info('===================================================');
logger.info('   Starting WhatsApp Group Assistant Bot v1.0.0   ');
logger.info('===================================================');

// Handle process-level events to ensure logging robustness
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception occurred:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Promise Rejection details:', reason);
});

// Launch the bot connection and health services
bot.start();
