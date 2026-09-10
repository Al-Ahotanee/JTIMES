// newsroom/index.js
// AI Newsroom orchestrator.
//
// Usage (manual run):
//   node newsroom/index.js
//   npm run newsroom
//   npm run newsroom:dry
//
// Usage (from server.js — scheduled):
//   const { startScheduler } = require('./newsroom/index.js');
//   startScheduler();
//
// The pipeline:
//   1. Fetch all RSS sources
//   2. Deduplicate against known items + recent articles
//   3. For each new story: classify → verify → write → image → publish
//   4. Persist newsroom_items status to the DB via the JT API
//   5. Log a summary

'use strict';

const config  = require('./config.js');
const SOURCES = require('./sources.js');
const {
  discoverStories,
  deduplicateItems,
  processStory,
  createAiClient,
  fetchUrl,
} = require('./agent.js');

// ---------------------------------------------------------------------------
// Fetch helpers for existing JT API (read-only — no write operations here)
// ---------------------------------------------------------------------------

async function getRecentArticles(apiUrl, token) {
  try {
    const url  = `${apiUrl}/api/articles?pageSize=50&status=PUBLISHED`;
    const data = await fetchUrl(url, {
      timeout: 10000,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const parsed = JSON.parse(data);
    return (parsed.items || []).map((a) => ({ id: a.id, title: a.title, excerpt: a.excerpt || '' }));
  } catch (err) {
    console.warn(`[NEWSROOM] Could not fetch recent articles: ${err.message}`);
    return [];
  }
}

async function getKnownHashes(apiUrl, token) {
  try {
    const url  = `${apiUrl}/api/newsroom/items?pageSize=500`;
    const data = await fetchUrl(url, {
      timeout: 10000,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const parsed = JSON.parse(data);
    return (parsed.items || []).map((i) => ({ content_hash: i.content_hash }));
  } catch (err) {
    console.warn(`[NEWSROOM] Could not fetch known newsroom hashes: ${err.message}`);
    return [];
  }
}

async function saveNewsroomItem(apiUrl, token, item, status, articleId) {
  try {
    const url  = `${apiUrl}/api/newsroom/items`;
    const body = JSON.stringify({
      source_url:   item.sourceUrl,
      source_name:  item.sourceName,
      source_title: item.title,
      content_hash: item.contentHash,
      status,
      category:     item.category,
      article_id:   articleId || null,
      raw_data:     {
        region:      item.region,
        publishedAt: item.publishedAt,
        imageUrl:    item.imageUrl,
      },
    });
    const https = require('https');
    const http  = require('http');
    const parsed = new URL(url);
    const lib  = parsed.protocol === 'https:' ? https : http;
    const dataBuffer = Buffer.from(body);
    await new Promise((resolve, reject) => {
      const req = lib.request({
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': dataBuffer.byteLength,
          Authorization: `Bearer ${token}`,
        },
        timeout: 10000,
      }, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
      req.write(dataBuffer);
      req.end();
    });
  } catch (err) {
    // Non-fatal — just log; the article was already created
    console.warn(`[NEWSROOM] Could not save newsroom item for "${item.title}": ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Controlled concurrency
// ---------------------------------------------------------------------------
async function runWithConcurrency(tasks, limit, onItem) {
  const results = [];
  const queue   = [...tasks];
  const workers = Array(Math.min(limit, queue.length)).fill(null).map(async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      results.push(await onItem(item).catch((err) => ({ status: 'FAILED', reason: err.message })));
    }
  });
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// Core run function
// ---------------------------------------------------------------------------

/**
 * Run one complete newsroom cycle:
 *   discover → deduplicate → process (classify + verify + write + publish)
 *
 * @returns {Promise<object>} Summary statistics
 */
async function runNewsroom() {
  const startTime = Date.now();
  console.log('[NEWSROOM] ════════════════════════════════════════');
  console.log(`[NEWSROOM] Scan started at ${new Date().toISOString()}`);
  console.log(`[NEWSROOM] Mode: ${config.mode} | Dry-run: ${config.dryRun}`);
  console.log('[NEWSROOM] ════════════════════════════════════════');

  // --- Check AI is configured ---
  let aiClient;
  try {
    aiClient = createAiClient(config);
  } catch (err) {
    console.error(`[NEWSROOM] AI client init failed: ${err.message}`);
    console.error('[NEWSROOM] Set AI_PROVIDER and the corresponding API key in .env');
    return { error: err.message };
  }

  const token = config.apiToken || null;

  // --- Stage 1: Discover ---
  const { items: rawItems, stats: discoverStats } = await discoverStories(SOURCES);
  console.log(`[NEWSROOM] ${rawItems.length} stories discovered from ${discoverStats.sourcesAttempted} sources (${discoverStats.sourcesFailed} failed)`);

  if (rawItems.length === 0) {
    console.log('[NEWSROOM] No stories found. Exiting.');
    return { discovered: 0, processed: 0, published: 0, failed: 0 };
  }

  // --- Stage 2: Deduplicate ---
  const [knownHashes, recentArticles] = await Promise.all([
    getKnownHashes(config.apiUrl, token),
    getRecentArticles(config.apiUrl, token),
  ]);

  // Cheap dedup: hash + keyword overlap (before calling AI)
  const { unique: candidates, duplicatesSkipped: cheapDupes } = await deduplicateItems(
    rawItems,
    knownHashes,
    recentArticles,
    async () => false  // AI semantic dedup handled inside processStory
  );
  console.log(`[NEWSROOM] ${cheapDupes} duplicates skipped (hash/keyword); ${candidates.length} candidates to analyse`);

  if (candidates.length === 0) {
    console.log('[NEWSROOM] All stories are duplicates or already seen. Done.');
    return { discovered: rawItems.length, duplicatesSkipped: cheapDupes, processed: 0, published: 0 };
  }

  // --- Stages 3–8: Process candidates with controlled concurrency ---
  const stats = { processed: 0, published: 0, pendingReview: 0, skipped: 0, failed: 0, dryRun: 0 };

  await runWithConcurrency(candidates, config.concurrency, async (item) => {
    stats.processed++;
    console.log(`[NEWSROOM] Processing (${stats.processed}/${candidates.length}): ${item.title}`);

    const result = await processStory(item, aiClient, config, recentArticles);

    switch (result.status) {
      case 'PUBLISHED':     stats.published++;     break;
      case 'SUBMITTED':     stats.pendingReview++; break;
      case 'DRAFT':         stats.pendingReview++; break;
      case 'PENDING_REVIEW':stats.pendingReview++; break;
      case 'SKIPPED':       stats.skipped++;       break;
      case 'DUPLICATE':     stats.skipped++;       break;
      case 'DRY_RUN':       stats.dryRun++;        break;
      case 'FAILED':
      default:              stats.failed++;         break;
    }

    // Persist to newsroom_items (non-fatal if it fails)
    if (!config.dryRun && token) {
      await saveNewsroomItem(config.apiUrl, token, item, result.status, result.articleId);
    }

    return result;
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('[NEWSROOM] ════════════════════════════════════════');
  console.log(`[NEWSROOM] Scan complete in ${elapsed}s`);
  console.log(`[NEWSROOM] ${rawItems.length} stories discovered`);
  console.log(`[NEWSROOM] ${cheapDupes} duplicates skipped`);
  console.log(`[NEWSROOM] ${candidates.length} stories sent to AI`);
  console.log(`[NEWSROOM] ${stats.skipped} stories skipped (not news / semantic dupe)`);
  console.log(`[NEWSROOM] ${stats.published} articles published`);
  console.log(`[NEWSROOM] ${stats.pendingReview} require editorial review`);
  console.log(`[NEWSROOM] ${stats.dryRun} articles prepared (dry-run — not published)`);
  console.log(`[NEWSROOM] ${stats.failed} failures`);
  console.log('[NEWSROOM] ════════════════════════════════════════');

  return { discovered: rawItems.length, duplicatesSkipped: cheapDupes, ...stats };
}

// ---------------------------------------------------------------------------
// Scheduler (runs inside the existing Express process)
// ---------------------------------------------------------------------------

let _schedulerTimer = null;

/**
 * Start the periodic newsroom scheduler.
 * Runs immediately once, then repeats every NEWSROOM_INTERVAL_MINUTES.
 * Call this from server.js after app.listen().
 */
function startScheduler() {
  const minutes = config.intervalMinutes;
  if (!minutes || minutes <= 0) {
    console.log('[NEWSROOM] Scheduler disabled (NEWSROOM_INTERVAL_MINUTES=0 or not set). Use `npm run newsroom` to run manually.');
    return;
  }

  const ms = minutes * 60 * 1000;
  console.log(`[NEWSROOM] Scheduler starting — runs every ${minutes} minute(s)`);

  // Run immediately on startup, then on interval
  runNewsroom().catch((err) => console.error('[NEWSROOM] Scheduler run error:', err.message));
  _schedulerTimer = setInterval(() => {
    runNewsroom().catch((err) => console.error('[NEWSROOM] Scheduler run error:', err.message));
  }, ms);
}

/**
 * Stop the scheduler (for graceful shutdown).
 */
function stopScheduler() {
  if (_schedulerTimer) {
    clearInterval(_schedulerTimer);
    _schedulerTimer = null;
    console.log('[NEWSROOM] Scheduler stopped.');
  }
}

module.exports = { runNewsroom, startScheduler, stopScheduler };

// ---------------------------------------------------------------------------
// CLI entry point: node newsroom/index.js
// ---------------------------------------------------------------------------
if (require.main === module) {
  // When run directly, force-load .env if dotenv is available
  try {
    // Attempt to load dotenv from project root (optional dev dependency)
    const path = require('path');
    require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
  } catch {
    // dotenv not installed — rely on env vars already being set
  }

  runNewsroom()
    .then((summary) => {
      if (summary.error) process.exit(1);
      process.exit(0);
    })
    .catch((err) => {
      console.error('[NEWSROOM] Fatal error:', err.message);
      process.exit(1);
    });
}
