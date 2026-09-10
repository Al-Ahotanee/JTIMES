// newsroom/sources.js
// Configurable news source definitions for the AI Newsroom.
//
// Priority order: jigawa → nigeria → world
// Type: currently only 'rss' is implemented.
// Only publicly accessible RSS feeds — no paywalls, no scraping, no auth bypass.
//
// To add or remove sources, edit this file only.
// Category slugs must match existing Jigawa Times categories:
//   buji | jigawa | politics | business | education | investigations

'use strict';

const SOURCES = [
  // -----------------------------------------------------------------------
  // JIGAWA — highest priority
  // -----------------------------------------------------------------------
  {
    name: 'Jigawa State Government',
    url: 'https://jigawastate.gov.ng/feed/',
    type: 'rss',
    region: 'jigawa',
    priority: 'high',
    category: 'jigawa',
    description: 'Official Jigawa State Government news and press releases',
  },
  {
    name: 'NAN – Jigawa',
    url: 'https://www.nan.ng/feed/',
    type: 'rss',
    region: 'jigawa',
    priority: 'high',
    category: 'jigawa',
    // NAN covers all of Nigeria; the AI classifier filters for Jigawa relevance
    description: 'News Agency of Nigeria — filtered for Jigawa coverage',
  },
  {
    name: 'Daily Trust – Jigawa',
    url: 'https://dailytrust.com/feed/',
    type: 'rss',
    region: 'jigawa',
    priority: 'high',
    category: 'jigawa',
    description: 'Daily Trust — leading Northern Nigeria newspaper',
  },

  // -----------------------------------------------------------------------
  // NIGERIA — medium priority
  // -----------------------------------------------------------------------
  {
    name: 'Channels Television',
    url: 'https://www.channelstv.com/feed/',
    type: 'rss',
    region: 'nigeria',
    priority: 'medium',
    category: 'jigawa',
    description: 'Channels TV — leading Nigerian television news',
  },
  {
    name: 'Premium Times',
    url: 'https://www.premiumtimesng.com/feed/',
    type: 'rss',
    region: 'nigeria',
    priority: 'medium',
    category: 'jigawa',
    description: 'Premium Times — investigative and public interest journalism',
  },
  {
    name: 'The Cable',
    url: 'https://www.thecable.ng/feed/',
    type: 'rss',
    region: 'nigeria',
    priority: 'medium',
    category: 'jigawa',
    description: 'The Cable — online newspaper for news and analysis',
  },
  {
    name: 'Punch Newspapers',
    url: 'https://punchng.com/feed/',
    type: 'rss',
    region: 'nigeria',
    priority: 'medium',
    category: 'jigawa',
    description: 'Punch — one of Nigeria\'s widest-read newspapers',
  },
  {
    name: 'Vanguard',
    url: 'https://www.vanguardngr.com/feed/',
    type: 'rss',
    region: 'nigeria',
    priority: 'medium',
    category: 'jigawa',
    description: 'Vanguard — national daily newspaper',
  },
  {
    name: 'The Guardian Nigeria',
    url: 'https://guardian.ng/feed/',
    type: 'rss',
    region: 'nigeria',
    priority: 'medium',
    category: 'jigawa',
    description: 'The Guardian Nigeria',
  },
  {
    name: 'Tribune Online',
    url: 'https://tribuneonlineng.com/feed/',
    type: 'rss',
    region: 'nigeria',
    priority: 'medium',
    category: 'jigawa',
    description: 'African Newspapers of Nigeria — Tribune Online',
  },
  {
    name: 'Leadership Newspaper',
    url: 'https://leadership.ng/feed/',
    type: 'rss',
    region: 'nigeria',
    priority: 'medium',
    category: 'jigawa',
    description: 'Leadership — Abuja-based national daily',
  },
  {
    name: 'BusinessDay',
    url: 'https://businessday.ng/feed/',
    type: 'rss',
    region: 'nigeria',
    priority: 'medium',
    category: 'business',
    description: 'BusinessDay — Nigerian business and economy news',
  },

  // -----------------------------------------------------------------------
  // WORLD — lower priority (international context)
  // -----------------------------------------------------------------------
  {
    name: 'Reuters – Africa',
    url: 'https://feeds.reuters.com/reuters/AFRICANews',
    type: 'rss',
    region: 'world',
    priority: 'low',
    category: 'jigawa',
    description: 'Reuters Africa news feed',
  },
  {
    name: 'BBC Africa',
    url: 'https://feeds.bbci.co.uk/news/world/africa/rss.xml',
    type: 'rss',
    region: 'world',
    priority: 'low',
    category: 'jigawa',
    description: 'BBC News Africa',
  },
  {
    name: 'Al Jazeera – Africa',
    url: 'https://www.aljazeera.com/xml/rss/all.xml',
    type: 'rss',
    region: 'world',
    priority: 'low',
    category: 'jigawa',
    description: 'Al Jazeera English',
  },
];

// Sorting: jigawa first, then nigeria, then world; within region by priority weight
const PRIORITY_WEIGHT = { high: 0, medium: 1, low: 2 };
const REGION_WEIGHT   = { jigawa: 0, nigeria: 1, world: 2 };

SOURCES.sort((a, b) => {
  const regionDiff = (REGION_WEIGHT[a.region] || 9) - (REGION_WEIGHT[b.region] || 9);
  if (regionDiff !== 0) return regionDiff;
  return (PRIORITY_WEIGHT[a.priority] || 9) - (PRIORITY_WEIGHT[b.priority] || 9);
});

module.exports = SOURCES;
