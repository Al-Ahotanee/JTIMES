// newsroom/images.js
// Image selection and (optional) AI generation for the AI Newsroom.
//
// PATH A — Source image: use the image URL from the RSS item if legally usable.
// PATH B — AI generation: call the configured IMAGE_PROVIDER if no source image.
// PATH C — No image: return null; article is published without a featured image.
//
// The existing Article.featuredImage column stores only URLs — Cloudinary or
// any public HTTPS URL. We never store images on disk (Render ephemeral FS).

'use strict';

const https = require('https');
const http  = require('http');

// Domains where images are almost certainly NOT free to republish without permission.
// Expand this list as needed.
const RESTRICTED_DOMAINS = [
  'twitter.com', 'x.com', 'facebook.com', 'instagram.com',
  'tiktok.com', 'snapchat.com', 'whatsapp.com',
  'gettyimages.com', 'shutterstock.com', 'alamy.com',
  'istockphoto.com', 'depositphotos.com',
];

/**
 * Check whether a URL's domain is on the restricted list.
 * @param {string} url
 * @returns {boolean}
 */
function isRestrictedDomain(url) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    return RESTRICTED_DOMAINS.some((d) => hostname === d || hostname.endsWith('.' + d));
  } catch {
    return true; // treat malformed URLs as restricted
  }
}

/**
 * Perform a lightweight HEAD request to verify the image URL is reachable
 * and returns a valid image content-type.
 * @param {string} url
 * @param {number} [timeoutMs=5000]
 * @returns {Promise<boolean>}
 */
function validateImageUrl(url, timeoutMs = 5000) {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(url);
      const lib = parsed.protocol === 'https:' ? https : http;
      const req = lib.request(
        { method: 'HEAD', hostname: parsed.hostname, path: parsed.pathname + parsed.search, timeout: timeoutMs },
        (res) => {
          const ct = (res.headers['content-type'] || '').toLowerCase();
          resolve(res.statusCode >= 200 && res.statusCode < 400 && ct.startsWith('image/'));
        }
      );
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
      req.end();
    } catch {
      resolve(false);
    }
  });
}

/**
 * PATH A — Attempt to use the source image from the RSS item.
 * Returns an image object if the URL passes validation, or null.
 *
 * @param {object} item  Normalised story item
 * @returns {Promise<{url, caption, credit, source, license}|null>}
 */
async function selectSourceImage(item) {
  const url = item.imageUrl;
  if (!url || typeof url !== 'string' || !url.startsWith('http')) return null;
  if (isRestrictedDomain(url)) {
    console.log(`[NEWSROOM] Image from restricted domain skipped: ${url}`);
    return null;
  }
  const valid = await validateImageUrl(url);
  if (!valid) {
    console.log(`[NEWSROOM] Image URL unreachable or invalid: ${url}`);
    return null;
  }
  return {
    url,
    caption: item.title ? `Image related to: ${item.title}` : 'Source image.',
    credit: item.sourceName || 'Source',
    source: item.sourceUrl,
    license: 'unknown — verify before republishing',
    type: 'source',
  };
}

/**
 * PATH B — Generate an illustrative image using the configured IMAGE_PROVIDER.
 * Currently implements a stub — extend with actual provider API calls as needed.
 *
 * @param {object} brief   Image brief from IMAGE_BRIEF_PROMPT
 * @param {object} config  Newsroom config
 * @returns {Promise<{url, caption, credit, type}|null>}
 */
async function generateImage(brief, config) {
  if (!config.imageProvider || !config.imageApiKey) {
    return null; // Not configured — skip silently
  }
  if (!brief || brief.safe_to_generate === false) {
    console.log('[NEWSROOM] Image brief flagged as unsafe to generate — skipping.');
    return null;
  }

  // ---------------------------------------------------------------------------
  // Provider switch — add new providers here without touching other files.
  // ---------------------------------------------------------------------------
  const provider = (config.imageProvider || '').toLowerCase();

  if (provider === 'placeholder') {
    // Development/dry-run placeholder — never used in production
    return {
      url: null,
      caption: brief.caption || 'AI-generated illustration.',
      credit: 'AI-generated illustration — Jigawa Times',
      type: 'ai_generated',
    };
  }

  // Future providers (Imagen, DALL-E, Stability, etc.) go here.
  // Pattern: check provider name, call the API, upload result to Cloudinary
  // via the existing /api/uploads/sign endpoint, return the Cloudinary URL.
  console.warn(`[NEWSROOM] IMAGE_PROVIDER="${config.imageProvider}" is not yet implemented. Skipping image generation.`);
  return null;
}

/**
 * Main image selection entry point.
 * Tries PATH A (source image), then PATH B (AI generation), then returns null.
 *
 * @param {object} item    Normalised story item
 * @param {object} brief   Image brief object (from AI)
 * @param {object} config  Newsroom config
 * @returns {Promise<{url, caption, credit, type}|null>}
 */
async function selectImage(item, brief, config) {
  // PATH A
  const sourceImage = await selectSourceImage(item);
  if (sourceImage) {
    console.log(`[NEWSROOM] Using source image for: ${item.title}`);
    return sourceImage;
  }

  // PATH B
  const generated = await generateImage(brief, config);
  if (generated) {
    console.log(`[NEWSROOM] Using AI-generated image for: ${item.title}`);
    return generated;
  }

  // PATH C
  console.log(`[NEWSROOM] No image available for: ${item.title}`);
  return null;
}

module.exports = { selectImage, generateImage, validateImageUrl, isRestrictedDomain };
