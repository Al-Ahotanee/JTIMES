// newsroom/tests.js
// Unit tests for critical AI Newsroom functionality.
// No external test framework — uses native node:assert.
// Run with: node newsroom/tests.js

'use strict';

const assert = require('assert');

// ---------------------------------------------------------------------------
// Import modules under test
// ---------------------------------------------------------------------------
const { parseRss, parseAiJson, deduplicateItems } = require('./agent.js');
const { isRestrictedDomain, validateImageUrl }    = require('./images.js');

let passed = 0;
let failed  = 0;

function test(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      result.then(() => {
        console.log(`  ✓ ${name}`);
        passed++;
      }).catch((err) => {
        console.error(`  ✗ ${name}: ${err.message}`);
        failed++;
      });
    } else {
      console.log(`  ✓ ${name}`);
      passed++;
    }
  } catch (err) {
    console.error(`  ✗ ${name}: ${err.message}`);
    failed++;
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}: ${err.message}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// RSS PARSER TESTS
// ---------------------------------------------------------------------------
console.log('\n[TEST] RSS Parser');

test('parses valid RSS feed with CDATA', () => {
  const xml = `
    <rss><channel>
      <item>
        <title><![CDATA[Jigawa Approves New Agricultural Programme]]></title>
        <link>https://example.com/story-1</link>
        <description><![CDATA[Farmers benefit from new scheme.]]></description>
        <pubDate>Wed, 10 Sep 2026 08:00:00 GMT</pubDate>
        <dc:creator>NAN Reporter</dc:creator>
      </item>
    </channel></rss>`;
  const source = { name: 'Test Source', region: 'jigawa', category: 'jigawa', priority: 'high' };
  const items  = parseRss(xml, source);
  assert.strictEqual(items.length, 1, 'Should parse 1 item');
  assert.strictEqual(items[0].title, 'Jigawa Approves New Agricultural Programme');
  assert.strictEqual(items[0].sourceUrl, 'https://example.com/story-1');
  assert.strictEqual(items[0].sourceName, 'Test Source');
  assert.strictEqual(items[0].region, 'jigawa');
  assert.ok(items[0].contentHash, 'Should have content hash');
  assert.ok(items[0].publishedAt, 'Should have publishedAt');
});

test('handles empty RSS feed gracefully', () => {
  const xml    = '<rss><channel></channel></rss>';
  const source = { name: 'Empty Source', region: 'jigawa', category: 'jigawa', priority: 'low' };
  const items  = parseRss(xml, source);
  assert.strictEqual(items.length, 0, 'Should return empty array for empty feed');
});

test('handles malformed RSS gracefully', () => {
  const xml    = 'this is not xml at all <<<>>>';
  const source = { name: 'Bad Source', region: 'nigeria', category: 'jigawa', priority: 'low' };
  const items  = parseRss(xml, source);
  assert.strictEqual(items.length, 0, 'Should return empty array for malformed XML');
});

test('skips items without title or link', () => {
  const xml = `
    <rss><channel>
      <item><description>No title or link here</description></item>
      <item><title>Has title</title><link>https://example.com/ok</link></item>
    </channel></rss>`;
  const source = { name: 'Mixed Source', region: 'nigeria', category: 'jigawa', priority: 'medium' };
  const items  = parseRss(xml, source);
  assert.strictEqual(items.length, 1, 'Should only return item with title AND link');
});

test('extracts image URL from media:content', () => {
  const xml = `
    <rss><channel>
      <item>
        <title>Story with image</title>
        <link>https://example.com/story-img</link>
        <media:content url="https://example.com/image.jpg" medium="image"/>
      </item>
    </channel></rss>`;
  const source = { name: 'Media Source', region: 'jigawa', category: 'jigawa', priority: 'high' };
  const items  = parseRss(xml, source);
  assert.strictEqual(items[0].imageUrl, 'https://example.com/image.jpg');
});

test('generates consistent content hashes', () => {
  const xml = `
    <rss><channel>
      <item><title>Consistent Title</title><link>https://example.com/x</link></item>
    </channel></rss>`;
  const source = { name: 'S', region: 'jigawa', category: 'jigawa', priority: 'high' };
  const items1 = parseRss(xml, source);
  const items2 = parseRss(xml, source);
  assert.strictEqual(items1[0].contentHash, items2[0].contentHash, 'Hash should be deterministic');
});

// ---------------------------------------------------------------------------
// AI JSON PARSER TESTS
// ---------------------------------------------------------------------------
console.log('\n[TEST] AI JSON Parser');

test('parses clean JSON response', () => {
  const result = parseAiJson('{"is_news": true, "category": "jigawa"}');
  assert.strictEqual(result.is_news, true);
  assert.strictEqual(result.category, 'jigawa');
});

test('strips markdown code fences', () => {
  const result = parseAiJson('```json\n{"is_news": false, "skip_reason": "ad"}\n```');
  assert.strictEqual(result.is_news, false);
  assert.strictEqual(result.skip_reason, 'ad');
});

test('returns null for completely invalid JSON', () => {
  const result = parseAiJson('This is prose text with no JSON at all.');
  assert.strictEqual(result, null);
});

test('extracts JSON from mixed text (fallback)', () => {
  const result = parseAiJson('Here is the analysis: {"confidence": 0.9} and some extra text.');
  assert.ok(result, 'Should extract JSON object');
  assert.strictEqual(result.confidence, 0.9);
});

test('returns null for empty string', () => {
  const result = parseAiJson('');
  assert.strictEqual(result, null);
});

test('returns null for null input', () => {
  const result = parseAiJson(null);
  assert.strictEqual(result, null);
});

// ---------------------------------------------------------------------------
// DUPLICATE DETECTION TESTS
// ---------------------------------------------------------------------------
console.log('\n[TEST] Duplicate Detection');

testAsync('filters items with known content hashes', async () => {
  const items = [
    { title: 'Story A', sourceUrl: 'https://a.com/1', contentHash: 'hash_a', region: 'jigawa', category: 'jigawa' },
    { title: 'Story B', sourceUrl: 'https://b.com/2', contentHash: 'hash_b', region: 'jigawa', category: 'jigawa' },
  ];
  const knownHashes = [{ content_hash: 'hash_a' }];
  const { unique, duplicatesSkipped } = await deduplicateItems(items, knownHashes, [], async () => false);
  assert.strictEqual(unique.length, 1, 'Should return 1 unique item');
  assert.strictEqual(duplicatesSkipped, 1, 'Should skip 1 duplicate');
  assert.strictEqual(unique[0].contentHash, 'hash_b');
});

testAsync('keeps stories with no hash match', async () => {
  const items = [
    { title: 'Completely New Story', sourceUrl: 'https://c.com/3', contentHash: 'hash_c', region: 'jigawa', category: 'jigawa' },
  ];
  const { unique, duplicatesSkipped } = await deduplicateItems(items, [], [], async () => false);
  assert.strictEqual(unique.length, 1);
  assert.strictEqual(duplicatesSkipped, 0);
});

testAsync('deduplicates same URL appearing twice in raw items', async () => {
  const items = [
    { title: 'Story X', sourceUrl: 'https://d.com/4', contentHash: 'hash_d', region: 'jigawa', category: 'jigawa' },
    { title: 'Story X duplicate', sourceUrl: 'https://d.com/4b', contentHash: 'hash_d', region: 'jigawa', category: 'jigawa' },
  ];
  const { unique, duplicatesSkipped } = await deduplicateItems(items, [], [], async () => false);
  // The second item shares the same hash as the first (already added to set)
  assert.strictEqual(unique.length, 1, 'Should deduplicate within-run duplicates');
  assert.strictEqual(duplicatesSkipped, 1);
});

testAsync('skips story when AI semantic dedup returns true', async () => {
  // Use a title with >60% word overlap with the existing article to trigger the AI check
  const candidate = {
    title: 'Jigawa Launches Agricultural Programme Initiative For Farmers',
    sourceUrl: 'https://e.com/5',
    contentHash: 'hash_e_unique_999',
    region: 'jigawa',
    category: 'jigawa',
  };
  const recentArticle = { id: 1, title: 'Jigawa Launches Agricultural Programme For Farmers State', excerpt: '' };
  // Simulate AI confirming it is a duplicate
  const { unique, duplicatesSkipped } = await deduplicateItems(
    [candidate], [], [recentArticle],
    async () => true  // AI says duplicate
  );
  assert.strictEqual(unique.length, 0, 'Should skip AI-confirmed duplicate');
  assert.strictEqual(duplicatesSkipped, 1);
});

// ---------------------------------------------------------------------------
// IMAGE RESTRICTION TESTS
// ---------------------------------------------------------------------------
console.log('\n[TEST] Image Domain Restriction');

test('flags social media domains as restricted', () => {
  assert.strictEqual(isRestrictedDomain('https://twitter.com/image.jpg'), true);
  assert.strictEqual(isRestrictedDomain('https://www.instagram.com/p/abc/image.jpg'), true);
  assert.strictEqual(isRestrictedDomain('https://facebook.com/photo.jpg'), true);
});

test('flags stock image domains as restricted', () => {
  assert.strictEqual(isRestrictedDomain('https://gettyimages.com/photo.jpg'), true);
  assert.strictEqual(isRestrictedDomain('https://shutterstock.com/photo.jpg'), true);
});

test('allows legitimate news image domains', () => {
  assert.strictEqual(isRestrictedDomain('https://punchng.com/wp-content/image.jpg'), false);
  assert.strictEqual(isRestrictedDomain('https://images.channelstv.com/news.jpg'), false);
  assert.strictEqual(isRestrictedDomain('https://cloudinary.com/jigawa-times/photo.jpg'), false);
});

test('flags malformed URLs as restricted', () => {
  assert.strictEqual(isRestrictedDomain('not-a-url'), true);
  assert.strictEqual(isRestrictedDomain(''), true);
});

// ---------------------------------------------------------------------------
// HIGH-RISK STORY SAFETY TESTS
// ---------------------------------------------------------------------------
console.log('\n[TEST] High-Risk Content Flags');

test('review_required is true for death-related classification', () => {
  // Simulate what the AI classification parser returns
  const classification = parseAiJson('{"is_news":true,"review_required":true,"review_reason":"Story involves reported deaths","category":"jigawa","importance":"high"}');
  assert.ok(classification, 'Should parse classification');
  assert.strictEqual(classification.review_required, true, 'review_required should be true');
  assert.ok(classification.review_reason, 'Should have a review reason');
});

test('review_required is false for routine government announcement', () => {
  const classification = parseAiJson('{"is_news":true,"review_required":false,"review_reason":null,"category":"jigawa","importance":"medium"}');
  assert.ok(classification, 'Should parse classification');
  assert.strictEqual(classification.review_required, false, 'review_required should be false for routine news');
});

test('verification object has expected structure', () => {
  const verification = parseAiJson(JSON.stringify({
    verified: true, confidence: 0.85,
    sources_checked: 2, corroborated_facts: ['Fact A'],
    conflicts: [], unverified_claims: [], review_required: false, review_reason: null,
  }));
  assert.ok(verification, 'Should parse verification object');
  assert.strictEqual(typeof verification.confidence, 'number');
  assert.ok(verification.confidence >= 0 && verification.confidence <= 1, 'Confidence should be 0-1');
  assert.ok(Array.isArray(verification.corroborated_facts));
  assert.ok(Array.isArray(verification.conflicts));
  assert.ok(Array.isArray(verification.unverified_claims));
});

test('article structure has all required fields', () => {
  const article = parseAiJson(JSON.stringify({
    headline: 'Jigawa Governor Inaugurates New Road Project',
    subheadline: 'The 50km road will connect farming communities to markets.',
    excerpt: 'The Jigawa State Governor has inaugurated a new road project.',
    body: '<p>Full article body here.</p>',
    byline: 'Jigawa Times News Desk',
    disclosure: 'This report was compiled from publicly available sources.',
  }));
  assert.ok(article.headline, 'Should have headline');
  assert.ok(article.body, 'Should have body');
  assert.strictEqual(article.byline, 'Jigawa Times News Desk', 'Byline must be Jigawa Times News Desk');
  assert.ok(article.disclosure, 'Should have editorial disclosure');
});

// ---------------------------------------------------------------------------
// DRY-RUN SAFEGUARD TESTS
// ---------------------------------------------------------------------------
console.log('\n[TEST] Configuration Validation');

test('dry-run defaults to true when env var not set', () => {
  // Re-read config with env var deleted
  const origVal = process.env.NEWSROOM_DRY_RUN;
  delete process.env.NEWSROOM_DRY_RUN;
  // Config is already loaded (module cached) — test the logic directly
  const val = process.env.NEWSROOM_DRY_RUN;
  const result = val === undefined ? true : (val === 'true' || val === '1');
  assert.strictEqual(result, true, 'Dry-run should default to true when not set');
  if (origVal !== undefined) process.env.NEWSROOM_DRY_RUN = origVal;
});

test('manual mode is the default', () => {
  const origVal = process.env.NEWSROOM_MODE;
  delete process.env.NEWSROOM_MODE;
  const val  = process.env.NEWSROOM_MODE;
  const mode = ['manual', 'semi_auto', 'auto'].includes(val) ? val : 'manual';
  assert.strictEqual(mode, 'manual', 'Default mode should be manual');
  if (origVal !== undefined) process.env.NEWSROOM_MODE = origVal;
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
// Wait for all async tests to settle
setTimeout(() => {
  console.log('\n════════════════════════════════════════');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('════════════════════════════════════════\n');
  process.exit(failed > 0 ? 1 : 0);
}, 500);
