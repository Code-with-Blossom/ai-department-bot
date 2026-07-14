const db = require('../database');
const logger = require('../logger');

module.exports = {
  name: "Lecture Notes Sharing",
  version: "1.1.0",
  initialize: () => {
    logger.debug("Initializing Lecture Notes SQLite component");
  },
  
  sendNotes: async (sock, remoteJid, args, msg) => {
    // Command option: ADD note
    // Syntax: /notes add Course | Notes Title | Resource URL/Link
    if (args[0] === 'add') {
      const remainingArgs = args.slice(1).join(' ');
      const parts = remainingArgs.split('|').map(p => p.trim());
      
      if (parts.length < 3) {
        await sock.sendMessage(remoteJid, {
          text: `⚠️ *Usage:* \`/notes add Course | Title | Link\`\nExample: \`/notes add AIT 321 | Lab Guide PDF | https://drive.google.com/...\``
        }, { quoted: msg });
        return;
      }
      
      const [course, title, url] = parts;
      
      try {
        await db.dbQueryRun(
          'INSERT INTO notes (course, title, url) VALUES (?, ?, ?)',
          [course, title, url]
        );
        await sock.sendMessage(remoteJid, {
          text: `✅ *Lecture Note Added:* Successfully registered note for *${course}* - *${title}* in database.`
        }, { quoted: msg });
        logger.info(`Added note resource to database: ${title} (${course})`);
      } catch (err) {
        logger.error('Failed to insert note into database:', err);
        await sock.sendMessage(remoteJid, {
          text: `❌ Error: Could not save note to database.`
        }, { quoted: msg });
      }
      return;
    }
    
    // Query notes list
    try {
      const rows = await db.dbQueryAll('SELECT course, title, url FROM notes ORDER BY id DESC');
      
      if (rows.length === 0) {
        await sock.sendMessage(remoteJid, {
          text: "📂 *Lecture Materials:* No shared lecture slides, links, or PDFs are currently registered in the database."
        }, { quoted: msg });
        return;
      }
      
      let listText = `📂 *AI Department Lecture Notes & Materials* 📂\n\n`;
      rows.forEach((row, idx) => {
        listText += `${idx + 1}. *${row.course}*: ${row.title}\n   🔗 *Link:* ${row.url}\n\n`;
      });
      listText += `_Make use of these files for your reviews and exam preparation._`;
      
      await sock.sendMessage(remoteJid, { text: listText }, { quoted: msg });
    } catch (err) {
      logger.error('Failed to retrieve notes from database:', err);
      await sock.sendMessage(remoteJid, {
        text: `❌ Error: Failed to retrieve lecture notes list.`
      }, { quoted: msg });
    }
  }
};
