const bot = require('./src/bot');
const logger = require('./src/logger');

logger.info('===================================================');
logger.info('   Starting WhatsApp Group Assistant Bot v1.0.0   ');
logger.info('===================================================');

// Handle process-level events to prevent process death on unhandled errors
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception caught:', err.message || err);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Promise Rejection caught:', reason ? (reason.message || reason) : 'Unknown reason');
});

// Launch the bot stack
bot.start();
