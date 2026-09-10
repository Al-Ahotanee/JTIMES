// newsroom/generate-token.js
// One-time utility to generate a long-lived JWT for the AI Newsroom.
//
// The newsroom pipeline authenticates against the existing Jigawa Times API
// using a Bearer token in the Authorization header. The normal login endpoint
// sets an httpOnly cookie only — this script generates the token directly
// using the same AUTH_SECRET and signs it for the newsroom author account.
//
// Usage:
//   node newsroom/generate-token.js
//
// Copy the printed token and set it as NEWSROOM_API_TOKEN in your .env
// and in the Render environment variables dashboard.
//
// The token is valid for 1 year. Re-run this script if it expires.

'use strict';

const path = require('path');

// Load .env from project root
try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch {
  // dotenv not installed — env vars must already be set in the shell
}

const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');

const AUTH_SECRET     = process.env.AUTH_SECRET;
const AUTHOR_EMAIL    = process.env.NEWSROOM_AUTHOR_EMAIL || 'admin@jigawatimes.ng';

async function main() {
  if (!AUTH_SECRET) {
    console.error('\n❌  AUTH_SECRET is not set. Make sure your .env file is present.\n');
    process.exit(1);
  }

  const prisma = new PrismaClient();

  try {
    const user = await prisma.user.findUnique({
      where: { email: AUTHOR_EMAIL.toLowerCase().trim() },
    });

    if (!user) {
      console.error(`\n❌  No user found with email: ${AUTHOR_EMAIL}`);
      console.error('    Set NEWSROOM_AUTHOR_EMAIL in .env to match an existing admin account.\n');
      process.exit(1);
    }

    if (!user.active) {
      console.error(`\n❌  User "${user.name}" (${AUTHOR_EMAIL}) is disabled. Enable the account first.\n`);
      process.exit(1);
    }

    if (user.role !== 'ADMIN' && user.role !== 'EDITOR') {
      console.error(`\n❌  User "${user.name}" has role ${user.role}. The newsroom author must be ADMIN or EDITOR.\n`);
      process.exit(1);
    }

    // Sign a 1-year token using the exact same logic as server.js signToken()
    const token = jwt.sign(
      { sub: user.id, role: user.role },
      AUTH_SECRET,
      { expiresIn: '365d' }
    );

    console.log('\n✅  Newsroom API token generated successfully!\n');
    console.log(`    Account : ${user.name} (${user.email})`);
    console.log(`    Role    : ${user.role}`);
    console.log(`    Expires : 1 year from now\n`);
    console.log('─'.repeat(72));
    console.log('\nNEWSROOM_API_TOKEN=' + token);
    console.log('\n' + '─'.repeat(72));
    console.log('\nNext steps:');
    console.log('  1. Copy the NEWSROOM_API_TOKEN line above into your .env file');
    console.log('  2. Add it to your Render environment variables dashboard');
    console.log('  3. Also set: NEWSROOM_DRY_RUN=false  (when ready to publish)');
    console.log('  4. Run:  node newsroom/index.js\n');

  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('\n❌  Error:', err.message, '\n');
  process.exit(1);
});
