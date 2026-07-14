const db = require('../database');
const logger = require('../logger');

module.exports = {
  name: "Assignment Reminders",
  version: "1.1.0",
  initialize: () => {
    logger.debug("Initializing Assignment SQLite component");
  },
  
  listAssignments: async (sock, remoteJid, args, msg) => {
    const senderJid = msg.key.participant || msg.participant || remoteJid;
    
    // Command option: ADD assignment
    // Syntax: /assignment add Course | Assignment Title | Deadline (e.g. July 20, 2026)
    if (args[0] === 'add') {
      const remainingArgs = args.slice(1).join(' ');
      const parts = remainingArgs.split('|').map(p => p.trim());
      
      if (parts.length < 3) {
        await sock.sendMessage(remoteJid, {
          text: `⚠️ *Usage:* \`/assignment add Course | Assignment Title | Deadline\`\nExample: \`/assignment add AIT 323 | Neural Networks Report | Monday 2:00 PM\``
        }, { quoted: msg });
        return;
      }
      
      const [course, title, deadline] = parts;
      
      try {
        await db.dbQueryRun(
          'INSERT INTO assignments (course, title, deadline) VALUES (?, ?, ?)',
          [course, title, deadline]
        );
        await sock.sendMessage(remoteJid, {
          text: `✅ *Assignment Added:* Successfully registered deadline for *${course}* - *${title}* on *${deadline}* in database.`
        }, { quoted: msg });
        logger.info(`Added assignment to database: ${title} (${course})`);
      } catch (err) {
        logger.error('Failed to insert assignment into database:', err);
        await sock.sendMessage(remoteJid, {
          text: `❌ Error: Could not save assignment into database.`
        }, { quoted: msg });
      }
      return;
    }
    
    // Query assignments list
    try {
      const rows = await db.dbQueryAll('SELECT course, title, deadline FROM assignments ORDER BY id DESC');
      
      if (rows.length === 0) {
        await sock.sendMessage(remoteJid, {
          text: "📚 *Assignment Deadlines:* No pending course assignments are currently registered in the database! Enjoy your week."
        }, { quoted: msg });
        return;
      }
      
      let listText = `📚 *AI Department Assignment Deadlines* 📚\n\n`;
      rows.forEach((row, idx) => {
        listText += `${idx + 1}. *${row.course}*: ${row.title}\n   📅 *Deadline:* ${row.deadline}\n\n`;
      });
      listText += `_Submit all course assignments before the specified dates._`;
      
      await sock.sendMessage(remoteJid, { text: listText }, { quoted: msg });
    } catch (err) {
      logger.error('Failed to retrieve assignments from database:', err);
      await sock.sendMessage(remoteJid, {
        text: `❌ Error: Failed to retrieve assignments list.`
      }, { quoted: msg });
    }
  }
};
