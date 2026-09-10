// newsroom/config.js
// Single source of truth for all AI Newsroom configuration.
// All values come from environment variables — nothing is hardcoded.
// Safe to import multiple times; the object is frozen after creation.

'use strict';

function required(key) {
  const val = process.env[key];
  if (!val) {
    console.warn(`[NEWSROOM] Warning: ${key} is not set.`);
  }
  return val || '';
}

function optional(key, defaultValue = '') {
  return process.env[key] !== undefined ? process.env[key] : defaultValue;
}

function optionalInt(key, defaultValue) {
  const val = parseInt(process.env[key], 10);
  return Number.isFinite(val) ? val : defaultValue;
}

function optionalBool(key, defaultValue) {
  if (process.env[key] === undefined) return defaultValue;
  return process.env[key] === 'true' || process.env[key] === '1';
}

const VALID_MODES = ['manual', 'semi_auto', 'auto'];

const mode = optional('NEWSROOM_MODE', 'manual');
if (!VALID_MODES.includes(mode)) {
  console.warn(`[NEWSROOM] Invalid NEWSROOM_MODE "${mode}". Falling back to "manual".`);
}

const config = Object.freeze({
  // -----------------------------------------------------------------------
  // Editorial mode
  // manual    — pipeline runs but never publishes; items go to PENDING_REVIEW
  // semi_auto — low-risk items are created as DRAFT and submitted; human approves
  // auto      — low-risk items are published automatically; high-risk → PENDING_REVIEW
  // -----------------------------------------------------------------------
  mode: VALID_MODES.includes(mode) ? mode : 'manual',

  // When true the pipeline runs fully but NEVER calls the publish API.
  // Default: true — must be explicitly disabled for real publishing.
  dryRun: optionalBool('NEWSROOM_DRY_RUN', true),

  // How often the scheduler runs (default: 30 minutes)
  intervalMinutes: optionalInt('NEWSROOM_INTERVAL_MINUTES', 30),

  // Max concurrent AI requests in-flight at once
  concurrency: optionalInt('NEWSROOM_CONCURRENCY', 2),

  // -----------------------------------------------------------------------
  // AI provider
  // -----------------------------------------------------------------------
  aiProvider: optional('AI_PROVIDER', 'gemini'),
  geminiApiKey: optional('GEMINI_API_KEY'),
  geminiModel: optional('GEMINI_MODEL', 'gemini-3.6-flash'),

  // Optional fallback (not implemented in v1, reserved for future use)
  aisFallbackProvider: optional('AI_FALLBACK_PROVIDER'),

  // -----------------------------------------------------------------------
  // Image provider
  // Leave IMAGE_PROVIDER empty to skip AI image generation entirely.
  // -----------------------------------------------------------------------
  imageProvider: optional('IMAGE_PROVIDER'),
  imageApiKey: optional('IMAGE_API_KEY'),

  // -----------------------------------------------------------------------
  // Existing Jigawa Times API
  // -----------------------------------------------------------------------
  // Base URL of the existing JT backend (adapts to Render's PORT).
  apiUrl: optional('EXISTING_API_URL', `http://127.0.0.1:${process.env.PORT || 3000}`),

  // A valid JWT for the newsroom author account. Generate once:
  //   POST /api/auth/login  { email, password }  → copy the jt_token cookie value
  // Or set NEWSROOM_AUTHOR_EMAIL + NEWSROOM_AUTHOR_PASSWORD to auto-login.
  apiToken: optional('NEWSROOM_API_TOKEN'),
  authorEmail: optional('NEWSROOM_AUTHOR_EMAIL', 'admin@jigawatimes.ng'),
  authorPassword: optional('NEWSROOM_AUTHOR_PASSWORD'),
});

module.exports = config;
