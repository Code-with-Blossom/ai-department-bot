const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const PDFS_DIR = path.join(__dirname, '../pdfs');
const SUPPORTED_COURSES = ['AIT321', 'AIT323', 'AIT324', 'AIT325', 'AIT326', 'AIT327', 'EED', 'GNS302'];

// Ensure pdfs directory exists in the workspace
if (!fs.existsSync(PDFS_DIR)) {
  fs.mkdirSync(PDFS_DIR, { recursive: true });
}

/**
 * Checks message text for a lecture note/PDF download query.
 * Matches case-insensitively.
 * Supported matches include:
 * - "/pdf ait323", "/note ait323", "/notes ait323"
 * - "pdf ait323", "notes ait323", "lecture note ait323"
 * - "ait323 pdf", "ait323 notes"
 * @param {string} text - Cleaned message text
 * @returns {string|null} The normalized course code (e.g. 'AIT323') or null if no request matched.
 */
function parsePdfRequest(text) {
  if (!text) return null;
  
  // Normalize whitespace (single space separators) and lower-case
  const cleanText = text.toLowerCase().trim().replace(/\s+/g, ' ');
  const coursesLower = SUPPORTED_COURSES.map(c => c.toLowerCase());

  // 1. Match suffix format: e.g. "ait323 pdf", "ait323 notes"
  const suffixMatch = cleanText.match(/^(\w+)\s+(pdf|notes?)$/);
  if (suffixMatch) {
    const course = suffixMatch[1];
    if (coursesLower.includes(course)) {
      return SUPPORTED_COURSES[coursesLower.indexOf(course)];
    }
  }

  // 2. Match prefix format (with optional slash): e.g. "/pdf ait323", "lecture note ait323", "pdf ait323"
  const prefixMatch = cleanText.match(/^\/?(pdf|notes?|lecture\s+notes?)\s+(\w+)$/);
  if (prefixMatch) {
    const course = prefixMatch[2];
    if (coursesLower.includes(course)) {
      return SUPPORTED_COURSES[coursesLower.indexOf(course)];
    }
  }

  return null;
}

/**
 * Searches the pdfs/ directory for the course PDF and uploads it to the group chat.
 * Returns true if handled, false otherwise.
 */
async function handlePdfRequest(sock, remoteJid, text, msg) {
  const courseCode = parsePdfRequest(text);
  if (!courseCode) return false;

  logger.info(`Detected PDF Library request for course: "${courseCode}" in chat ${remoteJid}`);

  try {
    const files = fs.readdirSync(PDFS_DIR);
    const targetFileLower = `${courseCode.toLowerCase()}.pdf`;
    
    // Find the file case-insensitively
    const matchedFile = files.find(f => f.toLowerCase() === targetFileLower);

    if (matchedFile) {
      const pdfPath = path.join(PDFS_DIR, matchedFile);
      logger.info(`Uploading PDF document: ${pdfPath} to ${remoteJid}`);
      
      await sock.sendMessage(remoteJid, {
        document: { url: pdfPath },
        mimetype: 'application/pdf',
        fileName: `${courseCode}.pdf`,
        caption: `📚 Here is the lecture note for *${courseCode}*.`
      }, { quoted: msg });
      
      logger.info(`PDF document for ${courseCode} successfully delivered.`);
    } else {
      logger.warn(`No PDF document matching "${targetFileLower}" exists in: ${PDFS_DIR}`);
      await sock.sendMessage(remoteJid, {
        text: "❌ Sorry, no lecture note is available yet for this course."
      }, { quoted: msg });
    }
  } catch (err) {
    logger.error(`Error reading directory or uploading PDF for ${courseCode}:`, err);
    await sock.sendMessage(remoteJid, {
      text: "❌ Error: Failed to retrieve or send the PDF file. Please try again later."
    }, { quoted: msg });
  }

  return true;
}

module.exports = {
  parsePdfRequest,
  handlePdfRequest,
  PDFS_DIR,
  SUPPORTED_COURSES
};
