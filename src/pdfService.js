const fs = require('fs');
const path = require('path');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const logger = require('./logger');

const PDFS_DIR = path.join(__dirname, '../pdfs');
const SUPPORTED_COURSES = ['AIT321', 'AIT322', 'AIT323', 'AIT324', 'AIT325', 'AIT326', 'AIT327', 'EED', 'GNS302'];

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

/**
 * Lists all available PDFs in the library.
 */
async function listPdfs(sock, remoteJid, msg) {
  try {
    const files = fs.readdirSync(PDFS_DIR);
    const pdfs = files.filter(f => f.toLowerCase().endsWith('.pdf'));

    if (pdfs.length === 0) {
      await sock.sendMessage(remoteJid, {
        text: `📚 *PDF Lecture Notes Library*\n\nNo lecture notes have been uploaded yet.\n\nUse */add pdf <Course Code>* to upload a PDF.`
      }, { quoted: msg });
      return;
    }

    // Build list from actual files on disk
    let listText = `📚 *PDF Lecture Notes Library*\n\n`;
    listText += `The following lecture notes are available:\n\n`;

    pdfs.forEach((file, idx) => {
      const courseName = path.basename(file, '.pdf').toUpperCase();
      listText += `${idx + 1}. 📄 *${courseName}*\n`;
    });

    listText += `\n_To download a note, send:_ */pdf <Course Code>*\n`;
    listText += `_e.g._ \`/pdf AIT323\``;

    await sock.sendMessage(remoteJid, { text: listText }, { quoted: msg });
  } catch (err) {
    logger.error('Failed to list PDFs from directory:', err);
    await sock.sendMessage(remoteJid, {
      text: `❌ *Error:* Could not read the PDF library. Please try again later.`
    }, { quoted: msg });
  }
}

/**
 * Handles adding a PDF to the library.
 * The PDF can be attached directly to the message or quoted.
 */
async function handleAddPdf(sock, remoteJid, args, msg) {
  const courseCode = args.join('').replace(/\s+/g, '').toUpperCase();
  
  if (!courseCode) {
    await sock.sendMessage(remoteJid, {
      text: `⚠️ *Usage:* Send a PDF file with the caption \`/add pdf <Course Code>\` OR reply to a PDF file with \`/add pdf <Course Code>\` (e.g. \`/add pdf AIT323\`).`
    }, { quoted: msg });
    return;
  }

  if (!SUPPORTED_COURSES.includes(courseCode)) {
    await sock.sendMessage(remoteJid, {
      text: `❌ *Error:* Unsupported course code: *${courseCode}*.\nSupported courses are: ${SUPPORTED_COURSES.join(', ')}`
    }, { quoted: msg });
    return;
  }

  // 1. Locate the document message
  let docMessage = msg.message?.documentMessage;
  let mediaSource = msg.message;

  const quotedMessage = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (!docMessage && quotedMessage?.documentMessage) {
    docMessage = quotedMessage.documentMessage;
    mediaSource = quotedMessage;
  }

  if (!docMessage) {
    await sock.sendMessage(remoteJid, {
      text: `❌ *Error:* No PDF document found. Please upload a PDF file with the caption \`/add pdf ${courseCode}\` or reply to a PDF file with the command.`
    }, { quoted: msg });
    return;
  }

  // 2. Validate that it's a PDF
  const mime = docMessage.mimetype || '';
  if (!mime.toLowerCase().includes('pdf')) {
    await sock.sendMessage(remoteJid, {
      text: `❌ *Error:* The uploaded file is not a PDF (Type: ${mime}). Only PDF files can be saved to the library.`
    }, { quoted: msg });
    return;
  }

  // 3. Download and save the document
  await sock.sendMessage(remoteJid, {
    text: `⏳ *Processing:* Downloading and saving the PDF for *${courseCode}*...`
  }, { quoted: msg });

  try {
    const mediaMsg = {
      key: msg.key,
      message: mediaSource
    };

    const buffer = await downloadMediaMessage(
      mediaMsg,
      'buffer',
      {},
      { logger: logger }
    );

    if (!buffer) {
      throw new Error('Failed to download media; empty buffer received.');
    }

    const targetPath = path.join(PDFS_DIR, `${courseCode}.pdf`);
    fs.writeFileSync(targetPath, buffer);

    logger.info(`Successfully saved PDF library file for ${courseCode} to ${targetPath}`);
    await sock.sendMessage(remoteJid, {
      text: `✅ *Success:* Lecture note for *${courseCode}* has been successfully saved to the PDF library!`
    }, { quoted: msg });

  } catch (err) {
    logger.error(`Failed to download and save PDF for ${courseCode}:`, err);
    await sock.sendMessage(remoteJid, {
      text: `❌ *Error:* Failed to download or save the PDF file: ${err.message}`
    }, { quoted: msg });
  }
}

module.exports = {
  parsePdfRequest,
  handlePdfRequest,
  listPdfs,
  handleAddPdf,
  PDFS_DIR,
  SUPPORTED_COURSES
};
