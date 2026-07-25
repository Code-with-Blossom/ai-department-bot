#!/usr/bin/env node
/**
 * export-session.js
 *
 * Standalone script to export the current Baileys authentication session
 * from data/baileys_auth.json into a gzip-compressed, Base64-encoded
 * SESSION_DATA string for use on Render, Railway, or any cloud platform.
 *
 * Usage:
 *   node export-session.js
 *
 * Output:
 *   Prints SESSION_DATA=<base64> to the console, ready to copy into
 *   your cloud provider's environment variables dashboard.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Attempt to load BufferJSON to validate the payload parses correctly
let BufferJSON;
try {
  ({ BufferJSON } = require('@whiskeysockets/baileys'));
} catch {
  BufferJSON = null;
}

const AUTH_PATH = path.join(__dirname, 'data', 'baileys_auth.json');

console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  📦  WhatsApp Bot — Session Export Tool');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');

// --- Step 1: Verify auth file exists ---
if (!fs.existsSync(AUTH_PATH)) {
  console.error('❌ ERROR: No auth file found at:');
  console.error(`   ${AUTH_PATH}`);
  console.error('');
  console.error('   Please run the bot locally first:');
  console.error('   1. Run:  node index.js');
  console.error('   2. Scan the QR code with your WhatsApp app.');
  console.error('   3. Wait for the bot to connect successfully.');
  console.error('   4. Then re-run: node export-session.js');
  console.error('');
  process.exit(1);
}

// --- Step 2: Read and validate the auth file ---
let rawContent;
try {
  rawContent = fs.readFileSync(AUTH_PATH, 'utf8');
} catch (err) {
  console.error(`❌ ERROR: Could not read auth file: ${err.message}`);
  process.exit(1);
}

if (!rawContent || rawContent.trim() === '') {
  console.error('❌ ERROR: Auth file is empty.');
  console.error('   The bot may not have saved credentials yet.');
  process.exit(1);
}

// --- Step 3: Parse and validate credentials ---
let parsed;
try {
  parsed = JSON.parse(rawContent, BufferJSON ? BufferJSON.reviver : undefined);
} catch (err) {
  console.error(`❌ ERROR: Auth file is not valid JSON: ${err.message}`);
  process.exit(1);
}

if (!parsed || typeof parsed !== 'object') {
  console.error('❌ ERROR: Auth file does not contain a valid object.');
  process.exit(1);
}

if (!parsed.creds || Object.keys(parsed.creds).length === 0) {
  console.error('❌ ERROR: Auth file has empty credentials.');
  console.error('   The bot has not completed authentication yet.');
  process.exit(1);
}

if (!parsed.creds.me) {
  console.error('⚠️  WARNING: Credentials are not registered (creds.me is undefined).');
  console.error('   The bot was never paired with a WhatsApp account.');
  console.error('   Please run the bot, scan the QR, connect, then re-export.');
  process.exit(1);
}

const accountId = parsed.creds.me.id;
const keysCount = parsed.keys ? Object.keys(parsed.keys).length : 0;

console.log(`✅ Credentials verified.`);
console.log(`   Account ID: ${accountId}`);
console.log(`   Stored keys: ${keysCount}`);
console.log('');

// --- Step 4: Compress and encode ---
let base64Str;
try {
  const compressed = zlib.gzipSync(Buffer.from(rawContent, 'utf8'));
  base64Str = compressed.toString('base64');
} catch (err) {
  console.error(`❌ ERROR: Failed to compress session data: ${err.message}`);
  process.exit(1);
}

const sizeKb = Math.round(Buffer.from(base64Str).length / 1024);
console.log(`📦 Compressed session size: ${sizeKb} KB`);
console.log('');

// --- Step 5: Output ---
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🔑 SESSION_DATA EXPORT SUCCESSFUL');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');
console.log('Copy the entire line below and paste it as an environment');
console.log('variable named SESSION_DATA in your Render / Railway dashboard:');
console.log('');
console.log(`SESSION_DATA=${base64Str}`);
console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('NEXT STEPS:');
console.log('  1. Go to your Render / Railway project dashboard.');
console.log('  2. Open "Environment Variables" settings.');
console.log('  3. Create a new variable:  SESSION_DATA = <paste the value above>');
console.log('  4. Redeploy the bot.');
console.log('  5. The bot will load credentials from SESSION_DATA and connect');
console.log('     WITHOUT generating a new QR code.');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');
