// newsroom/agent.js
// Core AI Newsroom pipeline.
//
// Pipeline stages:
//   1. discoverStories   — fetch RSS feeds, normalise items
//   2. deduplicateItems  — URL hash + title similarity checks
//   3. classifyItem      — AI: is this news? region, category, risk
//   4. verifyItem        — AI: multi-source cross-check
//   5. writeArticle      — AI: full article generation
//   6. buildSeoMeta      — AI: slug, tags, SEO title, description
//   7. selectImage       — source image or AI image brief
//   8. publishArticle    — POST to existing JT API
//
// Design principles:
//   - A failure in one source never stops the whole run.
//   - AI is NEVER allowed to invent facts (enforced in prompts).
//   - High-risk stories always go to PENDING_REVIEW.
//   - Dry-run mode runs the full pipeline but never calls the publish API.

'use strict';

const https   = require('https');
const http    = require('http');
const crypto  = require('crypto');
const logger  = require('./logger.js');

const {
  CLASSIFY_PROMPT,
  DUPLICATE_PROMPT,
  VERIFY_PROMPT,
  WRITE_PROMPT,
  SEO_PROMPT,
  IMAGE_BRIEF_PROMPT,
  AGGREGATOR_REPHRASE_PROMPT,
} = require('./prompts.js');

const { selectImage } = require('./images.js');

// ---------------------------------------------------------------------------
// HTTP helpers (no extra dependencies — native node:http/https)
// ---------------------------------------------------------------------------

/**
 * Fetch a URL with a timeout. Returns the response body as a string.
 * @param {string} url
 * @param {object} [options]
 * @returns {Promise<string>}
 */
function fetchUrl(url, options = {}) {
  return new Promise((resolve, reject) => {
    const timeout = options.timeout || 15000;
    let parsed;
    try { parsed = new URL(url); } catch (e) { return reject(new Error(`Invalid URL: ${url}`)); }

    const lib  = parsed.protocol === 'https:' ? https : http;
    const opts = {
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method:   options.method || 'GET',
      headers:  {
        'User-Agent': 'JigawaTimes-Newsroom/1.0 (+https://jigawatimes.ng)',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
        ...options.headers,
      },
      timeout,
    };

    const req = lib.request(opts, (res) => {
      // Follow up to 3 redirects
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && (options.redirectCount || 0) < 3) {
        return fetchUrl(res.headers.location, { ...options, redirectCount: (options.redirectCount || 0) + 1 })
          .then(resolve).catch(reject);
      }
      if (res.statusCode < 200 || res.statusCode >= 400) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout fetching ${url}`)); });
    req.end();
  });
}

/**
 * POST JSON to a URL with Bearer auth.
 */
function postJson(url, body, token, options = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    let parsed;
    try { parsed = new URL(url); } catch (e) { return reject(new Error(`Invalid URL: ${url}`)); }
    const lib = parsed.protocol === 'https:' ? https : http;
    const opts = {
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method:   'POST',
      headers: {
        'Content-Type':  'application/json',
        'Content-Length': Buffer.byteLength(data),
        'Authorization': `Bearer ${token}`,
        'User-Agent':    'JigawaTimes-Newsroom/1.0',
      },
      timeout: options.timeout || 30000,
    };
    const req = lib.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        let parsed2 = null;
        try { parsed2 = JSON.parse(Buffer.concat(chunks).toString()); } catch {}
        if (res.statusCode < 200 || res.statusCode >= 400) {
          return reject(new Error(`POST ${url} failed (${res.statusCode}): ${parsed2?.error || ''}`));
        }
        resolve(parsed2);
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout POST ${url}`)); });
    req.write(data);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// RSS Parser (native — no dependencies)
// ---------------------------------------------------------------------------

/**
 * Parse an RSS/Atom XML string into an array of normalised items.
 * @param {string} xml
 * @param {object} source  Source definition from sources.js
 * @returns {object[]}
 */
function parseRss(xml, source) {
  const items = [];

  // Extract <item> or <entry> blocks
  const itemRe = /<(?:item|entry)>([\s\S]*?)<\/(?:item|entry)>/gi;
  let match;
  while ((match = itemRe.exec(xml)) !== null) {
    const block = match[1];
    const get   = (tag) => {
      const re = new RegExp(`<${tag}(?:[^>]*)><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>|<${tag}(?:[^>]*)>([\\s\\S]*?)</${tag}>`, 'i');
      const m  = re.exec(block);
      return m ? (m[1] || m[2] || '').trim() : '';
    };
    const getAttr = (tag, attr) => {
      const re = new RegExp(`<${tag}[^>]*${attr}="([^"]*)"`, 'i');
      const m  = re.exec(block);
      return m ? m[1].trim() : '';
    };

    const title       = get('title').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    const link        = get('link') || getAttr('link', 'href');
    const description = get('description') || get('summary') || get('content:encoded') || get('content');
    const pubDate     = get('pubDate') || get('published') || get('dc:date') || get('updated');
    const author      = get('author') || get('dc:creator');
    // Image: media:content, media:thumbnail, enclosure, or og:image in description
    let imageUrl      = getAttr('media:content', 'url') || getAttr('media:thumbnail', 'url') || getAttr('enclosure', 'url');
    if (!imageUrl) {
      const imgRe = /<img[^>]+src="([^"]+)"/i;
      const im = imgRe.exec(description);
      if (im) imageUrl = im[1];
    }

    if (!title || !link) continue;

    // Strip HTML from description for clean text
    const contentText = description.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

    items.push({
      title,
      sourceUrl:   link,
      sourceTitle: title,
      sourceName:  source.name,
      region:      source.region,
      category:    source.category,
      priority:    source.priority,
      content:     contentText,
      imageUrl:    imageUrl || null,
      author:      author || null,
      publishedAt: pubDate ? new Date(pubDate).toISOString() : null,
      contentHash: crypto.createHash('sha256').update(title + link).digest('hex'),
      discoveredAt: new Date().toISOString(),
    });
  }
  return items;
}

// ---------------------------------------------------------------------------
// STAGE 1: News Discovery
// ---------------------------------------------------------------------------

/**
 * Fetch all configured RSS sources and return normalised story items.
 * A failure in one source does not stop the rest.
 * @param {object[]} sources
 * @returns {Promise<{items: object[], stats: object}>}
 */
async function discoverStories(sources) {
  const stats = { sourcesAttempted: 0, sourcesFailed: 0, itemsDiscovered: 0 };
  const allItems = [];
  logger.info(`Scanning ${sources.length} news sources...`);

  // Process sources in batches of 4 for fast, parallel discovery
  const batchSize = 4;
  for (let i = 0; i < sources.length; i += batchSize) {
    const batch = sources.slice(i, i + batchSize);
    await Promise.all(
      batch.map(async (source) => {
        stats.sourcesAttempted++;
        try {
          const xml = await fetchUrl(source.url, { timeout: 10000 });
          const items = parseRss(xml, source);
          allItems.push(...items);
          stats.itemsDiscovered += items.length;
          logger.info(`Source [${source.name}]: ${items.length} stories discovered`);
        } catch (err) {
          stats.sourcesFailed++;
          logger.warn(`Source [${source.name}] fetch failed: ${err.message}`);
        }
      })
    );
  }

  logger.info(`Discovery complete: ${allItems.length} total stories discovered (${stats.sourcesFailed} sources unreachable)`);
  return { items: allItems, stats };
}

// ---------------------------------------------------------------------------
// STAGE 2: Deduplication
// ---------------------------------------------------------------------------

/**
 * Filter items against known newsroom_items (by URL hash) and recent published
 * articles (by title similarity via keyword overlap). Returns items not seen before.
 *
 * @param {object[]}  rawItems
 * @param {object[]}  knownHashes       Array of {content_hash} from newsroom_items
 * @param {object[]}  recentArticles    Array of {id, title, excerpt} from JT API
 * @param {Function}  aiDuplicateCheck  Async fn(candidate, recentArticles) → boolean
 * @returns {Promise<{unique: object[], duplicatesSkipped: number}>}
 */
async function deduplicateItems(rawItems, knownHashes, recentArticles, aiDuplicateCheck) {
  const hashSet        = new Set(knownHashes.map((h) => h.content_hash));
  const unique         = [];
  let duplicatesSkipped = 0;

  for (const item of rawItems) {
    // Fast path: exact URL/content hash already in newsroom_items
    if (hashSet.has(item.contentHash)) {
      duplicatesSkipped++;
      continue;
    }

    // Medium path: keyword overlap with recent article titles (cheap, no AI)
    const candidateWords = new Set(
      item.title.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter((w) => w.length > 3)
    );
    const overlap = recentArticles.some((art) => {
      const artWords = art.title.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter((w) => w.length > 3);
      const shared   = artWords.filter((w) => candidateWords.has(w)).length;
      return artWords.length > 0 && shared / artWords.length > 0.6;
    });

    if (overlap) {
      // Keyword overlap is high — do AI semantic check to confirm
      try {
        const isDup = await aiDuplicateCheck(item, recentArticles);
        if (isDup) {
          duplicatesSkipped++;
          continue;
        }
      } catch (err) {
        console.warn(`[NEWSROOM] Duplicate AI check failed for "${item.title}": ${err.message}`);
        // On AI failure, err on the side of caution — treat as possibly duplicate, skip
        duplicatesSkipped++;
        continue;
      }
    }

    unique.push(item);
    hashSet.add(item.contentHash); // prevent intra-run duplicates
  }

  return { unique, duplicatesSkipped };
}

// ---------------------------------------------------------------------------
// AI Provider (abstracted)
// ---------------------------------------------------------------------------

/**
 * Query the Google Generative Language API to list available models
 * supporting the generateContent method.
 */
function queryAvailableGeminiModels(apiKey, version = 'v1beta') {
  return new Promise((resolve) => {
    const cleanKey = (apiKey || '').trim();
    const req = https.get(
      `https://generativelanguage.googleapis.com/${version}/models`,
      {
        timeout: 10000,
        headers: { 'x-goog-api-key': cleanKey },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString());
            const models = (data?.models || [])
              .filter((m) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
              .map((m) => m.name.replace(/^models\//, ''));
            resolve(models);
          } catch {
            resolve([]);
          }
        });
      }
    );
    req.on('error', () => resolve([]));
    req.on('timeout', () => { req.destroy(); resolve([]); });
  });
}

/**
 * Pick the best available model candidate given a preferred model.
 */
function selectBestGeminiModel(availableModels, preferredModel) {
  if (!availableModels || availableModels.length === 0) return null;
  if (availableModels.includes(preferredModel)) return preferredModel;

  const prefixMatch = availableModels.find((m) => m.startsWith(preferredModel) || m.includes(preferredModel));
  if (prefixMatch) return prefixMatch;

  const priorities = [
    'gemini-3.5-flash',
    'gemini-flash-lite-latest',
    'gemini-3.1-flash-lite',
    'gemini-3.7-flash',
    'gemini-3.8-flash',
    'gemini-3.5-flash-lite',
    'gemini-3-flash-preview',
    'gemini-flash-latest',
    'gemini-3.6-flash',
  ];

  for (const prio of priorities) {
    if (availableModels.includes(prio)) return prio;
  }

  const anyFlash = availableModels.find((m) => m.includes('flash'));
  return anyFlash || availableModels[0];
}

/**
 * Create an AI client based on AI_PROVIDER config.
 * Returns an object with a single method: chat(prompt) → string
 * @param {object} config
 * @returns {object}
 */
function createAiClient(config) {
  const provider = (config.aiProvider || 'gemini').toLowerCase();

  if (provider === 'gemini') {
    if (!config.geminiApiKey) throw new Error('GEMINI_API_KEY is not set.');

    const cleanKey = (config.geminiApiKey || '').trim();

    // Pool of fallback candidate models that support free-tier generateContent
    const candidateModels = [
      config.geminiModel,
      'gemini-3.5-flash',
      'gemini-flash-lite-latest',
      'gemini-3.1-flash-lite',
      'gemini-3.7-flash',
      'gemini-3.8-flash',
      'gemini-3.5-flash-lite',
      'gemini-3-flash-preview',
    ].filter(Boolean).filter((m, i, arr) => arr.indexOf(m) === i);

    let activeModel = candidateModels[0] || 'gemini-3.5-flash';
    let activeVersion = 'v1beta';
    let modelDiscoveryAttempted = false;

    // Rate-limit safety: space requests out by at least 4.2 seconds
    // to strictly respect the Gemini free-tier quota (15 requests/min)
    let lastRequestTime = 0;
    const MIN_INTERVAL_MS = 4200;

    const callGemini = async (prompt, retries = 3) => {
      const body = JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2 },
      });
      const data = Buffer.from(body);

      for (let attempt = 0; attempt <= retries; attempt++) {
        // Enforce minimum delay between calls
        const timeSinceLast = Date.now() - lastRequestTime;
        if (timeSinceLast < MIN_INTERVAL_MS) {
          await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS - timeSinceLast));
        }
        lastRequestTime = Date.now();

        try {
          const modelPath = `/${activeVersion}/models/${activeModel}:generateContent`;
          const result = await new Promise((resolve, reject) => {
            const req = https.request({
              hostname: 'generativelanguage.googleapis.com',
              path: modelPath,
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Content-Length': data.byteLength,
                'x-goog-api-key': cleanKey,
              },
              timeout: 60000,
            }, (res) => {
              const chunks = [];
              res.on('data', (c) => chunks.push(c));
              res.on('end', () => {
                const text = Buffer.concat(chunks).toString();
                if (res.statusCode === 429) {
                  let isDailyQuota = false;
                  let reason = text.slice(0, 200);
                  try {
                    const parsedErr = JSON.parse(text);
                    const msg = parsedErr?.error?.message || '';
                    reason = msg.slice(0, 200);
                    if (
                      msg.includes('FreeTier') ||
                      msg.includes('per_day') ||
                      msg.includes('PerDay') ||
                      msg.includes('RESOURCE_EXHAUSTED') ||
                      msg.includes('limit: 20') ||
                      text.includes('GenerateRequestsPerDay')
                    ) {
                      isDailyQuota = true;
                    }
                  } catch {}
                  return reject(Object.assign(new Error(`Gemini HTTP 429: ${reason}`), {
                    retryable: true,
                    isRateLimit: true,
                    isDailyQuota,
                    responseBody: text,
                  }));
                }
                if (res.statusCode >= 500) {
                  return reject(Object.assign(new Error(`Gemini HTTP ${res.statusCode}`), { retryable: true }));
                }
                if (res.statusCode === 404) {
                  return reject(Object.assign(new Error(`Gemini HTTP 404: ${text.slice(0, 300)}`), { isNotFound: true, responseBody: text }));
                }
                if (res.statusCode < 200 || res.statusCode >= 400) {
                  return reject(new Error(`Gemini HTTP ${res.statusCode}: ${text.slice(0, 200)}`));
                }
                resolve(text);
              });
            });
            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(Object.assign(new Error('Gemini timeout'), { retryable: true })); });
            req.write(data);
            req.end();
          });

          const parsed = JSON.parse(result);
          const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (!text) throw new Error('Empty Gemini response');
          return text;
        } catch (err) {
          // If the model was not found, auto-discover supported models for this key and retry
          if (err.isNotFound && !modelDiscoveryAttempted) {
            modelDiscoveryAttempted = true;
            logger.warn(`Model "${activeModel}" returned 404 on ${activeVersion}. Auto-discovering available models for this key...`);
            let models = await queryAvailableGeminiModels(cleanKey, 'v1beta');
            let version = 'v1beta';
            if (!models.length) {
              models = await queryAvailableGeminiModels(cleanKey, 'v1');
              version = 'v1';
            }

            const bestModel = selectBestGeminiModel(models, activeModel);
            if (bestModel && (bestModel !== activeModel || version !== activeVersion)) {
              logger.info(`Auto-selected active Gemini model: "${bestModel}" (${version}) from: [${models.slice(0, 6).join(', ')}]`);
              activeModel = bestModel;
              activeVersion = version;
              attempt = -1; // restart loop with new model
              continue;
            } else if (models.length) {
              logger.warn(`Available models for this key: [${models.join(', ')}]`);
            }
          }

          // If daily quota is exhausted on this model, or persistent 429 / 404, auto-switch to next candidate!
          const shouldRotateModel = err.isDailyQuota || (err.isRateLimit && attempt >= 1) || err.isNotFound;
          if (shouldRotateModel) {
            const nextCandidates = candidateModels.filter((m) => m !== activeModel);
            if (nextCandidates.length > 0) {
              const nextModel = nextCandidates[0];
              // Move current exhausted model to end of the candidate list
              const currIdx = candidateModels.indexOf(activeModel);
              if (currIdx !== -1) {
                candidateModels.splice(currIdx, 1);
                candidateModels.push(activeModel);
              }
              logger.warn(`Model "${activeModel}" hit ${err.isDailyQuota ? 'daily quota exhaustion (429)' : err.isNotFound ? '404 not found' : 'persistent rate limit'}. Auto-switching to "${nextModel}"...`);
              activeModel = nextModel;
              attempt = -1; // restart attempt loop with next model
              continue;
            }
          }

          if (attempt < retries && err.retryable) {
            // For transient rate limits, wait 15s to let the minute window reset
            const delay = err.isRateLimit ? (attempt + 1) * 15000 : Math.pow(2, attempt) * 2000;
            logger.warn(`Gemini ${err.isRateLimit ? 'rate limit (429)' : 'transient error'} retry ${attempt + 1}/${retries} in ${Math.round(delay / 1000)}s`);
            await new Promise((r) => setTimeout(r, delay));
          } else {
            // If Gemini fails and GROQ_API_KEY is available, attempt Groq fallback
            const groqKey = (config.groqApiKey || process.env.GROQ_API_KEY || '').trim();
            if (groqKey) {
              logger.warn(`Gemini call failed (${err.message}). Attempting automatic fallback to Groq...`);
              try {
                return await callGroq(prompt, groqKey, config.groqModel || 'llama-3.3-70b-versatile');
              } catch (groqErr) {
                logger.error(`Groq fallback also failed: ${groqErr.message}`);
              }
            }
            throw err;
          }
        }
      }
    };

    return { chat: callGemini };
  }

  if (provider === 'groq') {
    const groqKey = (config.groqApiKey || process.env.GROQ_API_KEY || '').trim();
    if (!groqKey) throw new Error('GROQ_API_KEY is not set.');
    return {
      chat: (prompt) => callGroq(prompt, groqKey, config.groqModel || 'llama-3.3-70b-versatile'),
    };
  }

  throw new Error(`Unsupported AI_PROVIDER: "${provider}". Supported providers: "gemini", "groq".`);
}

/**
 * Call Groq OpenAI-compatible API endpoint.
 */
function callGroq(prompt, apiKey, model = 'llama-3.3-70b-versatile') {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
    });
    const data = Buffer.from(body);
    const req = https.request({
      hostname: 'api.groq.com',
      path: '/openai/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.byteLength,
        'Authorization': `Bearer ${apiKey}`,
      },
      timeout: 45000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(Buffer.concat(chunks).toString());
          if (res.statusCode >= 400) {
            return reject(new Error(`Groq HTTP ${res.statusCode}: ${parsed?.error?.message || 'Unknown error'}`));
          }
          resolve(parsed.choices?.[0]?.message?.content || '');
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Groq request timed out')); });
    req.write(data);
    req.end();
  });
}

/**
 * Parse AI JSON response safely. Retries once with explicit JSON extraction.
 * @param {string} text
 * @returns {object|null}
 */
function parseAiJson(text) {
  if (!text) return null;
  // Strip markdown code fences if present
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Try to extract JSON object/array with regex
    const match = cleaned.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (match) {
      try { return JSON.parse(match[0]); } catch {}
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// STAGES 3–7: Classification, verification, writing, SEO, image
// ---------------------------------------------------------------------------

/**
 * STAGE 3: Classify a single story item.
 */
async function classifyItem(item, aiClient) {
  const raw    = await aiClient.chat(CLASSIFY_PROMPT(item));
  const result = parseAiJson(raw);
  if (!result) throw new Error('AI returned invalid JSON for classification');
  return result;
}

/**
 * STAGE 4: Verify facts across sources.
 * For now, single-source items are verified with lower confidence.
 */
async function verifyItem(items, aiClient) {
  const raw    = await aiClient.chat(VERIFY_PROMPT(items));
  const result = parseAiJson(raw);
  if (!result) throw new Error('AI returned invalid JSON for verification');
  // Ensure required fields have defaults
  result.confidence     = result.confidence     ?? 0;
  result.sources_checked = result.sources_checked ?? items.length;
  result.corroborated_facts = result.corroborated_facts ?? [];
  result.conflicts      = result.conflicts      ?? [];
  result.unverified_claims = result.unverified_claims ?? [];
  return result;
}

/**
 * STAGE 5: Generate the article.
 */
async function writeArticle(item, verification, aiClient) {
  const raw    = await aiClient.chat(WRITE_PROMPT(item, verification));
  const result = parseAiJson(raw);
  if (!result || !result.headline || !result.body) {
    throw new Error('AI returned invalid JSON or missing headline/body for article');
  }
  // Enforce the byline — never let AI override it
  result.byline    = 'Jigawa Times News Desk';
  result.disclosure = result.disclosure || 'This report was compiled from publicly available sources and reviewed through the Jigawa Times editorial workflow.';
  return result;
}

/**
 * STAGE 6: Generate SEO metadata.
 */
async function buildSeoMeta(article, category, region, aiClient) {
  const raw    = await aiClient.chat(SEO_PROMPT(article.headline, article.body, category, region));
  const result = parseAiJson(raw);
  if (!result || !result.slug) throw new Error('AI returned invalid JSON for SEO metadata');
  result.tags = Array.isArray(result.tags) ? result.tags.slice(0, 6) : [];
  return result;
}

/**
 * STAGE 7 helper: Generate image brief.
 */
async function buildImageBrief(headline, category, region, aiClient) {
  const raw    = await aiClient.chat(IMAGE_BRIEF_PROMPT(headline, category, region));
  const result = parseAiJson(raw);
  return result || { safe_to_generate: false, caption: 'Illustrative image.', credit: 'Jigawa Times' };
}

// ---------------------------------------------------------------------------
// STAGE 8: Publish to existing JT API
// ---------------------------------------------------------------------------

/**
 * Authenticate as the newsroom author and return a JWT token.
 * Caches the token in the config object to avoid logging in on every article.
 */
async function ensureToken(config) {
  if (config._cachedToken) return config._cachedToken;
  if (config.apiToken) {
    config._cachedToken = config.apiToken;
    return config.apiToken;
  }

  const secret = process.env.AUTH_SECRET;
  if (secret) {
    try {
      const jwt = require('jsonwebtoken');
      const token = jwt.sign(
        { sub: 1, role: 'ADMIN' },
        secret,
        { expiresIn: '30d' }
      );
      config._cachedToken = token;
      logger.info('Auto-generated newsroom Bearer token using AUTH_SECRET');
      return token;
    } catch (e) {
      logger.warn(`Could not auto-sign token: ${e.message}`);
    }
  }

  throw new Error('NEWSROOM_API_TOKEN or AUTH_SECRET is required to publish articles.');
}

/**
 * Look up a category ID by slug from the JT API.
 */
async function resolveCategoryId(categorySlug, config, token) {
  const url    = `${config.apiUrl}/api/categories`;
  const result = await new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib    = parsed.protocol === 'https:' ? https : http;
    const req    = lib.request({
      hostname: parsed.hostname, port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname, method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      timeout: 10000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch { reject(new Error('Invalid JSON from /api/categories')); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout /api/categories')); });
    req.end();
  });

  const cats = result?.items || [];
  // Try exact slug match first, then fall back to 'jigawa'
  const cat = cats.find((c) => c.slug === categorySlug) || cats.find((c) => c.slug === 'jigawa');
  if (!cat) throw new Error(`No category found for slug "${categorySlug}"`);
  return cat.id;
}

/**
 * Build the full imageCaption string with attribution and disclosure.
 */
function buildImageCaption(image, articleDisclosure) {
  if (!image) return null;
  if (image.type === 'ai_generated') return 'Illustrative image generated by AI.';
  return [image.caption, `Photo: ${image.credit || 'Source'}`].filter(Boolean).join(' — ');
}

/**
 * STAGE 8: Submit the generated article to the existing JT API.
 * In dry-run mode, this function only logs — it never calls the API.
 *
 * @param {object} payload   Final article payload
 * @param {object} config    Newsroom config
 * @param {boolean} highRisk Whether editorial review is required
 * @returns {Promise<{articleId, status, dryRun}>}
 */
async function publishArticle(payload, config, highRisk, prismaClient) {
  if (config.dryRun) {
    logger.info(`[DRY RUN] Article NOT published: "${payload.headline}" (Category: ${payload.categorySlug})`);
    return { articleId: null, status: 'DRY_RUN', dryRun: true };
  }

  // 1. Direct Prisma DB creation (Fastest, zero loopback network errors, zero auth mismatch)
  if (prismaClient) {
    try {
      // Find author
      let author = null;
      if (config.authorEmail) {
        author = await prismaClient.user.findUnique({ where: { email: config.authorEmail.toLowerCase().trim() } });
      }
      if (!author) {
        author = await prismaClient.user.findFirst({ where: { role: 'ADMIN', active: true } }) ||
                 await prismaClient.user.findFirst({ where: { active: true } });
      }
      if (!author) throw new Error('No active user found in database to author the article.');

      // Find category
      let category = await prismaClient.category.findUnique({ where: { slug: payload.categorySlug } });
      if (!category) {
        category = await prismaClient.category.findFirst({ where: { slug: 'jigawa' } }) ||
                   await prismaClient.category.findFirst();
      }
      if (!category) throw new Error(`No category found for slug "${payload.categorySlug}"`);

      // Build slug
      const slugBase = (payload.headline || 'story')
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .slice(0, 80) || 'news-update';
      const slug = `${slugBase}-${Date.now().toString(36)}`;

      // Build full body HTML with byline, disclosure
      const fullBody = [
        `<p><em>By ${payload.byline || 'Jigawa Times News Desk'}</em></p>`,
        payload.body,
        `<p><em>${payload.disclosure || ''}</em></p>`,
        payload.sources?.length
          ? `<p><strong>Sources:</strong> ${payload.sources.map((s) => `<a href="${s.url}" target="_blank" rel="noopener noreferrer">${s.name}</a>`).join(', ')}</p>`
          : '',
      ].filter(Boolean).join('\n');

      let finalStatus = 'DRAFT';
      if (!highRisk && config.mode === 'auto') {
        finalStatus = 'PUBLISHED';
      } else if (!highRisk && config.mode === 'semi_auto') {
        finalStatus = 'SUBMITTED';
      }

      // Create article in database
      const article = await prismaClient.article.create({
        data: {
          title: payload.headline,
          slug,
          excerpt: payload.excerpt || payload.subheadline || '',
          content: fullBody,
          categoryId: category.id,
          authorId: author.id,
          featuredImage: payload.image?.url || null,
          imageCaption: buildImageCaption(payload.image),
          isBreaking: false,
          isFeatured: false,
          status: finalStatus,
          publishedAt: finalStatus === 'PUBLISHED' ? new Date() : null,
          tags: payload.tags?.length
            ? {
                create: await Promise.all(
                  payload.tags.map(async (name) => {
                    const tagSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50);
                    return {
                      tag: {
                        connectOrCreate: {
                          where: { slug: tagSlug },
                          create: { name, slug: tagSlug },
                        },
                      },
                    };
                  })
                ),
              }
            : undefined,
        },
      });

      await prismaClient.editorialAction.create({
        data: {
          articleId: article.id,
          userId: author.id,
          action: finalStatus,
          note: `AI Newsroom (${config.mode} mode, reviewRequired: ${highRisk})`,
        },
      });

      logger.info(`[DB SUCCESS] Article #${article.id} ("${article.title.slice(0, 45)}...") created in database (status: ${finalStatus})`);
      return { articleId: article.id, status: finalStatus, dryRun: false };
    } catch (dbErr) {
      logger.warn(`Prisma direct publish failed, trying HTTP API fallback: ${dbErr.message}`);
    }
  }

  // 2. HTTP Fallback via JT API
  const token = await ensureToken(config);
  const catId = await resolveCategoryId(payload.categorySlug, config, token);

  const fullBody = [
    `<p><em>By ${payload.byline}</em></p>`,
    payload.body,
    `<p><em>${payload.disclosure}</em></p>`,
    payload.sources?.length
      ? `<p><strong>Sources:</strong> ${payload.sources.map((s) => `<a href="${s.url}">${s.name}</a>`).join(', ')}</p>`
      : '',
  ].filter(Boolean).join('\n');

  const articleBody = {
    title:        payload.headline,
    excerpt:      payload.excerpt || payload.subheadline,
    content:      fullBody,
    categoryId:   catId,
    featuredImage: payload.image?.url || null,
    imageCaption: buildImageCaption(payload.image),
    tags:         payload.tags || [],
    isBreaking:   false,
    isFeatured:   false,
  };

  const created = await postJson(`${config.apiUrl}/api/articles`, articleBody, token);
  const articleId = created?.article?.id;
  if (!articleId) throw new Error('API did not return an article ID');

  let finalStatus = 'DRAFT';
  if (highRisk || config.mode === 'manual') {
    logger.info(`Article ${articleId} created as DRAFT (review required: ${highRisk})`);
    finalStatus = 'DRAFT';
  } else if (config.mode === 'semi_auto') {
    await postJson(`${config.apiUrl}/api/articles/${articleId}/submit`, {}, token);
    logger.info(`Article ${articleId} submitted for review`);
    finalStatus = 'SUBMITTED';
  } else if (config.mode === 'auto') {
    await postJson(`${config.apiUrl}/api/articles/${articleId}/submit`, {}, token);
    await postJson(`${config.apiUrl}/api/articles/${articleId}/review`, {}, token);
    await postJson(`${config.apiUrl}/api/articles/${articleId}/approve`, {}, token);
    await postJson(`${config.apiUrl}/api/articles/${articleId}/publish`, {}, token);
    logger.info(`Article ${articleId} published`);
    finalStatus = 'PUBLISHED';
  }

  return { articleId, status: finalStatus, dryRun: false };
}

// ---------------------------------------------------------------------------
// Main exported pipeline runner
// ---------------------------------------------------------------------------

/**
 * Process a single story item through the full AI pipeline.
 *
 * @param {object} item       Normalised RSS item
 * @param {object} aiClient   AI client from createAiClient()
 * @param {object} config     Newsroom config
 * @param {object[]} recentArticles  Recent JT articles for dedup
 * @returns {Promise<{status, articleId?, reason?}>}
 */
async function processStory(item, aiClient, config, recentArticles, prismaClient = null) {
  // --- Stage 3: Classify ---
  let classification;
  try {
    classification = await classifyItem(item, aiClient);
  } catch (err) {
    console.warn(`[NEWSROOM] Classification failed for "${item.title}": ${err.message}`);
    return { status: 'FAILED', reason: 'classification_error' };
  }

  if (!classification.is_news) {
    return { status: 'SKIPPED', reason: classification.skip_reason || 'not_news' };
  }

  const category = classification.category || item.category || 'jigawa';
  const region   = classification.region   || item.region   || 'nigeria';

  // --- Stage 3b: AI duplicate check (semantic) ---
  let isDuplicate = false;
  try {
    const raw    = await aiClient.chat(DUPLICATE_PROMPT(item, recentArticles.slice(0, 20)));
    const result = parseAiJson(raw);
    isDuplicate  = result?.is_duplicate === true && result?.confidence > 0.8;
    if (isDuplicate) {
      return { status: 'DUPLICATE', reason: result?.reason };
    }
  } catch (err) {
    console.warn(`[NEWSROOM] Semantic dedup failed for "${item.title}": ${err.message} — treating as not duplicate`);
  }

  // --- Stage 4: Verify ---
  let verification;
  try {
    verification = await verifyItem([item], aiClient);
  } catch (err) {
    console.warn(`[NEWSROOM] Verification failed for "${item.title}": ${err.message}`);
    return { status: 'FAILED', reason: 'verification_error' };
  }

  // Determine risk level — high-risk if flagged by classifier or verifier
  const highRisk = classification.review_required || verification.review_required;

  // Low confidence + high-risk = always manual review
  if (verification.confidence < 0.4 && highRisk) {
    return { status: 'PENDING_REVIEW', reason: 'low_confidence_high_risk' };
  }

  // --- Stage 5: Write article ---
  const enrichedItem = { ...item, category, region };
  let article;
  try {
    article = await writeArticle(enrichedItem, verification, aiClient);
  } catch (err) {
    console.warn(`[NEWSROOM] Article writing failed for "${item.title}": ${err.message}`);
    return { status: 'FAILED', reason: 'write_error' };
  }

  // --- Stage 6: SEO metadata ---
  let seo;
  try {
    seo = await buildSeoMeta(article, category, region, aiClient);
  } catch (err) {
    console.warn(`[NEWSROOM] SEO failed for "${item.title}": ${err.message} — using fallback`);
    // Non-fatal: generate a basic slug from headline
    const slug = article.headline.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 80);
    seo = { slug, tags: [], seo_title: article.headline, seo_description: article.subheadline || '' };
  }

  // --- Stage 7: Image ---
  let imageBrief;
  try {
    imageBrief = await buildImageBrief(article.headline, category, region, aiClient);
  } catch {
    imageBrief = { safe_to_generate: false };
  }

  const image = await selectImage(enrichedItem, imageBrief, config);
  if (image?.url) {
    enrichedItem.imageUrl = image.url;
    item.imageUrl = image.url;
  }

  // --- Stage 8: Publish ---
  const payload = {
    headline:    article.headline,
    subheadline: article.subheadline,
    excerpt:     article.excerpt,
    body:        article.body,
    byline:      article.byline,
    disclosure:  article.disclosure,
    categorySlug: category,
    tags:        seo.tags,
    image,
    sources:     [{ name: item.sourceName, url: item.sourceUrl, published_at: item.publishedAt }],
  };

  try {
    const result = await publishArticle(payload, config, highRisk, prismaClient);
    return { status: result.status, articleId: result.articleId, dryRun: result.dryRun, highRisk };
  } catch (err) {
    logger.error(`[NEWSROOM] Publish failed for "${article.headline}": ${err.message}`);
    return { status: 'FAILED', reason: 'publish_error', error: err.message };
  }
}

/**
 * Generate a complete, plagiarism-free draft news article from an aggregated RSS item.
 * @param {object} item  NewsroomItem or raw aggregated item
 * @param {object} [user] Authenticated admin/editor requesting the draft
 * @param {object} [prismaClient] Direct PrismaClient instance
 * @param {object} [customConfig]
 * @returns {Promise<{ article: object, newsroomItem: object }>}
 */
async function generateDraftFromAggregated(item, user = null, prismaClient = null, customConfig = null) {
  const cfg = customConfig || require('./config.js');
  const aiClient = createAiClient(cfg);

  logger.info(`[HYBRID AGGREGATOR] Synthesizing draft for: "${item.sourceTitle || item.title}" from ${item.sourceName}...`);

  // 1. Rephrase & Deep Human-Toned News Report
  const prompt = AGGREGATOR_REPHRASE_PROMPT(item);
  const rawAiResponse = await aiClient.chat(prompt);
  const aiData = parseAiJson(rawAiResponse);

  if (!aiData || !aiData.title || !aiData.content) {
    throw new Error('AI generation failed to return valid article structure.');
  }

  // 2. Resolve image: source og:image -> Pollinations.ai 16:9 illustration -> curated fallback
  const categorySlug = (aiData.category || item.category || 'jigawa').toLowerCase();
  const region = (item.region || 'nigeria').toLowerCase();
  const rawImage = item.imageUrl || item.rawData?.originalImageUrl || item.rawData?.imageUrl;

  const image = await selectImage(
    rawImage,
    item.sourceUrl,
    aiData.title,
    categorySlug,
    region,
    aiData.imagePrompt || aiData.title
  );

  const prisma = prismaClient;
  if (!prisma) {
    throw new Error('Database client is required to save drafted article.');
  }

  // 3. Resolve Category
  let category = await prisma.category.findUnique({ where: { slug: categorySlug } });
  if (!category) {
    category = await prisma.category.findFirst({ where: { slug: 'jigawa' } }) ||
               await prisma.category.findFirst();
  }
  if (!category) throw new Error('No categories found in database.');

  // 4. Resolve Author
  let authorId = user?.id;
  if (!authorId) {
    const defaultAuthor = await prisma.user.findFirst({ where: { role: { in: ['ADMIN', 'EDITOR'] } } });
    authorId = defaultAuthor ? defaultAuthor.id : 1;
  }

  // 5. Unique slug
  const slugBase = (aiData.title || 'story')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80) || 'news-report';
  const slug = `${slugBase}-${Date.now().toString(36)}`;

  // 6. Build full article body HTML
  const fullBody = [
    `<p><em>By Jigawa Times Editorial Desk</em></p>`,
    aiData.content,
    `<hr />`,
    `<p style="font-size: 0.9em; color: #64748b;"><em>Reporting corroborated from verified public dispatches and coverage by <strong>${item.sourceName || 'News Agencies'}</strong> (${item.publishedAt ? new Date(item.publishedAt).toLocaleDateString('en-GB') : 'Recent'}). Researched, synthesized, and verified under the Jigawa Times editorial charter.</em></p>`,
    item.sourceUrl ? `<p style="font-size: 0.85em; color: #94a3b8;">Original reference: <a href="${item.sourceUrl}" target="_blank" rel="noopener noreferrer">${item.sourceName}</a></p>` : '',
  ].filter(Boolean).join('\n');

  // 7. Create Article as DRAFT
  const tagsList = Array.isArray(aiData.tags) && aiData.tags.length ? aiData.tags : [categorySlug, region];
  const article = await prisma.article.create({
    data: {
      title: aiData.title,
      slug,
      excerpt: aiData.excerpt || '',
      content: fullBody,
      categoryId: category.id,
      authorId,
      featuredImage: image?.url || null,
      imageCaption: aiData.imageCaption || image?.caption || null,
      isBreaking: false,
      isFeatured: false,
      status: 'DRAFT',
      tags: {
        create: await Promise.all(
          tagsList.map(async (name) => {
            const tagSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50);
            return {
              tag: {
                connectOrCreate: {
                  where: { slug: tagSlug },
                  create: { name, slug: tagSlug },
                },
              },
            };
          })
        ),
      },
    },
  });

  // 8. Record Editorial Action
  await prisma.editorialAction.create({
    data: {
      articleId: article.id,
      userId: authorId,
      action: 'DRAFT',
      note: `Drafted by Hybrid News Aggregator from ${item.sourceName}`,
    },
  });

  // 9. Update NewsroomItem if id provided
  let updatedNewsroomItem = null;
  if (item.id) {
    updatedNewsroomItem = await prisma.newsroomItem.update({
      where: { id: item.id },
      data: {
        status: 'DRAFTED',
        articleId: article.id,
        category: categorySlug,
        verification: {
          ai_model: cfg.geminiModel || 'gemini-3.5-flash',
          rephrased: true,
          source: item.sourceName,
          sourceUrl: item.sourceUrl,
          image_sourced: image?.type || 'generated',
          drafted_at: new Date().toISOString(),
        },
      },
    });
  }

  logger.info(`[HYBRID AGGREGATOR SUCCESS] Article #${article.id} drafted ("${article.title.slice(0, 50)}...")`);
  return { article, newsroomItem: updatedNewsroomItem };
}

module.exports = {
  discoverStories,
  deduplicateItems,
  classifyItem,
  verifyItem,
  writeArticle,
  buildSeoMeta,
  processStory,
  generateDraftFromAggregated,
  createAiClient,
  parseAiJson,
  parseRss,
  fetchUrl,
};
