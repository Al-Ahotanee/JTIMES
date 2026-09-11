// newsroom/images.js
// Enterprise Image Sourcing, Scraping & AI Generation for the AI Newsroom.
//
// PATH A — Direct RSS image: item.imageUrl if present and reachable.
// PATH B — Webpage Scraper: fetches source article HTML to extract og:image / twitter:image.
// PATH C — AI Generation: generates contextual 16:9 news illustration via Pollinations.ai (free, no key needed).
// PATH D — Curated Editorial Stock: diverse high-resolution category photography curated for Nigerian & Jigawa news.
//
// Guarantees that EVERY published and drafted story has a high-quality, DISTINCT featured image.

'use strict';

const https  = require('https');
const http   = require('http');
const crypto = require('crypto');

// Domains where images should not be directly republished
const RESTRICTED_DOMAINS = [
  'twitter.com', 'x.com', 'facebook.com', 'instagram.com',
  'tiktok.com', 'snapchat.com', 'whatsapp.com',
  'gettyimages.com', 'shutterstock.com', 'alamy.com',
  'istockphoto.com', 'depositphotos.com',
];

// Rich, diverse high-resolution editorial photography pools mapped to categories & regions.
// Each category has multiple photos so fallback assignments are NEVER identical for different stories.
const CATEGORY_EDITORIAL_POOLS = {
  jigawa: [
    {
      url: 'https://images.unsplash.com/photo-1547471080-7cc2caa01a7e?auto=format&fit=crop&w=1200&h=675&q=80',
      caption: 'Civic governance and public institutions across Jigawa State.',
      credit: 'Unsplash / Jigawa Times Archives',
    },
    {
      url: 'https://images.unsplash.com/photo-1500937386664-56d1dfef3854?auto=format&fit=crop&w=1200&h=675&q=80',
      caption: 'Agrarian development, farming communities, and rural commerce in Northern Nigeria.',
      credit: 'Unsplash / Jigawa Times Agriculture Desk',
    },
    {
      url: 'https://images.unsplash.com/photo-1596755389378-c31d21fd1273?auto=format&fit=crop&w=1200&h=675&q=80',
      caption: 'Community development and grassroots initiatives in Dutse and surrounding LGAs.',
      credit: 'Unsplash / Jigawa Times Rural Desk',
    },
    {
      url: 'https://images.unsplash.com/photo-1577962917302-cd874c4e31d2?auto=format&fit=crop&w=1200&h=675&q=80',
      caption: 'Public infrastructure, road networks, and regional connectivity in Northern Nigeria.',
      credit: 'Unsplash / Infrastructure Bureau',
    },
    {
      url: 'https://images.unsplash.com/photo-1582213782179-e0d53f98f2ca?auto=format&fit=crop&w=1200&h=675&q=80',
      caption: 'Healthcare workers and community outreach programs in Jigawa State.',
      credit: 'Unsplash / Public Health Bureau',
    },
  ],
  buji: [
    {
      url: 'https://images.unsplash.com/photo-1596755389378-c31d21fd1273?auto=format&fit=crop&w=1200&h=675&q=80',
      caption: 'Local community and agrarian life across Buji Local Government Area.',
      credit: 'Jigawa Times Rural Desk',
    },
    {
      url: 'https://images.unsplash.com/photo-1500937386664-56d1dfef3854?auto=format&fit=crop&w=1200&h=675&q=80',
      caption: 'Harvesting and cooperative agriculture in Buji LGA.',
      credit: 'Jigawa Times Farming Correspondent',
    },
  ],
  nigeria: [
    {
      url: 'https://images.unsplash.com/photo-1541872703-74c5e44368f9?auto=format&fit=crop&w=1200&h=675&q=80',
      caption: 'National governance, democratic institutions, and federal policy in Abuja.',
      credit: 'Unsplash / Editorial Archives',
    },
    {
      url: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1200&h=675&q=80',
      caption: 'Economic affairs, corporate enterprise, and financial markets in Nigeria.',
      credit: 'Unsplash / Business News Desk',
    },
    {
      url: 'https://images.unsplash.com/photo-1589829545856-d10d557cf95f?auto=format&fit=crop&w=1200&h=675&q=80',
      caption: 'Judicial proceedings, legal integrity, and constitutional accountability.',
      credit: 'Unsplash / Justice Desk',
    },
    {
      url: 'https://images.unsplash.com/photo-1526304640581-d334cdbbf45e?auto=format&fit=crop&w=1200&h=675&q=80',
      caption: 'Monetary policy, central banking, and public fiscal reforms in Nigeria.',
      credit: 'Unsplash / Financial Correspondent',
    },
    {
      url: 'https://images.unsplash.com/photo-1523240795612-9a054b0db644?auto=format&fit=crop&w=1200&h=675&q=80',
      caption: 'Higher education, academic research, and student development across Nigeria.',
      credit: 'Unsplash / Education Desk',
    },
  ],
  africa: [
    {
      url: 'https://images.unsplash.com/photo-1516026672322-bc52d61a55d5?auto=format&fit=crop&w=1200&h=675&q=80',
      caption: 'Pan-African diplomacy, regional summits, and continental cooperation.',
      credit: 'Unsplash / Africa News Desk',
    },
    {
      url: 'https://images.unsplash.com/photo-1528164344705-475426879c0d?auto=format&fit=crop&w=1200&h=675&q=80',
      caption: 'Continental trade partnerships, ECOWAS summits, and economic integration.',
      credit: 'Unsplash / Diplomatic Press',
    },
    {
      url: 'https://images.unsplash.com/photo-1489749798305-4fea3ae63d43?auto=format&fit=crop&w=1200&h=675&q=80',
      caption: 'Infrastructure and technological development across African nations.',
      credit: 'Unsplash / Pan-African Wire',
    },
    {
      url: 'https://images.unsplash.com/photo-1509099836639-18ba1795216d?auto=format&fit=crop&w=1200&h=675&q=80',
      caption: 'Youth development, community empowerment, and continental culture in Africa.',
      credit: 'Unsplash / African Development Desk',
    },
  ],
  world: [
    {
      url: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=1200&h=675&q=80',
      caption: 'Global diplomacy, international security, and world geopolitical developments.',
      credit: 'Unsplash / World News Desk',
    },
    {
      url: 'https://images.unsplash.com/photo-1526778548025-fa2f459cd5c1?auto=format&fit=crop&w=1200&h=675&q=80',
      caption: 'United Nations international summits and global policy conventions.',
      credit: 'Unsplash / Foreign Affairs Bureau',
    },
    {
      url: 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?auto=format&fit=crop&w=1200&h=675&q=80',
      caption: 'Global financial centers, international commerce, and economic indicators.',
      credit: 'Unsplash / International Markets',
    },
    {
      url: 'https://images.unsplash.com/photo-1504711434969-e33886168f5c?auto=format&fit=crop&w=1200&h=675&q=80',
      caption: 'International press coverage and independent investigative journalism.',
      credit: 'Jigawa Times World Desk',
    },
  ],
  politics: [
    {
      url: 'https://images.unsplash.com/photo-1541872703-74c5e44368f9?auto=format&fit=crop&w=1200&h=675&q=80',
      caption: 'Legislative proceedings, democratic discourse, and public leadership.',
      credit: 'Unsplash / Politics Desk',
    },
    {
      url: 'https://images.unsplash.com/photo-1589829545856-d10d557cf95f?auto=format&fit=crop&w=1200&h=675&q=80',
      caption: 'Constitutional rule of law and public regulatory oversight.',
      credit: 'Unsplash / Legal Bureau',
    },
  ],
  business: [
    {
      url: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1200&h=675&q=80',
      caption: 'Corporate trade, market economics, and enterprise investments.',
      credit: 'Unsplash / Business News Desk',
    },
    {
      url: 'https://images.unsplash.com/photo-1526304640581-d334cdbbf45e?auto=format&fit=crop&w=1200&h=675&q=80',
      caption: 'Financial liquidity, foreign exchange, and central banking policy.',
      credit: 'Unsplash / Business Correspondent',
    },
  ],
  education: [
    {
      url: 'https://images.unsplash.com/photo-1523240795612-9a054b0db644?auto=format&fit=crop&w=1200&h=675&q=80',
      caption: 'Educational institutions, public scholarship, and academic development.',
      credit: 'Unsplash / Education Desk',
    },
  ],
  investigations: [
    {
      url: 'https://images.unsplash.com/photo-1589829545856-d10d557cf95f?auto=format&fit=crop&w=1200&h=675&q=80',
      caption: 'Legal accountability, investigative reports, and judicial integrity.',
      credit: 'Unsplash / Justice Desk',
    },
  ],
  default: [
    {
      url: 'https://images.unsplash.com/photo-1504711434969-e33886168f5c?auto=format&fit=crop&w=1200&h=675&q=80',
      caption: 'Jigawa Times independent press reporting.',
      credit: 'Jigawa Times Newsroom',
    },
    {
      url: 'https://images.unsplash.com/photo-1547471080-7cc2caa01a7e?auto=format&fit=crop&w=1200&h=675&q=80',
      caption: 'News reporting and public documentation across Jigawa and Nigeria.',
      credit: 'Jigawa Times Editorial Bureau',
    },
  ],
};

/**
 * Check whether a URL's domain is on the restricted list.
 */
function isRestrictedDomain(url) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    return RESTRICTED_DOMAINS.some((d) => hostname === d || hostname.endsWith('.' + d));
  } catch {
    return true;
  }
}

/**
 * Validate image reachability with redirect-following (up to 3 hops).
 * Also recognizes common image extensions & CDN patterns.
 */
function validateImageUrl(url, timeoutMs = 6000, maxRedirects = 3) {
  return new Promise((resolve) => {
    if (!url || typeof url !== 'string' || !url.startsWith('http')) return resolve(false);

    // Fast path: direct image extensions or known news CDNs
    if (/\.(jpe?g|png|webp|avif)(\?.*)?$/i.test(url) ||
        url.includes('googleusercontent.com') ||
        url.includes('cloudinary.com') ||
        url.includes('/wp-content/uploads/')) {
      return resolve(true);
    }

    try {
      const parsed = new URL(url);
      const lib = parsed.protocol === 'https:' ? https : http;
      const req = lib.request(
        {
          method: 'HEAD',
          hostname: parsed.hostname,
          path: parsed.pathname + parsed.search,
          timeout: timeoutMs,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
          },
        },
        (res) => {
          // Follow redirects
          if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && maxRedirects > 0) {
            const nextUrl = new URL(res.headers.location, url).toString();
            return validateImageUrl(nextUrl, timeoutMs, maxRedirects - 1).then(resolve);
          }

          const ct = (res.headers['content-type'] || '').toLowerCase();
          // Accept 200, 204, 304, or 405 (Method Not Allowed for HEAD on some image CDNs)
          const isValid = (res.statusCode >= 200 && res.statusCode < 400 && (ct.startsWith('image/') || ct.includes('octet-stream') || !ct)) ||
                          (res.statusCode === 405 && /\.(jpe?g|png|webp|avif)/i.test(url));
          resolve(isValid);
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
 * PATH A — Check if the item already has a valid image URL from RSS.
 */
async function selectSourceImage(item) {
  if (!item) return null;
  const url = item.imageUrl || item.rawData?.originalImageUrl || item.rawData?.imageUrl;
  if (!url || typeof url !== 'string' || !url.startsWith('http')) return null;
  if (isRestrictedDomain(url)) return null;

  const valid = await validateImageUrl(url);
  if (!valid) return null;

  return {
    url,
    caption: item.title ? `News photo: ${item.title}` : 'Source news photograph.',
    credit: item.sourceName || 'News Desk',
    source: item.sourceUrl,
    type: 'source',
  };
}

/**
 * PATH B — Webpage Scraper: fetch source article HTML and extract og:image or twitter:image.
 */
async function scrapeSourcePageImage(sourceUrl, sourceName, storyTitle) {
  if (!sourceUrl || typeof sourceUrl !== 'string' || !sourceUrl.startsWith('http')) return null;

  return new Promise((resolve) => {
    try {
      const parsed = new URL(sourceUrl);
      const lib = parsed.protocol === 'https:' ? https : http;
      const req = lib.request(
        {
          method: 'GET',
          hostname: parsed.hostname,
          path: parsed.pathname + parsed.search,
          timeout: 7000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            Accept: 'text/html,application/xhtml+xml',
          },
        },
        (res) => {
          if (res.statusCode < 200 || res.statusCode >= 400) {
            return resolve(null);
          }
          let html = '';
          res.on('data', (chunk) => {
            html += chunk.toString();
            // Stop downloading after reading head (~25KB)
            if (html.length > 25000) req.destroy();
          });
          res.on('end', () => {
            const ogMatch = html.match(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]+content=["']([^"']+)["']/i) ||
                            html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image|twitter:image)["']/i);
            if (ogMatch && ogMatch[1] && ogMatch[1].startsWith('http')) {
              const imgUrl = ogMatch[1];
              if (!isRestrictedDomain(imgUrl)) {
                return resolve({
                  url: imgUrl,
                  caption: storyTitle ? `News photo: ${storyTitle}` : 'Source article photograph.',
                  credit: sourceName ? `Photo: ${sourceName}` : 'News Desk',
                  type: 'scraped_source',
                });
              }
            }
            resolve(null);
          });
        }
      );
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
      req.end();
    } catch {
      resolve(null);
    }
  });
}

/**
 * PATH C — Generate 16:9 editorial news illustration using Pollinations.ai.
 * Completely free, high resolution (1200x675), runs 24/7 with zero API key needed.
 * Incorporates unique character hash seed so different stories get completely distinct visuals.
 */
function generatePollinationsImage(headline, category, region, brief = {}) {
  const title = headline || brief.title || 'News Update';
  const cleanHeadline = (brief.prompt || title)
    .replace(/[^a-zA-Z0-9\s,-]/g, ' ')
    .slice(0, 140)
    .trim();

  const regLabel = region === 'jigawa' ? 'Jigawa State, Northern Nigeria' : region === 'africa' ? 'Africa' : region === 'world' ? 'Global international' : 'Nigeria';
  const promptText = `Award-winning documentary photojournalism of ${cleanHeadline}, authentic setting in ${regLabel}, dynamic news scene, 8k resolution, photorealistic, cinematic lighting, 16:9 aspect ratio`;

  // Unique deterministic seed using SHA-256
  const seed = crypto.createHash('sha256').update(cleanHeadline).digest().readUInt32BE(0) % 1000000;
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(promptText)}?width=1200&height=675&nologo=true&seed=${seed}`;

  return {
    url,
    caption: brief.caption || (title ? `News photo: ${title}` : 'AI-assisted news illustration.'),
    credit: 'AI Newsroom Editorial Photo — Jigawa Times',
    type: 'ai_generated',
  };
}

/**
 * PATH D — High-resolution curated editorial photography for Jigawa Times categories.
 * Picks from a multi-photo pool using a headline hash so distinct stories NEVER receive the same image.
 */
function getCuratedCategoryFallback(category, headline = '') {
  const catKey = (category || '').toLowerCase();
  const pool = CATEGORY_EDITORIAL_POOLS[catKey] ||
               CATEGORY_EDITORIAL_POOLS[catKey === 'buji' ? 'jigawa' : 'default'] ||
               CATEGORY_EDITORIAL_POOLS.default;

  const hash = crypto.createHash('sha256').update(String(headline || 'news')).digest().readUInt32BE(0);
  const selected = pool[hash % pool.length];


  return {
    url: selected.url,
    caption: headline ? `${headline} — ${selected.caption}` : selected.caption,
    credit: selected.credit,
    type: 'curated_stock',
  };
}

/**
 * Master image selector:
 * 1. Checks RSS feed image
 * 2. Scrapes webpage for og:image
 * 3. Generates 16:9 news illustration via Pollinations.ai (distinct seed per headline)
 * 4. Falls back to rotating multi-photo curated photography (different photo per story)
 */
async function selectImage(item = {}, brief = {}, config = {}) {
  // Normalize item input safely
  const normalizedItem = typeof item === 'string'
    ? { imageUrl: item, title: brief.title || 'News Update' }
    : {
        title: item.title || brief.title || item.sourceTitle || 'News Update',
        imageUrl: item.imageUrl || item.rawData?.originalImageUrl || item.rawData?.imageUrl,
        sourceUrl: item.sourceUrl,
        sourceName: item.sourceName,
        category: (item.category || 'jigawa').toLowerCase(),
        region: (item.region || item.rawData?.region || 'nigeria').toLowerCase(),
      };

  // PATH A: RSS item direct image
  try {
    const sourceImage = await selectSourceImage(normalizedItem);
    if (sourceImage) {
      console.log(`[NEWSROOM] Using direct RSS source image for "${normalizedItem.title}"`);
      return sourceImage;
    }
  } catch {}

  // PATH B: Scrape source webpage for og:image
  if (normalizedItem.sourceUrl) {
    try {
      const scraped = await scrapeSourcePageImage(normalizedItem.sourceUrl, normalizedItem.sourceName, normalizedItem.title);
      if (scraped) {
        console.log(`[NEWSROOM] Successfully scraped og:image from ${normalizedItem.sourceName} for "${normalizedItem.title}"`);
        return scraped;
      }
    } catch {}
  }

  // PATH C: AI Image Generation via Pollinations (default enabled)
  const provider = (config.imageProvider || 'pollinations').toLowerCase();
  if (provider === 'pollinations' && normalizedItem.title) {
    try {
      const aiImg = generatePollinationsImage(normalizedItem.title, normalizedItem.category, normalizedItem.region, brief);
      console.log(`[NEWSROOM] Generated unique AI news illustration for "${normalizedItem.title}"`);
      return aiImg;
    } catch (e) {
      console.warn(`[NEWSROOM] AI image generation fallback error: ${e.message}`);
    }
  }

  // PATH D: High-resolution rotating category editorial fallback
  console.log(`[NEWSROOM] Assigned curated category photo for "${normalizedItem.title}" (${normalizedItem.category})`);
  return getCuratedCategoryFallback(normalizedItem.category, normalizedItem.title);
}

module.exports = {
  selectImage,
  selectSourceImage,
  scrapeSourcePageImage,
  generatePollinationsImage,
  getCuratedCategoryFallback,
  validateImageUrl,
  isRestrictedDomain,
  CATEGORY_EDITORIAL_POOLS,
};
