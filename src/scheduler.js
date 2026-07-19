const cron = require('node-cron');
const db = require('./database');
const config = require('./config');
const logger = require('./logger');

let activeJobs = []; // Array of active cron job instances
let botSocket = null;

const DAY_MAP = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sunday: 0
};

async function loadTimetable() {
  try {
    const rawTimetable = await db.getTimetable();
    const timetable = {};
    for (const [dayName, classes] of Object.entries(rawTimetable)) {
      const day = dayName.charAt(0).toUpperCase() + dayName.slice(1).toLowerCase();
      timetable[day] = classes;
    }
    return timetable;
  } catch (error) {
    logger.error('Error loading timetable from JSON database:', error);
    return {};
  }
}

/**
 * Parses a class time string (like "8:00 AM - 10:00 AM" or "As Scheduled") 
 * and returns the cron-compatible hour/minute for a reminder exactly 1 hour before.
 * @param {string} course - Name of the course
 * @param {string} timeStr - Time duration string
 * @returns {{hour: number, minute: number} | null}
 */
function getReminderTime(course, timeStr) {
  let startStr = '';

  if (!timeStr || timeStr.toLowerCase().includes('scheduled') || timeStr.toLowerCase() === 'as scheduled') {
    // If it's "As Scheduled", we look for the Thursday class time override in config
    const cfg = config.get();
    const override = cfg.thursdayClassTime;
    if (override && !override.toLowerCase().includes('scheduled')) {
      startStr = override.split('-')[0].trim();
      logger.info(`Using Thursday class time override from config: "${override}" (Start: "${startStr}")`);
    } else {
      logger.warn(`No valid time override configured for class "${course}" with time "${timeStr}"`);
      return null;
    }
  } else {
    startStr = timeStr.split('-')[0].trim();
  }

  // Parse format: H:MM AM/PM or HH:MM AM/PM
  const match = startStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) {
    logger.warn(`Could not parse class start time string: "${startStr}" for course "${course}"`);
    return null;
  }

  let hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  const ampm = match[3].toUpperCase();

  // Convert to 24 hour integer
  if (ampm === 'PM' && hour !== 12) {
    hour += 12;
  } else if (ampm === 'AM' && hour === 12) {
    hour = 0;
  }

  // Subtract exactly 1 hour
  const reminderHour = (hour - 1 + 24) % 24;

  return { hour: reminderHour, minute };
}

/**
 * Formats the single class reminder notification.
 */
function formatClassReminder(dayName, course, timeRange, lecturer) {
  const formattedDayName = dayName.charAt(0).toUpperCase() + dayName.slice(1).toLowerCase();

  let msgText = `🔔 *CLASS REMINDER*\n\n`;
  msgText += `Good morning Artificial intelligence Student!\n\n`;
  msgText += `⏰ *Your next class starts in 1 hour, If you like come late nah you sabi*\n\n\n`;
  msgText += `📚 *Course:* ${course}\n`;
  msgText += `🕒 *Time:* ${timeRange}\n`;
  msgText += `📅 *Day:* ${formattedDayName}\n`;
  if (lecturer) msgText += `👤 *Lecturer:* ${lecturer}\n`;
  msgText += `\nPlease prepare your materials and be punctual.\n\n`;
  msgText += `Have a productive class! 🤖`;
  return msgText;
}

/**
 * Broadcasts class reminder to configured WhatsApp group.
 */
async function sendClassReminder(dayName, course, timeRange, lecturer) {
  const cfg = config.get();

  if (cfg.isRemindersPaused) {
    logger.info(`Skipped reminder for "${course}" (${timeRange}): Reminders are paused.`);
    return;
  }

  const groupJid = cfg.groupJid;
  if (!groupJid || groupJid === 'your_group_jid_here@g.us' || groupJid === '120363000000000000@g.us') {
    logger.warn(`Skipped reminder for "${course}" (${timeRange}): Group JID is not configured in .env.`);
    return;
  }

  if (!botSocket) {
    logger.error(`Skipped reminder for "${course}" (${timeRange}): WhatsApp bot socket is not connected.`);
    return;
  }

  const text = formatClassReminder(dayName, course, timeRange, lecturer);

  try {
    logger.info(`Sending 1-hour class reminder for "${course}" (${timeRange}) to group JID: ${groupJid}`);
    await botSocket.sendMessage(groupJid, { text });
    logger.info(`Reminder for "${course}" sent successfully.`);
  } catch (err) {
    logger.error(`Error sending class reminder for "${course}":`, err);
  }
}

/**
 * Formats the daily summary of all classes for `/today` or scheduler reference.
 */
function formatDailyReminder(day, classes) {
  let msgText = `🤖 *Good morning AI Department!*\n\n`;
  msgText += `📅 *Today is ${day}.*\n\n`;
  msgText += `📚 *Today's Classes*\n\n`;

  if (classes && classes.length > 0) {
    classes.forEach((item) => {
      msgText += `• *${item.course}* — ${item.time}`;
      if (item.lecturer) msgText += ` _(${item.lecturer})_`;
      msgText += `\n`;
    });
  } else {
    msgText += `🎉 No classes scheduled for today! Enjoy your day.\n`;
  }

  msgText += `\n*Please be punctual, attend all lectures, and have a productive day.*`;
  return msgText;
}

/**
 * Schedules all class reminders based on timetable SQLite table rows.
 */
async function startSchedules(sock) {
  if (sock) {
    botSocket = sock;
  }

  // Stop any active cron jobs first
  stopSchedules();

  const cfg = config.get();
  const timezone = cfg.timezone || 'Africa/Lagos';
  const timetable = await loadTimetable();

  logger.info(`Initializing individual 1-hour class reminder schedulers (Timezone: ${timezone})...`);

  for (const [dayName, classes] of Object.entries(timetable)) {
    const dayNum = DAY_MAP[dayName.toLowerCase()];
    if (dayNum === undefined) {
      logger.warn(`Unknown day in timetable database: "${dayName}". Skipping scheduling.`);
      continue;
    }

    classes.forEach((item) => {
      // Resolve class time (check for overrides if needed)
      let timeRange = item.time;
      if (timeRange.toLowerCase().includes('scheduled') || timeRange.toLowerCase() === 'as scheduled') {
        const override = cfg.thursdayClassTime;
        if (override) {
          timeRange = override;
        }
      }

      const reminderTime = getReminderTime(item.course, item.time);
      if (!reminderTime) {
        return;
      }

      const { hour, minute } = reminderTime;

      // Cron: minute hour * * dayNum
      const cronExpression = `${minute} ${hour} * * ${dayNum}`;

      try {
        const job = cron.schedule(cronExpression, async () => {
          logger.info(`Cron trigger activated: 1-hour reminder for "${item.course}" (${timeRange})`);
          await sendClassReminder(dayName, item.course, timeRange, item.lecturer || '');
        }, {
          scheduled: true,
          timezone: timezone
        });

        activeJobs.push(job);
        logger.info(`Scheduled reminder for "${item.course}" (${timeRange}) on ${dayName} at ${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')} (${cronExpression})`);
      } catch (err) {
        logger.error(`Failed to schedule cron job for "${item.course}" on ${dayName} at ${hour}:${minute}:`, err);
      }
    });
  }

  logger.info(`Class scheduling complete. Active cron jobs running: ${activeJobs.length}`);
}

/**
 * Stops all active class reminders schedules
 */
function stopSchedules() {
  if (activeJobs.length > 0) {
    activeJobs.forEach((job) => {
      if (job) job.stop();
    });
    activeJobs = [];
    logger.info('Stopped all active class reminder cron schedulers.');
  }
}

module.exports = {
  initialize: async (sock) => {
    botSocket = sock;
    await startSchedules(sock);
  },
  start: startSchedules,
  stop: stopSchedules,
  reschedule: async () => {
    logger.info('Rescheduling class reminder cron jobs...');
    await startSchedules();
  },
  loadTimetable,
  formatDailyReminder,
  getReminderTime,
  sendClassReminder
};
