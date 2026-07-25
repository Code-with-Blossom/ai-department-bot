#!/usr/bin/env node
/**
 * import-session.js
 *
 * Standalone script to verify that a SESSION_DATA string is valid
 * before deploying the bot. Can also write the credentials to
 * data/baileys_auth.json for local use.
 *
 * Usage:
 *   node import-session.js                       # reads SESSION_DATA from .env
 *   node import-session.js "<base64string>"       # validates provided string
 *   node import-session.js --write               # writes decoded credentials to disk
 */

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Load .env for local usage
try {
  require('dotenv').config();
} catch {
  // dotenv optional
}

// Attempt to load BufferJSON for proper Baileys field deserialization
let BufferJSON;
try {
  ({ BufferJSON } = require('@whiskeysockets/baileys'));
} catch {
  BufferJSON = null;
}

const DATA_DIR = path.join(__dirname, 'data');
const AUTH_PATH = path.join(DATA_DIR, 'baileys_auth.json');

const args = process.argv.slice(2);
const shouldWrite = args.includes('--write');
const providedValue = args.find(a => !a.startsWith('--'));

// Resolve session data from: CLI argument > process.env.SESSION_DATA > SESSION_DATA_1+
let sessionString = providedValue || '';

if (!sessionString) {
  // Try split parts first
  let combined = '';
  let i = 1;
  while (process.env[`SESSION_DATA_${i}`]) {
    combined += process.env[`SESSION_DATA_${i}`];
    i++;
  }
  if (combined) {
    sessionString = combined;
  } else if (process.env.SESSION_DATA) {
    sessionString = process.env.SESSION_DATA;
  }
}

console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  🔍  WhatsApp Bot — Session Import & Verification Tool');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');

// --- Step 1: Check input ---
if (!sessionString || sessionString.trim() === '') {
  console.error('❌ ERROR: No SESSION_DATA found.');
  console.error('');
  console.error('Provide SESSION_DATA in one of these ways:');
  console.error('  1. Set SESSION_DATA in your .env file.');
  console.error('  2. Pass it as a CLI argument:');
  console.error('     node import-session.js "<base64string>"');
  console.error('');
  process.exit(1);
}

const inputLen = sessionString.trim().length;
console.log(`📥 Input source:   ${providedValue ? 'CLI argument' : 'environment variable (SESSION_DATA)'}`);
console.log(`📏 Input length:   ${inputLen} characters`);
console.log('');

// --- Step 2: Decode base64 ---
let rawBuffer;
try {
  rawBuffer = Buffer.from(sessionString.trim(), 'base64');
} catch (err) {
  console.error(`❌ ERROR: Failed to decode base64: ${err.message}`);
  process.exit(1);
}

if (rawBuffer.length < 10) {
  console.error('❌ ERROR: Decoded buffer is too short — the payload is corrupted or truncated.');
  process.exit(1);
}

console.log(`📦 Decoded buffer size: ${rawBuffer.length} bytes`);

// --- Step 3: Decompress if gzipped ---
let decoded;
const isGzip = rawBuffer[0] === 0x1f && rawBuffer[1] === 0x8b;

try {
  if (isGzip) {
    decoded = zlib.gunzipSync(rawBuffer).toString('utf8');
    console.log('🗜️  Format: gzip-compressed base64 — Decompressed successfully.');
  } else {
    decoded = rawBuffer.toString('utf8');
    console.log('📄 Format: plain base64 (no compression).');
  }
} catch (err) {
  console.error(`❌ ERROR: Failed to decompress gzip data: ${err.message}`);
  console.error('   The SESSION_DATA string may be corrupted.');
  process.exit(1);
}

// --- Step 4: Parse JSON ---
let parsed;
try {
  parsed = JSON.parse(decoded, BufferJSON ? BufferJSON.reviver : undefined);
} catch (err) {
  console.error(`❌ ERROR: Decoded content is not valid JSON: ${err.message}`);
  console.error('   The SESSION_DATA string may be corrupted or truncated.');
  process.exit(1);
}

if (!parsed || typeof parsed !== 'object') {
  console.error('❌ ERROR: Parsed SESSION_DATA is not a valid JSON object.');
  process.exit(1);
}

// --- Step 5: Validate credentials ---
console.log('');
console.log('─── Credential Audit ────────────────────────────────────────');

const hasCreds = !!(parsed.creds && Object.keys(parsed.creds).length > 0);
const hasKeys = !!(parsed.keys && Object.keys(parsed.keys).length > 0);
const isRegistered = hasCreds && !!parsed.creds.me;
const keysCount = hasKeys ? Object.keys(parsed.keys).length : 0;

console.log(`  Credentials present:   ${hasCreds ? '✅ Yes' : '❌ No'}`);
console.log(`  Keys present:          ${hasKeys ? `✅ Yes (${keysCount} keys)` : '❌ No'}`);
console.log(`  Credentials registered: ${isRegistered ? '✅ Yes' : '❌ No (creds.me is undefined)'}`);

if (isRegistered) {
  console.log(`  Account ID:            ${parsed.creds.me.id}`);
  if (parsed.creds.me.name) {
    console.log(`  Account name:          ${parsed.creds.me.name}`);
  }
}

console.log('─────────────────────────────────────────────────────────────');
console.log('');

// --- Step 6: Final verdict ---
if (!hasCreds) {
  console.error('❌ INVALID: SESSION_DATA has no credentials. The bot will generate a QR code.');
  process.exit(1);
}

if (!isRegistered) {
  console.error('❌ INVALID: Credentials exist but are NOT registered (creds.me is undefined).');
  console.error('   The bot will generate a QR code because this session was never paired.');
  console.error('   Run the bot locally, scan the QR, wait for connection, then re-export.');
  process.exit(1);
}

console.log('✅ SESSION_DATA is VALID.');
console.log('   The bot will connect WITHOUT generating a new QR code.');
console.log('');

// --- Step 7: Optionally write to disk ---
if (shouldWrite) {
  console.log('💾 Writing credentials to disk...');
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const tmpPath = AUTH_PATH + '.tmp';
    fs.writeFileSync(tmpPath, decoded, 'utf8');
    fs.renameSync(tmpPath, AUTH_PATH);
    console.log(`✅ Credentials written to: ${AUTH_PATH}`);
    console.log('   You can now start the bot locally with: node index.js');
  } catch (err) {
    console.error(`❌ ERROR: Failed to write credentials: ${err.message}`);
    process.exit(1);
  }
} else {
  console.log('💡 TIP: To write these credentials to disk for local testing, run:');
  console.log('   node import-session.js --write');
}

console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');
