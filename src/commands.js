const config = require('./config');
const scheduler = require('./scheduler');
const logger = require('./logger');
const db = require('./database');
const pdfService = require('./pdfService');

// Future stubs imports (which now interact with database)
const aiQa = require('./features/ai_qa');
const attendance = require('./features/attendance');
const assignments = require('./features/assignments');
const exams = require('./features/exams');
const lectureNotes = require('./features/lecture_notes');
const polls = require('./features/polls');

const metadataCache = new Map();
const CACHE_TTL = 1000 * 60 * 5; // 5 minutes cache

/**
 * Normalizes WhatsApp JIDs by removing device IDs and ensuring correct suffix.
 */
function normalizeJid(jid) {
  if (!jid) return '';
  const parts = jid.split('@');
  if (parts.length < 2) return jid;
  const user = parts[0].split(':')[0]; // Remove device suffix (e.g. :1)
  const server = parts[1];
  return `${user}@${server}`;
}

/**
 * Fetches group metadata with caching to avoid rate-limiting.
 */
async function getCachedGroupMetadata(sock, groupJid) {
  const now = Date.now();
  const cached = metadataCache.get(groupJid);
  if (cached && (now - cached.timestamp < CACHE_TTL)) {
    return cached.metadata;
  }
  
  try {
    const metadata = await sock.groupMetadata(groupJid);
    metadataCache.set(groupJid, { metadata, timestamp: now });
    return metadata;
  } catch (error) {
    logger.error(`Failed to fetch group metadata for ${groupJid}:`, error);
    if (cached) return cached.metadata;
    throw error;
  }
}

/**
 * Checks if the sender has admin privileges.
 */
async function checkAdminPrivileges(sock, remoteJid, senderJid) {
  const cfg = config.get();
  const normalizedSender = normalizeJid(senderJid);

  // 1. Check if configured in ADMIN_JIDS
  if (cfg.adminJids.map(normalizeJid).includes(normalizedSender)) {
    return true;
  }

  // 2. If message was sent in a group, check if the user is a group admin
  if (remoteJid.endsWith('@g.us')) {
    try {
      const metadata = await getCachedGroupMetadata(sock, remoteJid);
      const participant = metadata.participants.find(
        p => normalizeJid(p.id) === normalizedSender
      );
      if (participant && (participant.admin === 'admin' || participant.admin === 'superadmin')) {
        return true;
      }
    } catch (err) {
      logger.warn(`Could not verify admin status via group metadata for JID: ${normalizedSender}`, err);
    }
  }

  return false;
}

/**
 * Extract text content from various Baileys message structures.
 */
function getMessageText(msg) {
  if (!msg || !msg.message) return '';
  return (
    msg.message.conversation ||
    msg.message.extendedTextMessage?.text ||
    msg.message.imageMessage?.caption ||
    msg.message.videoMessage?.caption ||
    ''
  ).trim();
}

/**
 * Main command router and message handler.
 */
async function handleMessage(sock, msg) {
  if (msg.key.fromMe) return;

  const remoteJid = msg.key.remoteJid;
  const senderJid = msg.key.participant || msg.participant || remoteJid;

  if (!remoteJid) return;

  const text = getMessageText(msg);
  if (!text) return;

  // Intercept and handle PDF Library requests
  const isPdfHandled = await pdfService.handlePdfRequest(sock, remoteJid, text, msg);
  if (isPdfHandled) return;

  if (!text.startsWith('/')) return;

  const parts = text.slice(1).split(/\s+/);
  const command = parts[0].toLowerCase();
  const args = parts.slice(1);

  logger.info(`Received command /${command} from ${normalizeJid(senderJid)} in chat ${remoteJid}`);

  // ----------------------------------------------------
  // Open Commands (Accessible to all participants)
  // ----------------------------------------------------
  if (command === 'help') {
    return sendHelp(sock, remoteJid);
  }
  
  if (command === 'groupid') {
    return sendGroupId(sock, remoteJid, msg);
  }

  if (command === 'test') {
    return handleTest(sock, remoteJid, msg);
  }

  if (command === 'today') {
    return handleToday(sock, remoteJid, msg);
  }

  if (command === 'tomorrow') {
    return handleTomorrow(sock, remoteJid, msg);
  }

  if (command === 'schedule') {
    return handleSchedule(sock, remoteJid, msg);
  }

  // /pdf with no course code → show library list
  if (command === 'pdf' && args.length === 0) {
    return pdfService.listPdfs(sock, remoteJid, msg);
  }

  if (command === 'add') {
    if (args[0]?.toLowerCase() === 'pdf') {
      return pdfService.handleAddPdf(sock, remoteJid, args.slice(1), msg);
    }
  }

  if (command === 'addpdf') {
    return pdfService.handleAddPdf(sock, remoteJid, args, msg);
  }

  // ----------------------------------------------------
  // Dynamic SQLite Feature commands
  // ----------------------------------------------------
  if (command === 'assignment' || command === 'assignments') {
    return assignments.listAssignments(sock, remoteJid, args, msg);
  }

  if (command === 'attendance' || command === 'checkin') {
    return attendance.handleCheckin(sock, remoteJid, args.join(' '), msg);
  }

  if (command === 'exams' || command === 'exam') {
    return exams.listExams(sock, remoteJid, args, msg);
  }

  if (command === 'ask') {
    return aiQa.handleAsk(sock, remoteJid, args.join(' '), msg);
  }

  if (command === 'notes' || command === 'note') {
    return lectureNotes.sendNotes(sock, remoteJid, args, msg);
  }

  if (command === 'poll') {
    return polls.createPoll(sock, remoteJid, '', [], msg);
  }

  // ----------------------------------------------------
  // Admin Only Commands
  // ----------------------------------------------------
  const isSenderAdmin = await checkAdminPrivileges(sock, remoteJid, senderJid);
  
  if (command === 'announcement' || command === 'cancel' || command === 'change' || command === 'remind') {
    if (!isSenderAdmin) {
      await sock.sendMessage(remoteJid, {
        text: `❌ *Access Denied:* Only group admins can use /${command}.`
      }, { quoted: msg });
      logger.warn(`Unauthorized admin command attempt /${command} by ${normalizeJid(senderJid)}`);
      return;
    }
  }

  switch (command) {
    case 'announcement':
      await handleAnnouncement(sock, remoteJid, senderJid, args, msg);
      break;
    case 'cancel':
      await handleCancel(sock, remoteJid, msg);
      break;
    case 'change':
      await handleChange(sock, remoteJid, args, msg);
      break;
    case 'remind':
      await handleRemind(sock, remoteJid, args, msg);
      break;
    default:
      await sock.sendMessage(remoteJid, {
        text: `😂 *Ode, wrong command!* /${command} no exist.\nType */help* to see the correct commands.`
      }, { quoted: msg });
  }
}

/**
 * /help command handler
 */
async function sendHelp(sock, remoteJid) {
  const helpText = `🤖 *AI Department Assistant - Help* 🤖

Here are the commands available:

*General Commands:*
• */help* - Displays this help message.
• */today* - Displays today's lecture schedule.
• */tomorrow* - Displays tomorrow's lecture schedule.
• */schedule* - Displays the full weekly class timetable.
• */test* - Check if the AI Assistant is online.
• */groupid* - Retrieve the JID of this chat.

*Active SQLite features:*
• */assignments* - View deadlines. Add: \`/assignment add <course> | <title> | <deadline>\`
• */notes* - Fetch shared note links. Add: \`/notes add <course> | <title> | <link>\`
• */exams* - View exams calendar. Add: \`/exam add <course> | <date> | <time> | <venue>\`
• */attendance checkin <code>* - Log checkin for active classes.

*PDF Lecture Notes Library:*
• */pdf* - Browse all available lecture notes in the library.
• */pdf <course>* - Download a specific PDF note (e.g. \`/pdf AIT323\`).
• */add pdf <course>* - Upload a PDF to the library (e.g. \`/add pdf AIT323\`).

*Admin Commands:*
• */announcement <text>* - Format and broadcast an announcement.
• */cancel* - Toggle pause/resume on reminders.
• */change [day] [HH:MM]* - Reschedule Thursday override (e.g. \`/change thursday 12:00 PM - 2:00 PM\`).
• */remind [day]* - Manually send class reminder.`;

  await sock.sendMessage(remoteJid, { text: helpText });
}

/**
 * /groupid command handler
 */
async function sendGroupId(sock, remoteJid, msg) {
  if (remoteJid.endsWith('@g.us')) {
    await sock.sendMessage(remoteJid, {
      text: `📋 *Group JID:* \`${remoteJid}\`\n\nCopy this JID and paste it in your \`.env\` file as \`GROUP_JID\`.`
    }, { quoted: msg });
  } else {
    await sock.sendMessage(remoteJid, {
      text: `❌ This command can only be used inside a WhatsApp group.`
    }, { quoted: msg });
  }
}

/**
 * /test command handler
 * Responds to confirm the bot is online, then sends reminders for tomorrow and
 * every remaining weekday in the current week to the configured group.
 */
async function handleTest(sock, remoteJid, msg) {
  const cfg = config.get();
  const timetable = await scheduler.loadTimetable();

  // 1. Confirm bot is online (safe send — no quoted to avoid @lid JID issues)
  try {
    await sock.sendMessage(remoteJid, {
      text: '✅ *AI Department Assistant is online and active!*\n\n📆 Sending class reminders for tomorrow and the rest of this week to the group now...'
    }, { quoted: msg });
  } catch (_) {
    // Fallback: send without quoting (handles @lid JID format edge cases)
    try {
      await sock.sendMessage(remoteJid, {
        text: '✅ *AI Department Assistant is online and active!*\n\n📆 Sending class reminders for tomorrow and the rest of this week to the group now...'
      });
    } catch (err) {
      logger.error('/test: Failed to send confirmation message:', err);
    }
  }

  // 2. Determine target group JID (use current chat if it's a group, else fall back to configured group)
  const targetJid = remoteJid.endsWith('@g.us') ? remoteJid : cfg.groupJid;
  if (!targetJid || targetJid === 'your_group_jid_here@g.us') {
    logger.warn('/test: No valid group JID configured, skipping reminder sends.');
    return;
  }

  // 3. Build list of remaining days from tomorrow through end of the week (Mon–Fri only)
  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const now = new Date();
  const todayNum = now.getDay(); // 0=Sun ... 6=Sat

  const weekdays = [1, 2, 3, 4, 5]; // Mon–Fri indices
  const remainingWeekdays = weekdays.filter(d => d > todayNum);

  if (remainingWeekdays.length === 0) {
    logger.info('/test: No remaining weekdays this week. No reminders to send.');
    try {
      await sock.sendMessage(remoteJid, {
        text: '📭 No more classes scheduled for the rest of this week.'
      });
    } catch (_) {}
    return;
  }

  // 4. Send a reminder for each remaining weekday that has classes
  let remindersSent = 0;
  for (const dayNum of remainingWeekdays) {
    const dayName = DAY_NAMES[dayNum];
    const classes = timetable[dayName] || [];

    if (classes.length === 0) continue;

    // Build a daily summary message for this day
    let msgText = `🔔 *UPCOMING CLASS REMINDER*\n\n`;
    msgText += `📅 *${dayName}*\n\n`;
    msgText += `📚 *Classes Scheduled:*\n\n`;

    classes.forEach((item) => {
      const displayTime =
        item.time.toLowerCase().includes('scheduled')
          ? cfg.thursdayClassTime
          : item.time;
      msgText += `• *${item.course}* — ${displayTime}`;
      if (item.lecturer) msgText += ` _(${item.lecturer})_`;
      msgText += `\n`;
    });

    msgText += `\n_Please prepare your materials and be punctual!_ 📖`;

    try {
      await sock.sendMessage(targetJid, { text: msgText });
      remindersSent++;
      logger.info(`/test: Sent reminder for ${dayName} to group ${targetJid}`);
      // Small delay to avoid WhatsApp rate limiting
      await new Promise(resolve => setTimeout(resolve, 1500));
    } catch (err) {
      logger.error(`/test: Failed to send reminder for ${dayName}:`, err);
    }
  }

  logger.info(`/test: Done. Sent ${remindersSent} day reminder(s) for the rest of the week.`);
}

/**
 * /announcement command handler
 */
async function handleAnnouncement(sock, remoteJid, senderJid, args, msg) {
  const announcementText = args.join(' ');
  if (!announcementText) {
    await sock.sendMessage(remoteJid, {
      text: `⚠️ *Usage:* \`/announcement <announcement message content>\``
    }, { quoted: msg });
    return;
  }

  const cfg = config.get();
  const targetJid = remoteJid.endsWith('@g.us') ? remoteJid : cfg.groupJid;

  if (!targetJid || targetJid === 'your_group_jid_here@g.us') {
    await sock.sendMessage(remoteJid, {
      text: `❌ *Error:* Group JID is not configured in .env, please run in group or configure GROUP_JID.`
    }, { quoted: msg });
    return;
  }

  // Save announcement to JSON database
  try {
    await db.addAnnouncement(normalizeJid(senderJid), announcementText);
  } catch (err) {
    logger.error('Failed to log announcement to database:', err);
  }

  const senderNormalized = normalizeJid(senderJid);
  const senderNumber = senderNormalized.split('@')[0];
  const dateStr = new Date().toLocaleDateString('en-US', {
    timeZone: 'Africa/Lagos',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const formattedAnnouncement = `📢 *OFFICIAL ANNOUNCEMENT* 📢\n\n${announcementText}\n\n*Posted by:* @${senderNumber}\n*Date:* ${dateStr} (Lagos Time)`;

  await sock.sendMessage(targetJid, {
    text: formattedAnnouncement,
    mentions: [senderNormalized]
  });

  if (targetJid !== remoteJid) {
    await sock.sendMessage(remoteJid, {
      text: `✅ Announcement successfully broadcast to group and logged in SQLite.`
    }, { quoted: msg });
  }
}

/**
 * /today command handler
 */
async function handleToday(sock, remoteJid, msg) {
  const todayName = new Date().toLocaleString('en-US', {
    timeZone: 'Africa/Lagos',
    weekday: 'long'
  });

  const timetable = await scheduler.loadTimetable();
  const cfg = config.get();

  // Resolve "As Scheduled" entries to the actual configured time
  const classes = (timetable[todayName] || []).map((item) => ({
    ...item,
    time: item.time.toLowerCase().includes('scheduled') ? cfg.thursdayClassTime : item.time
  }));

  const text = scheduler.formatDailyReminder(todayName, classes);
  await sock.sendMessage(remoteJid, { text }, { quoted: msg });
}

/**
 * /tomorrow command handler
 */
async function handleTomorrow(sock, remoteJid, msg) {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const tomorrowName = tomorrow.toLocaleString('en-US', {
    timeZone: 'Africa/Lagos',
    weekday: 'long'
  });
  const timetable = await scheduler.loadTimetable();
  const classes = timetable[tomorrowName] || [];
  const cfg = config.get();

  let text = `🤖 *AI Department Assistant*\n\n`;
  text += `📅 *Tomorrow is ${tomorrowName}.*\n\n`;
  text += `📚 *Tomorrow's Classes*\n\n`;

  if (classes && classes.length > 0) {
    classes.forEach((item) => {
      // Resolve "As Scheduled" to the actual configured Thursday time
      const displayTime =
        item.time.toLowerCase().includes('scheduled')
          ? cfg.thursdayClassTime
          : item.time;
      text += `• *${item.course}* — ${displayTime}`;
      if (item.lecturer) text += ` _(${item.lecturer})_`;
      text += `\n`;
    });
  } else {
    text += `🎉 No classes scheduled for tomorrow! Enjoy your day off.\n`;
  }

  text += `\n*Please prepare ahead and ensure punctuality.*`;

  await sock.sendMessage(remoteJid, { text }, { quoted: msg });
}

/**
 * /schedule command handler
 */
async function handleSchedule(sock, remoteJid, msg) {
  const timetable = await scheduler.loadTimetable();
  const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

  let scheduleText = `🤖 *AI Department Weekly Timetable* 🤖\n\n`;

  const cfg = config.get();

  weekdays.forEach((day) => {
    scheduleText += `📅 *${day}*\n`;
    const classes = timetable[day] || [];
    if (classes.length > 0) {
      classes.forEach((item) => {
        // Resolve "As Scheduled" to the actual configured Thursday time
        const displayTime =
          item.time.toLowerCase().includes('scheduled')
            ? cfg.thursdayClassTime
            : item.time;
        scheduleText += `• *${item.course}* — ${displayTime}`;
        if (item.lecturer) scheduleText += ` _(${item.lecturer})_`;
        scheduleText += `\n`;
      });
    } else {
      scheduleText += `• No classes scheduled\n`;
    }
    scheduleText += `\n`;
  });

  scheduleText += `_Note: Keep track of updates and announce adjustments._`;

  await sock.sendMessage(remoteJid, { text: scheduleText }, { quoted: msg });
}

/**
 * /cancel command handler (toggles reminders paused state)
 */
async function handleCancel(sock, remoteJid, msg) {
  const cfg = config.get();
  const newState = !cfg.isRemindersPaused;

  await config.setRemindersPaused(newState);

  const statusMsg = newState
    ? `⚠️ *Automatic class reminders have been PAUSED.*\nNo scheduled reminders will send until reactivated.`
    : `✅ *Automatic class reminders have been RESUMED.*\nReminders will send as scheduled.`;

  await sock.sendMessage(remoteJid, { text: statusMsg }, { quoted: msg });
}

/**
 * /change command handler
 */
async function handleChange(sock, remoteJid, args, msg) {
  // Usage: /change thursday 11:00 AM - 1:00 PM
  if (args.length < 2) {
    await sock.sendMessage(remoteJid, {
      text: `⚠️ *Usage:* \`/change thursday <class duration time range>\`\nExample: \`/change thursday 11:00 AM - 1:00 PM\``
    }, { quoted: msg });
    return;
  }

  const day = args[0].toLowerCase();
  const timeRange = args.slice(1).join(' ');

  if (day !== 'thursday') {
    await sock.sendMessage(remoteJid, {
      text: `⚠️ Overriding times is currently only supported for Thursday classes (the "As Scheduled" session). Please modify timetable.json or SQLite database timetable table directly for other weekdays.`
    }, { quoted: msg });
    return;
  }

  // Basic check for time format (contains AM/PM)
  if (!timeRange.toUpperCase().includes('AM') && !timeRange.toUpperCase().includes('PM')) {
    await sock.sendMessage(remoteJid, {
      text: `❌ *Invalid Format:* Please specify a valid time range like "11:00 AM - 1:00 PM".`
    }, { quoted: msg });
    return;
  }

  const success = await config.setReminderTime('thursday', timeRange);

  if (success) {
    // Log schedule change to JSON database
    try {
      await db.addScheduleChange('Thursday', 'Mandatory Skills Qualification', 'As Scheduled', timeRange);
    } catch (err) {
      logger.error('Failed to log schedule change to database:', err);
    }

    // Reschedule in-memory jobs
    await scheduler.reschedule();
    
    await sock.sendMessage(remoteJid, {
      text: `✅ *Schedule Updated:* Thursday classes are now override scheduled at *${timeRange}*. Class reminder will fire 1 hour before.`
    }, { quoted: msg });
  } else {
    await sock.sendMessage(remoteJid, {
      text: `❌ Failed to update scheduler settings in database. Check log file for details.`
    }, { quoted: msg });
  }
}

/**
 * /remind command handler
 */
async function handleRemind(sock, remoteJid, args, msg) {
  let dayName = args[0] ? args[0].toLowerCase() : '';
  
  if (!dayName) {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const todayNum = new Date().getDay();
    dayName = days[todayNum];
  }

  const validDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
  if (!validDays.includes(dayName)) {
    await sock.sendMessage(remoteJid, {
      text: `⚠️ No class reminders scheduled for *${dayName.toUpperCase()}*.\n\nSpecify a weekday:\n\`/remind monday\`, \`/remind tuesday\`, etc.`
    }, { quoted: msg });
    return;
  }

  const cfg = config.get();
  const targetJid = remoteJid.endsWith('@g.us') ? remoteJid : cfg.groupJid;

  if (!targetJid || targetJid === 'your_group_jid_here@g.us') {
    await sock.sendMessage(remoteJid, {
      text: `❌ *Error:* Group JID is not configured in .env, and you are running this from a DM.`
    }, { quoted: msg });
    return;
  }

  const timetable = await scheduler.loadTimetable();
  const formattedDayName = dayName.charAt(0).toUpperCase() + dayName.slice(1);
  const classes = timetable[formattedDayName] || [];

  if (classes.length === 0) {
    await sock.sendMessage(remoteJid, {
      text: `🎉 No classes scheduled for *${formattedDayName}*.`
    }, { quoted: msg });
    return;
  }

  const resolvedClasses = classes.map((item) => ({
    ...item,
    time: item.time.toLowerCase().includes('scheduled') ? cfg.thursdayClassTime : item.time
  }));

  const text = scheduler.formatDailyReminder(formattedDayName, resolvedClasses);

  try {
    await sock.sendMessage(targetJid, { text });
    await sock.sendMessage(remoteJid, {
      text: `✅ Manual daily summary reminder for *${formattedDayName}* classes triggered successfully to group: ${targetJid}.`
    }, { quoted: msg });
  } catch (err) {
    logger.error(`Failed to send manual daily summary reminder for ${formattedDayName}:`, err);
    await sock.sendMessage(remoteJid, {
      text: `❌ *Error:* Failed to send the reminder message to the group.`
    }, { quoted: msg });
  }
}

module.exports = {
  handleMessage
};
