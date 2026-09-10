// newsroom/check-models.js
// Diagnostic script to test your GEMINI_API_KEY and list models
// supported for generateContent on both v1beta and v1 endpoints.
//
// Usage:
//   node newsroom/check-models.js [YOUR_API_KEY]

'use strict';

const https = require('https');
const path = require('path');

try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch {}

const apiKey = process.argv[2] || process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.error('\n❌ Please provide your GEMINI_API_KEY either in .env or as an argument:\n');
  console.error('   node newsroom/check-models.js YOUR_GEMINI_API_KEY\n');
  process.exit(1);
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString();
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch {
          resolve({ status: res.statusCode, raw: body });
        }
      });
    }).on('error', reject);
  });
}

async function checkApi(version) {
  console.log(`\n🔍 Checking Gemini API (${version})...`);
  const url = `https://generativelanguage.googleapis.com/${version}/models?key=${apiKey}`;
  const res = await fetchJson(url);

  if (res.status !== 200) {
    console.log(`   ❌ Failed (${res.status}):`, res.data?.error?.message || res.raw);
    return [];
  }

  const models = (res.data?.models || []).filter(
    (m) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent')
  );

  console.log(`   ✅ Found ${models.length} models supporting generateContent:`);
  models.forEach((m) => {
    const name = m.name.replace('models/', '');
    console.log(`      • ${name} (${m.displayName || ''})`);
  });

  return models.map((m) => m.name.replace('models/', ''));
}

async function main() {
  console.log('Testing Gemini API key...');
  const v1betaModels = await checkApi('v1beta');
  const v1Models = await checkApi('v1');

  console.log('\n💡 Recommended configuration in .env / Render:');
  const candidates = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash-latest', 'gemini-1.5-flash', 'gemini-flash-latest'];
  const matched = candidates.find((c) => v1betaModels.includes(c) || v1Models.includes(c)) || v1betaModels[0] || v1Models[0];

  if (matched) {
    console.log(`   GEMINI_MODEL=${matched}`);
  } else {
    console.log('   GEMINI_MODEL=gemini-2.0-flash (or check the models listed above)');
  }
}

main().catch(console.error);
