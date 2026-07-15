const logger = require('../logger');

module.exports = {
  name: "AI Q&A",
  version: "1.1.0",
  initialize: () => {
    logger.debug("Initializing AI Q&A component");
  },
  
  handleAsk: async (sock, remoteJid, question, msg) => {
    const senderJid = msg.key.participant || msg.participant || remoteJid;
    
    if (!question || question.trim() === '') {
      await sock.sendMessage(remoteJid, {
        text: "⚠️ *Usage:* \`/ask <your question about the courses, schedule, or slides>\`"
      }, { quoted: msg });
      return;
    }

    // Send placeholder response and log search query
    await sock.sendMessage(remoteJid, {
      text: `🤖 *AI Assistant:* Thank you for your question: "${question}".\n\nGoogle Gemini API integration is coming in the next build! Your query has been logged in the assistant database.`
    }, { quoted: msg });
    
    logger.info(`AI Q&A query logged from ${senderJid}: "${question}"`);
  }
};
