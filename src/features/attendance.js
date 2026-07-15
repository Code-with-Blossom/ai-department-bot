const db = require('../database');
const logger = require('../logger');

module.exports = {
  name: "Attendance System",
  version: "1.1.0",
  initialize: () => {
    logger.debug("Initializing Attendance SQLite component");
  },
  
  handleCheckin: async (sock, remoteJid, args, msg) => {
    const senderJid = msg.key.participant || msg.participant || remoteJid;
    const cleanSender = senderJid.split('@')[0];
    
    // Command format: /attendance checkin <course_name>
    // Example: /attendance checkin AIT 323
    const parts = args.trim().split(/\s+/);
    const subCommand = parts[0]?.toLowerCase();
    
    if (subCommand === 'checkin' || subCommand === 'log') {
      const course = parts.slice(1).join(' ').trim();
      if (!course) {
        await sock.sendMessage(remoteJid, {
          text: `⚠️ *Usage:* \`/attendance checkin <Course Name>\`\nExample: \`/attendance checkin AIT 323\``
        }, { quoted: msg });
        return;
      }
      
      const todayDate = new Date().toLocaleDateString('en-US', { timeZone: 'Africa/Lagos' });
      
      try {
        // Log attendance checkin to SQLite table
        await db.addAttendance(senderJid, course, todayDate, 'present');
        
        await sock.sendMessage(remoteJid, {
          text: `📝 *Attendance Registered:* Student @${cleanSender} checked in as *PRESENT* for *${course.toUpperCase()}* on *${todayDate}* (Lagos Time).`
        }, { quoted: msg, mentions: [senderJid] });
        
        logger.info(`Registered check-in for student ${senderJid} on course ${course}`);
      } catch (err) {
        logger.error('Failed to record student check-in in database:', err);
        await sock.sendMessage(remoteJid, {
          text: `❌ Error: Failed to register check-in in database.`
        }, { quoted: msg });
      }
      return;
    }
    
    // Default attendance command info
    await sock.sendMessage(remoteJid, {
      text: `📝 *AI Department Attendance System* 📝\n\nTo check in for a class today, send:\n\`/attendance checkin <Course Code>\` (e.g. \`/attendance checkin EED\`)\n\nLogs are saved dynamically in JSON files.`
    }, { quoted: msg });
  }
};
