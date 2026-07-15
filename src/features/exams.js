const db = require('../database');
const logger = require('../logger');

module.exports = {
  name: "Exam Reminders",
  version: "1.1.0",
  initialize: () => {
    logger.debug("Initializing Exam SQLite component");
  },
  
  listExams: async (sock, remoteJid, args, msg) => {
    // Command option: ADD exam
    // Syntax: /exam add Course | Date | Time | Venue
    if (args[0] === 'add') {
      const remainingArgs = args.slice(1).join(' ');
      const parts = remainingArgs.split('|').map(p => p.trim());
      
      if (parts.length < 4) {
        await sock.sendMessage(remoteJid, {
          text: `⚠️ *Usage:* \`/exam add Course | Date | Time | Venue\`\nExample: \`/exam add AIT 325 | Oct 12, 2026 | 9:00 AM | Lecture Theatre 2\``
        }, { quoted: msg });
        return;
      }
      
      const [course, date, time, venue] = parts;
      
      try {
        await db.addExam(course, date, time, venue);
        await sock.sendMessage(remoteJid, {
          text: `✅ *Exam Scheduled:* Successfully registered exam details for *${course}* on *${date}* at *${venue}* in database.`
        }, { quoted: msg });
        logger.info(`Added exam timetable to database: ${course} on ${date}`);
      } catch (err) {
        logger.error('Failed to insert exam into database:', err);
        await sock.sendMessage(remoteJid, {
          text: `❌ Error: Could not save exam details to database.`
        }, { quoted: msg });
      }
      return;
    }
    
    // Query exams list
    try {
      const rows = await db.getExams();
      
      if (rows.length === 0) {
        await sock.sendMessage(remoteJid, {
          text: "✏️ *Exam Timetable:* No upcoming examinations are currently registered in the database! Keep reviewing your lecture notes."
        }, { quoted: msg });
        return;
      }
      
      let listText = `✏️ *AI Department Exam Schedule Calendar* ✏️\n\n`;
      rows.forEach((row, idx) => {
        listText += `${idx + 1}. *${row.course}* \n   📅 *Date:* ${row.date}\n   🕒 *Time:* ${row.time}\n   📍 *Venue:* ${row.venue}\n\n`;
      });
      listText += `_Prepare ahead. Punctuality at exam venues is mandatory._`;
      
      await sock.sendMessage(remoteJid, { text: listText }, { quoted: msg });
    } catch (err) {
      logger.error('Failed to retrieve exams from database:', err);
      await sock.sendMessage(remoteJid, {
        text: `❌ Error: Failed to retrieve exam timetable.`
      }, { quoted: msg });
    }
  }
};
