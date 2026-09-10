// newsroom/images.js
// Enterprise Image Sourcing, Scraping & AI Generation for the AI Newsroom.
//
// PATH A — Direct RSS image: item.imageUrl if present and reachable.
// PATH B — Webpage Scraper: fetches source article HTML to extract og:image / twitter:image.
// PATH C — AI Generation: generates contextual 16:9 news illustration via Pollinations.ai (free, no key needed).
// PATH D — Curated Editorial Stock: high-resolution category photography curated for Nigerian & Jigawa news.
//
// Guarantees that EVERY published and drafted story has a high-quality featured image.

'use strict';

const https = require('https');
const http  = require('http');

// Domains where images should not be directly republished
const RESTRICTED_DOMAINS = [
  'twitter.com', 'x.com', 'facebook.com', 'instagram.com',
  'tiktok.com', 'snapchat.com', 'whatsapp.com',
  'gettyimages.com', 'shutterstock.com', 'alamy.com',
  'istockphoto.com', 'depositphotos.com',
];

// Curated high-resolution editorial photography mapped to Jigawa Times categories
const CATEGORY_EDITORIAL_IMAGES = {
  jigawa: {
    url: 'https://images.unsplash.com/photo-1547471080-7cc2caa01a7e?auto=format&fit=crop&w=1200&h=675&q=80',
    caption: 'Governmental and community development in Northern Nigeria.',
    credit: 'Unsplash / Jigawa Times Archives',
  },
  buji: {
    url: 'https://images.unsplash.com/photo-1596755389378-c31d21fd1273?auto=format&fit=crop&w=1200&h=675&q=80',
    caption: 'Local community and agrarian life across Buji Local Government Area.',
    credit: 'Jigawa Times Rural Desk',
  },
  politics: {
    url: 'https://images.unsplash.com/photo-1541872703-74c5e44368f9?auto=format&fit=crop&w=1200&h=675&q=80',
    caption: 'Governance, democratic institutions, and political affairs in Nigeria.',
    credit: 'Unsplash / Editorial Archives',
  },
  business: {
    url: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1200&h=675&q=80',
    caption: 'Economic policy, market commerce, and financial infrastructure.',
    credit: 'Unsplash / Business News Desk',
  },
  education: {
    url: 'https://images.unsplash.com/photo-1523240795612-9a054b0db644?auto=format&fit=crop&w=1200&h=675&q=80',
    caption: 'Educational institutions, public scholarship, and academic development.',
    credit: 'Unsplash / Education Desk',
  },
  investigations: {
    url: 'https://images.unsplash.com/photo-1589829545856-d10d557cf95f?auto=format&fit=crop&w=1200&h=675&q=80',
    caption: 'Legal accountability, investigative reports, and judicial integrity.',
    credit: 'Unsplash / Justice Desk',
  },
  default: {
    url: 'https://images.unsplash.com/photo-1504711434969-e33886168f5c?auto=format&fit=crop&w=1200&h=675&q=80',
    caption: 'Jigawa Times independent press coverage.',
    credit: 'Jigawa Times Newsroom',
  },
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
 * Validate image reachability via HEAD request.
 */
function validateImageUrl(url, timeoutMs = 6000) {
  return new Promise((resolve) => {
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
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) JigawaTimesBot/2.0',
          },
        },
        (res) => {
          const ct = (res.headers['content-type'] || '').toLowerCase();
          resolve(res.statusCode >= 200 && res.statusCode < 400 && (ct.startsWith('image/') || ct.includes('octet-stream')));
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
  const url = item.imageUrl;
  if (!url || typeof url !== 'string' || !url.startsWith('http')) return null;
  if (isRestrictedDomain(url)) return null;

  const valid = await validateImageUrl(url);
  if (!valid) return null;

  return {
    url,
    caption: item.title ? `Image report: ${item.title}` : 'Source news photo.',
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
 */
function generatePollinationsImage(headline, category, region, brief) {
  const cleanHeadline = (headline || 'Nigerian news report')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .slice(0, 100)
    .trim();

  const promptText = `Editorial news photojournalism of ${cleanHeadline}, ${category || 'Nigeria'} news, Jigawa State context, professional photography, cinematic lighting, 16:9 aspect ratio`;
  const seed = Math.abs(headline.split('').reduce((acc, char) => (acc * 31 + char.charCodeAt(0)) | 0, 0)) % 100000;
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(promptText)}?width=1200&height=675&nologo=true&seed=${seed}`;

  return {
    url,
    caption: brief?.caption || (headline ? `Editorial illustration: ${headline}` : 'AI-assisted news illustration.'),
    credit: 'AI Newsroom Editorial Illustration — Jigawa Times',
    type: 'ai_generated',
  };
}

/**
 * PATH D — High-resolution curated editorial photography for Jigawa Times categories.
 */
function getCuratedCategoryFallback(category, headline) {
  const catKey = (category || '').toLowerCase();
  const config = CATEGORY_EDITORIAL_IMAGES[catKey] || CATEGORY_EDITORIAL_IMAGES.default;
  return {
    url: config.url,
    caption: headline ? `${headline} — ${config.caption}` : config.caption,
    credit: config.credit,
    type: 'curated_stock',
  };
}

/**
 * Master image selector:
 * 1. Checks RSS feed image
 * 2. Scrapes webpage for og:image
 * 3. Generates 16:9 news illustration via Pollinations.ai
 * 4. Falls back to curated category photography
 */
async function selectImage(item, brief, config = {}) {
  // PATH A: RSS item direct image
  try {
    const sourceImage = await selectSourceImage(item);
    if (sourceImage) {
      console.log(`[NEWSROOM] Found direct RSS source image for "${item.title}"`);
      return sourceImage;
    }
  } catch {}

  // PATH B: Scrape source webpage for og:image
  if (item.sourceUrl) {
    try {
      const scraped = await scrapeSourcePageImage(item.sourceUrl, item.sourceName, item.title);
      if (scraped) {
        console.log(`[NEWSROOM] Successfully scraped og:image from ${item.sourceName} for "${item.title}"`);
        return scraped;
      }
    } catch {}
  }

  // PATH C: AI Image Generation via Pollinations (default provider)
  const provider = (config.imageProvider || 'pollinations').toLowerCase();
  if (provider === 'pollinations' && item.title) {
    try {
      const aiImg = generatePollinationsImage(item.title, item.category, item.region, brief);
      console.log(`[NEWSROOM] Generated AI news illustration for "${item.title}"`);
      return aiImg;
    } catch (e) {
      console.warn(`[NEWSROOM] AI image generation fallback error: ${e.message}`);
    }
  }

  // PATH D: High-resolution category editorial fallback
  console.log(`[NEWSROOM] Assigned curated category photo for "${item.title}" (${item.category})`);
  return getCuratedCategoryFallback(item.category, item.title);
}

module.exports = {
  selectImage,
  selectSourceImage,
  scrapeSourcePageImage,
  generatePollinationsImage,
  getCuratedCategoryFallback,
  validateImageUrl,
  isRestrictedDomain,
};
