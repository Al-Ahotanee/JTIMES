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

  // Max stories to analyze per scan cycle (default: 8)
  // Keeps AI requests within the free-tier rate limit (15 requests/min)
  // and prioritizes the most important Jigawa State stories first.
  maxItemsPerRun: optionalInt('NEWSROOM_MAX_ITEMS_PER_RUN', 8),

  // Max concurrent AI requests in-flight at once (default: 1)
  concurrency: optionalInt('NEWSROOM_CONCURRENCY', 1),

  // -----------------------------------------------------------------------
  // AI provider
  // -----------------------------------------------------------------------
  aiProvider: optional('AI_PROVIDER', 'gemini'),
  geminiApiKey: optional('GEMINI_API_KEY'),
  geminiModel: optional('GEMINI_MODEL', 'gemini-3.5-flash'),

  // Optional fallback (not implemented in v1, reserved for future use)
  aisFallbackProvider: optional('AI_FALLBACK_PROVIDER'),

  // -----------------------------------------------------------------------
  // Operational Windows (WAT / Africa/Lagos Timezone, UTC+1)
  // Default windows: 08:00-09:00, 13:00-14:00, 19:00-20:00, 00:00-01:00
  // -----------------------------------------------------------------------
  timezone: optional('NEWSROOM_TIMEZONE', 'Africa/Lagos'),
  operationalHours: [0, 8, 13, 19],

  // -----------------------------------------------------------------------
  // Image provider
  // Defaults to 'pollinations' for free, high-resolution 16:9 news imagery
  // -----------------------------------------------------------------------
  imageProvider: optional('IMAGE_PROVIDER', 'pollinations'),
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
