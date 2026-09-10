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
//   4. Persist newsroom_items status to the DB via Prisma or API
//   5. Log a structured summary to console and in-memory buffer

'use strict';

const config  = require('./config.js');
const SOURCES = require('./sources.js');
const logger  = require('./logger.js');
const {
  discoverStories,
  deduplicateItems,
  processStory,
  createAiClient,
  fetchUrl,
} = require('./agent.js');

let prismaClient = null;
try {
  const { PrismaClient } = require('@prisma/client');
  prismaClient = new PrismaClient();
} catch {}

// ---------------------------------------------------------------------------
// Database / API helpers (Prisma first, HTTP fallback)
// ---------------------------------------------------------------------------

async function getRecentArticles(apiUrl, token) {
  if (prismaClient) {
    try {
      const rows = await prismaClient.article.findMany({
        where: { status: 'PUBLISHED' },
        select: { id: true, title: true, excerpt: true },
        orderBy: { publishedAt: 'desc' },
        take: 50,
      });
      return rows.map((a) => ({ id: a.id, title: a.title, excerpt: a.excerpt || '' }));
    } catch (e) {
      logger.warn(`Prisma recent articles query failed, falling back to HTTP: ${e.message}`);
    }
  }

  try {
    const url  = `${apiUrl}/api/articles?pageSize=50&status=PUBLISHED`;
    const data = await fetchUrl(url, {
      timeout: 10000,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const parsed = JSON.parse(data);
    return (parsed.items || []).map((a) => ({ id: a.id, title: a.title, excerpt: a.excerpt || '' }));
  } catch (err) {
    logger.warn(`Could not fetch recent articles: ${err.message}`);
    return [];
  }
}

async function getKnownHashes(apiUrl, token) {
  if (prismaClient) {
    try {
      const rows = await prismaClient.newsroomItem.findMany({
        select: { contentHash: true },
        take: 1000,
      });
      return rows.map((i) => ({ content_hash: i.contentHash }));
    } catch (e) {
      logger.warn(`Prisma known hashes query failed, falling back to HTTP: ${e.message}`);
    }
  }

  try {
    const url  = `${apiUrl}/api/newsroom/items?pageSize=500`;
    const data = await fetchUrl(url, {
      timeout: 10000,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const parsed = JSON.parse(data);
    return (parsed.items || []).map((i) => ({ content_hash: i.content_hash }));
  } catch (err) {
    logger.warn(`Could not fetch known newsroom hashes: ${err.message}`);
    return [];
  }
}

async function saveNewsroomItem(apiUrl, token, item, status, articleId) {
  if (prismaClient) {
    try {
      await prismaClient.newsroomItem.upsert({
        where: { sourceUrl: item.sourceUrl },
        update: { status, articleId: articleId || null },
        create: {
          sourceUrl:     item.sourceUrl,
          sourceName:    item.sourceName,
          sourceTitle:   item.title || null,
          contentHash:   item.contentHash || null,
          status:        status || 'DISCOVERED',
          category:      item.category || null,
          reviewRequired: status === 'PENDING_REVIEW',
          articleId:     articleId || null,
          rawData:       {
            region:      item.region,
            publishedAt: item.publishedAt,
            imageUrl:    item.imageUrl,
          },
        },
      });
      return;
    } catch (e) {
      logger.warn(`Prisma save newsroom item failed, trying HTTP: ${e.message}`);
    }
  }

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
    logger.warn(`Could not save newsroom item for "${item.title}": ${err.message}`);
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
async function runNewsroom(options = {}) {
  const { force = false } = options;

  if (_isRunning) {
    logger.warn('Scan already in progress — skipping concurrent execution request.');
    return { skipped: true, reason: 'already_running' };
  }

  if (_isPaused && !force) {
    logger.info('Scan skipped: AI Newsroom search engine is paused by admin.');
    return { skipped: true, reason: 'engine_paused' };
  }

  _isRunning = true;
  _shouldAbortScan = false;
  _lastRunTime = new Date().toISOString();

  const startTime = Date.now();
  logger.info('════════════════════════════════════════');
  logger.info(`Scan started at ${_lastRunTime} (Force: ${force})`);
  logger.info(`Mode: ${config.mode} | Dry-run: ${config.dryRun} | Model: ${config.geminiModel}`);
  logger.info('════════════════════════════════════════');

  try {
    // --- Check AI is configured ---
    let aiClient;
    try {
      aiClient = createAiClient(config);
    } catch (err) {
      logger.error(`AI client init failed: ${err.message}`);
      logger.error('Please set GEMINI_API_KEY in your environment variables.');
      return { error: err.message };
    }

    const token = config.apiToken || null;

    // --- Stage 1: Discover ---
    const { items: rawItems, stats: discoverStats } = await discoverStories(SOURCES);
    logger.info(`${rawItems.length} stories discovered from ${discoverStats.sourcesAttempted} sources (${discoverStats.sourcesFailed} unreachable)`);

    if (rawItems.length === 0) {
      logger.warn('No stories found from configured RSS sources. Exiting scan.');
      return { discovered: 0, processed: 0, published: 0, failed: 0 };
    }

    if (_shouldAbortScan) {
      logger.info('Scan aborted by admin after discovery stage.');
      return { discovered: rawItems.length, aborted: true };
    }

    // --- Stage 2: Deduplicate ---
    const [knownHashes, recentArticles] = await Promise.all([
      getKnownHashes(config.apiUrl, token),
      getRecentArticles(config.apiUrl, token),
    ]);

    const { unique: candidates, duplicatesSkipped: cheapDupes } = await deduplicateItems(
      rawItems,
      knownHashes,
      recentArticles,
      async () => false  // AI semantic dedup handled inside processStory
    );
    logger.info(`${cheapDupes} duplicates skipped (hash/keyword); ${candidates.length} candidate stories available`);

    if (candidates.length === 0) {
      logger.info('All discovered stories are already in the system. Scan complete.');
      return { discovered: rawItems.length, duplicatesSkipped: cheapDupes, processed: 0, published: 0 };
    }

    // Prioritize candidates: Jigawa first, then Nigeria, then World
    const regionWeights = { jigawa: 1, nigeria: 2, world: 3 };
    candidates.sort((a, b) => (regionWeights[a.region] || 2) - (regionWeights[b.region] || 2));

    // Limit candidates per run to avoid hitting Gemini free-tier rate limits
    const maxStories = config.maxItemsPerRun || 8;
    const prioritizedCandidates = candidates.slice(0, maxStories);
    logger.info(`Selected top ${prioritizedCandidates.length} stories for this scan (Jigawa prioritized) from ${candidates.length} candidates`);

    // --- Stages 3–8: Process candidates with controlled concurrency ---
    const stats = { processed: 0, published: 0, pendingReview: 0, skipped: 0, failed: 0, dryRun: 0 };

    await runWithConcurrency(prioritizedCandidates, config.concurrency, async (item) => {
      if (_shouldAbortScan) {
        logger.info(`Scan aborted by admin: skipping "${item.title.slice(0, 40)}"`);
        stats.skipped++;
        return { status: 'SKIPPED', reason: 'scan_aborted' };
      }

      stats.processed++;
      logger.info(`Analyzing (${stats.processed}/${prioritizedCandidates.length}): "${item.title.slice(0, 60)}..." [${item.sourceName}]`);

      const result = await processStory(item, aiClient, config, recentArticles, prismaClient);

      switch (result.status) {
        case 'PUBLISHED':
          stats.published++;
          logger.info(`[PUBLISHED] Story created & published: ${item.title}`);
          break;
        case 'SUBMITTED':
        case 'DRAFT':
        case 'PENDING_REVIEW':
          stats.pendingReview++;
          logger.info(`[PENDING REVIEW] Story prepared for editor review: ${item.title}`);
          break;
        case 'SKIPPED':
        case 'DUPLICATE':
          stats.skipped++;
          break;
        case 'DRY_RUN':
          stats.dryRun++;
          logger.info(`[DRY RUN] Article prepared (not published): ${item.title}`);
          break;
        case 'FAILED':
        default:
          stats.failed++;
          logger.warn(`[FAILED] Processing failed for: ${item.title} (${result.reason || 'unknown'})`);
          break;
      }

      // Persist to newsroom_items
      if (!config.dryRun) {
        await saveNewsroomItem(config.apiUrl, token, item, result.status, result.articleId);
      }

      return result;
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.info('════════════════════════════════════════');
    logger.info(`Scan complete in ${elapsed}s`);
    logger.info(`Discovered: ${rawItems.length} | Duplicates skipped: ${cheapDupes}`);
    logger.info(`Analyzed: ${candidates.length} | Published: ${stats.published} | Review Required: ${stats.pendingReview} | Dry Run: ${stats.dryRun} | Failed: ${stats.failed}`);
    logger.info('════════════════════════════════════════');

    return { discovered: rawItems.length, duplicatesSkipped: cheapDupes, ...stats };
  } finally {
    _isRunning = false;
    _shouldAbortScan = false;
  }
}

// ---------------------------------------------------------------------------
// Scheduler & Operational Windows (WAT / Africa/Lagos Timezone, UTC+1)
// Scheduled windows: 08:00-09:00, 13:00-14:00, 19:00-20:00, 00:00-01:00
// ---------------------------------------------------------------------------

let _schedulerTimer  = null;
let _isRunning       = false;
let _isPaused        = false;
let _shouldAbortScan = false;
let _lastRunTime     = null;
let _lastWindowRun   = null;

function getWatDate() {
  const now = new Date();
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: config.timezone || 'Africa/Lagos',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const get = (t) => parts.find((p) => p.type === t)?.value || '00';
    const hour = parseInt(get('hour'), 10);
    const minute = parseInt(get('minute'), 10);
    const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} WAT`;
    return { hour, minute, timeStr, dateKey: `${get('year')}-${get('month')}-${get('day')}` };
  } catch {
    // Fallback: UTC+1
    const utcHour = (now.getUTCHours() + 1) % 24;
    const utcMin  = now.getUTCMinutes();
    return {
      hour: utcHour,
      minute: utcMin,
      timeStr: `${String(utcHour).padStart(2, '0')}:${String(utcMin).padStart(2, '0')} WAT`,
      dateKey: now.toISOString().slice(0, 10),
    };
  }
}

function isWithinOperationalWindow() {
  const { hour } = getWatDate();
  const hours = config.operationalHours || [0, 8, 13, 19];
  return hours.includes(hour);
}

function getWindowInfo() {
  const { hour, timeStr } = getWatDate();
  const hours = config.operationalHours || [0, 8, 13, 19];
  const inWindow = hours.includes(hour);
  const currentWindow = inWindow ? `${String(hour).padStart(2, '0')}:00 - ${String((hour + 1) % 24).padStart(2, '0')}:00 WAT` : null;

  let nextHour = hours.find((h) => h > hour);
  if (nextHour === undefined) nextHour = hours[0];
  const nextWindow = `${String(nextHour).padStart(2, '0')}:00 - ${String((nextHour + 1) % 24).padStart(2, '0')}:00 WAT`;

  return {
    inWindow,
    currentWindow,
    nextWindow,
    currentTimeWat: timeStr,
    windows: ['08:00 - 09:00 WAT', '13:00 - 14:00 WAT', '19:00 - 20:00 WAT', '00:00 - 01:00 WAT'],
  };
}

async function initPauseState() {
  if (prismaClient) {
    try {
      const setting = await prismaClient.siteSetting.findUnique({
        where: { key: 'newsroom_engine_paused' },
      });
      if (setting) {
        _isPaused = setting.value === 'true';
        logger.info(`Engine pause state initialized from database: ${_isPaused ? 'PAUSED' : 'ACTIVE'}`);
      }
    } catch (e) {
      logger.warn(`Could not load engine pause state from DB: ${e.message}`);
    }
  }
}

async function pauseEngine(persist = true) {
  _isPaused = true;
  logger.info('AI Newsroom search engine PAUSED indefinitely by admin.');
  if (persist && prismaClient) {
    try {
      await prismaClient.siteSetting.upsert({
        where: { key: 'newsroom_engine_paused' },
        update: { value: 'true' },
        create: { key: 'newsroom_engine_paused', value: 'true' },
      });
    } catch (e) {
      logger.warn(`Could not persist pause state: ${e.message}`);
    }
  }
  return getEngineStatus();
}

async function resumeEngine(persist = true) {
  _isPaused = false;
  logger.info('AI Newsroom search engine RESUMED by admin.');
  if (persist && prismaClient) {
    try {
      await prismaClient.siteSetting.upsert({
        where: { key: 'newsroom_engine_paused' },
        update: { value: 'false' },
        create: { key: 'newsroom_engine_paused', value: 'false' },
      });
    } catch (e) {
      logger.warn(`Could not persist resume state: ${e.message}`);
    }
  }
  return getEngineStatus();
}

function stopRunningScan() {
  if (_isRunning) {
    _shouldAbortScan = true;
    logger.info('Abort requested for current newsroom scan.');
    return { ok: true, message: 'Scan cancellation requested.' };
  }
  return { ok: false, message: 'No scan is currently running.' };
}

function getEngineStatus() {
  const win = getWindowInfo();
  return {
    isPaused: _isPaused,
    isRunning: _isRunning,
    inWindow: win.inWindow,
    currentWindow: win.currentWindow,
    nextWindow: win.nextWindow,
    currentTimeWat: win.currentTimeWat,
    windows: win.windows,
    lastRunTime: _lastRunTime,
  };
}

/**
 * Start the periodic newsroom scheduler.
 * Checks every 2 minutes whether the current WAT time falls into an active
 * operational window (08:00-09:00, 13:00-14:00, 19:00-20:00, 00:00-01:00).
 */
async function startScheduler() {
  await initPauseState();
  const win = getWindowInfo();
  logger.info(`Scheduler started — Active windows: ${win.windows.join(', ')}`);
  logger.info(`Current WAT Time: ${win.currentTimeWat} | Status: ${_isPaused ? 'PAUSED' : win.inWindow ? 'OPERATIONAL WINDOW ACTIVE' : `STANDBY (Next: ${win.nextWindow})`}`);

  // Periodic window check every 2 minutes
  _schedulerTimer = setInterval(async () => {
    if (_isPaused || _isRunning) return;

    const current = getWindowInfo();
    if (!current.inWindow) return; // Outside active windows

    const { hour, dateKey } = getWatDate();
    const windowKey = `${dateKey}:${hour}`;
    if (_lastWindowRun === windowKey) return; // Already scanned in this window

    _lastWindowRun = windowKey;
    logger.info(`[WINDOW ACTIVE] Operating window ${current.currentWindow} active. Starting scheduled newsroom scan...`);
    try {
      await runNewsroom();
    } catch (err) {
      logger.error('[SCHEDULER] Scan error:', err.message);
    }
  }, 120000); // 2 minutes
}

/**
 * Stop the scheduler (for graceful shutdown).
 */
function stopScheduler() {
  if (_schedulerTimer) {
    clearInterval(_schedulerTimer);
    _schedulerTimer = null;
    logger.info('Scheduler stopped.');
  }
}

module.exports = {
  runNewsroom,
  startScheduler,
  stopScheduler,
  pauseEngine,
  resumeEngine,
  stopRunningScan,
  getEngineStatus,
  isWithinOperationalWindow,
};

// ---------------------------------------------------------------------------
// CLI entry point: node newsroom/index.js
// ---------------------------------------------------------------------------
if (require.main === module) {
  try {
    const path = require('path');
    require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
  } catch {}

  runNewsroom()
    .then((summary) => {
      if (summary.error) process.exit(1);
      process.exit(0);
    })
    .catch((err) => {
      logger.error('Fatal newsroom error:', err.message);
      process.exit(1);
    });
}
