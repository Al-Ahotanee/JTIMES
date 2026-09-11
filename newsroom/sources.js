// newsroom/sources.js
// Configurable news source definitions for the AI Newsroom and Hybrid News Aggregator.
//
// 4 Regional Tiers:
//   1. jigawa  — Hyper-local & state affairs (Google News Jigawa, Dutse/Buji, Daily Trust Northern News)
//   2. nigeria — National coverage (Channels TV, Vanguard, Punch, Premium Times, Tribune)
//   3. africa  — Continental coverage (BBC Africa, AllAfrica, AfricaNews)
//   4. world   — Global coverage (BBC World, Al Jazeera English, The Guardian World)
//
// Only publicly accessible RSS feeds — no paywalls, no auth bypass.

'use strict';

const SOURCES = [
  // -----------------------------------------------------------------------
  // 1. JIGAWA (Local & State) — highest priority
  // -----------------------------------------------------------------------
  {
    name: 'Google News – Jigawa',
    url: 'https://news.google.com/rss/search?q=Jigawa&hl=en-NG&gl=NG&ceid=NG:en',
    type: 'rss',
    region: 'jigawa',
    priority: 'high',
    category: 'jigawa',
    description: 'Live real-time Jigawa State news aggregated by Google News',
  },
  {
    name: 'Google News – Dutse & Buji',
    url: 'https://news.google.com/rss/search?q=Dutse+OR+Buji+Jigawa&hl=en-NG&gl=NG&ceid=NG:en',
    type: 'rss',
    region: 'jigawa',
    priority: 'high',
    category: 'buji',
    description: 'Hyper-local news focusing on Dutse capital and Buji LGA',
  },
  {
    name: 'Daily Trust – Northern News',
    url: 'https://dailytrust.com/feed/',
    type: 'rss',
    region: 'jigawa',
    priority: 'high',
    category: 'jigawa',
    description: 'Daily Trust — leading Northern Nigeria daily newspaper',
  },
  {
    name: 'Jigawa State Government',
    url: 'https://jigawastate.gov.ng/feed/',
    type: 'rss',
    region: 'jigawa',
    priority: 'medium',
    category: 'jigawa',
    description: 'Official Jigawa State Government press releases and notices',
  },

  // -----------------------------------------------------------------------
  // 2. NIGERIA (National) — medium priority
  // -----------------------------------------------------------------------
  {
    name: 'Channels Television',
    url: 'https://www.channelstv.com/feed/',
    type: 'rss',
    region: 'nigeria',
    priority: 'high',
    category: 'politics',
    description: 'Channels TV — leading Nigerian broadcast television news',
  },
  {
    name: 'Vanguard News',
    url: 'https://www.vanguardngr.com/feed/',
    type: 'rss',
    region: 'nigeria',
    priority: 'high',
    category: 'politics',
    description: 'Vanguard — authoritative Nigerian national daily',
  },
  {
    name: 'Punch Newspapers',
    url: 'https://rss.punchng.com/v1/category/latest_news',
    type: 'rss',
    region: 'nigeria',
    priority: 'high',
    category: 'politics',
    description: 'Punch — premier Nigerian national newspaper',
  },
  {
    name: 'Premium Times',
    url: 'https://www.premiumtimesng.com/feed',
    type: 'rss',
    region: 'nigeria',
    priority: 'medium',
    category: 'investigations',
    description: 'Premium Times — investigative and public accountability journalism',
  },
  {
    name: 'Tribune Online',
    url: 'https://tribuneonlineng.com/feed/',
    type: 'rss',
    region: 'nigeria',
    priority: 'medium',
    category: 'politics',
    description: 'African Newspapers of Nigeria — Tribune Online',
  },

  // -----------------------------------------------------------------------
  // 3. AFRICA (Continental) — medium priority
  // -----------------------------------------------------------------------
  {
    name: 'BBC News Africa',
    url: 'https://feeds.bbci.co.uk/news/world/africa/rss.xml',
    type: 'rss',
    region: 'africa',
    priority: 'high',
    category: 'politics',
    description: 'BBC News African continental coverage and investigations',
  },
  {
    name: 'AllAfrica',
    url: 'https://allafrica.com/tools/headlines/rdf/latest/headlines.rdf',
    type: 'rss',
    region: 'africa',
    priority: 'high',
    category: 'business',
    description: 'AllAfrica — comprehensive African news aggregator',
  },
  {
    name: 'AfricaNews',
    url: 'https://www.africanews.com/feed/rss',
    type: 'rss',
    region: 'africa',
    priority: 'medium',
    category: 'politics',
    description: 'Pan-African multilingual news channel',
  },

  // -----------------------------------------------------------------------
  // 4. WORLD (Global) — international context
  // -----------------------------------------------------------------------
  {
    name: 'BBC News World',
    url: 'https://feeds.bbci.co.uk/news/world/rss.xml',
    type: 'rss',
    region: 'world',
    priority: 'high',
    category: 'politics',
    description: 'BBC World News service',
  },
  {
    name: 'Al Jazeera English',
    url: 'https://www.aljazeera.com/xml/rss/all.xml',
    type: 'rss',
    region: 'world',
    priority: 'high',
    category: 'politics',
    description: 'Al Jazeera global reporting and Middle East / Global South news',
  },
  {
    name: 'The Guardian World',
    url: 'https://www.theguardian.com/world/rss',
    type: 'rss',
    region: 'world',
    priority: 'medium',
    category: 'politics',
    description: 'The Guardian international world news and analysis',
  },
];

// Sorting: jigawa first, then nigeria, then africa, then world; within region by priority weight
const PRIORITY_WEIGHT = { high: 0, medium: 1, low: 2 };
const REGION_WEIGHT   = { jigawa: 0, nigeria: 1, africa: 2, world: 3 };

SOURCES.sort((a, b) => {
  const regionDiff = (REGION_WEIGHT[a.region] ?? 9) - (REGION_WEIGHT[b.region] ?? 9);
  if (regionDiff !== 0) return regionDiff;
  return (PRIORITY_WEIGHT[a.priority] ?? 9) - (PRIORITY_WEIGHT[b.priority] ?? 9);
});

module.exports = SOURCES;
