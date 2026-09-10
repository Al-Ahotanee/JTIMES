// Jigawa Times — server.js
// Express REST API + static hosting of the built Vue app, on a single
// Render Web Service. Listens on process.env.PORT (never hardcoded).

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sanitizeHtml = require('sanitize-html');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const app = express();

// AI Newsroom — loaded lazily so missing env vars don't crash the main server
let newsroom = null;
try {
  newsroom = require('./newsroom/index.js');
} catch (err) {
  console.warn('[SERVER] AI Newsroom could not be loaded:', err.message);
}

const AUTH_SECRET = process.env.AUTH_SECRET;
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PROD = NODE_ENV === 'production';

if (!AUTH_SECRET) {
  console.error('FATAL: AUTH_SECRET environment variable is not set.');
  process.exit(1);
}

// ---------------------------------------------------------------------
// Security & core middleware
// ---------------------------------------------------------------------
app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(cors({ origin: true, credentials: true }));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });
app.use('/api/', apiLimiter);
app.use('/api/auth/login', authLimiter);

const sanitize = (html) =>
  sanitizeHtml(html || '', {
    allowedTags: ['p', 'br', 'strong', 'em', 'b', 'i', 'u', 'a', 'blockquote', 'ul', 'ol', 'li', 'h2', 'h3', 'h4', 'img', 'figure', 'figcaption'],
    allowedAttributes: { a: ['href', 'target', 'rel'], img: ['src', 'alt'] },
    allowedSchemes: ['http', 'https', 'mailto'],
  });

const publicUser = (u) => u && { id: u.id, name: u.name, email: u.email, role: u.role, bio: u.bio, avatar: u.avatar, active: u.active };

// ---------------------------------------------------------------------
// Auth helpers — server-side authorization only, never trust the client
// ---------------------------------------------------------------------
function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, AUTH_SECRET, { expiresIn: '7d' });
}

async function requireAuth(req, res, next) {
  try {
    const token = req.cookies?.jt_token || (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    const payload = jwt.verify(token, AUTH_SECRET);
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.active) return res.status(401).json({ error: 'Unauthorized' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}

const isStaff = (u) => u.role === 'ADMIN' || u.role === 'EDITOR';
const canEditArticle = (user, article) =>
  user.role === 'ADMIN' || user.role === 'EDITOR' || (user.role === 'REPORTER' && article.authorId === user.id);

const slugify = (s) =>
  (s || '').toString().toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 90);

// ---------------------------------------------------------------------
// AUTH
// ---------------------------------------------------------------------
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
  const user = await prisma.user.findUnique({ where: { email: String(email).toLowerCase().trim() } });
  if (!user || !user.active) return res.status(401).json({ error: 'Invalid credentials.' });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials.' });
  const token = signToken(user);
  res.cookie('jt_token', token, { httpOnly: true, secure: IS_PROD, sameSite: 'lax', maxAge: 7 * 24 * 3600 * 1000 });
  res.json({ user: publicUser(user) });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('jt_token');
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

// ---------------------------------------------------------------------
// PUBLIC: ARTICLES
// ---------------------------------------------------------------------
app.get('/api/articles', async (req, res) => {
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const pageSize = Math.min(Math.max(parseInt(req.query.pageSize) || 12, 1), 50);
  const { category, tag, author, breaking, featured, status, mine } = req.query;

  const where = {};
  // Default to only published content for public callers.
  where.status = 'PUBLISHED';

  if (category) where.category = { slug: category };
  if (tag) where.tags = { some: { tag: { slug: tag } } };
  if (author) where.authorId = parseInt(author);
  if (breaking === 'true') where.isBreaking = true;
  if (featured === 'true') where.isFeatured = true;

  // Staff-only override to see non-published content (used by dashboards).
  let effectiveUser = null;
  const token = req.cookies?.jt_token || (req.headers.authorization || '').replace('Bearer ', '');
  if (token) {
    try {
      const payload = jwt.verify(token, AUTH_SECRET);
      effectiveUser = await prisma.user.findUnique({ where: { id: payload.sub } });
    } catch {}
  }
  if (effectiveUser && status) {
    if (isStaff(effectiveUser)) {
      where.status = status;
    } else if (effectiveUser.role === 'REPORTER' && mine === 'true') {
      where.status = status;
      where.authorId = effectiveUser.id;
    }
  } else if (effectiveUser && mine === 'true') {
    delete where.status;
    where.authorId = effectiveUser.id;
  }

  const [items, total] = await Promise.all([
    prisma.article.findMany({
      where,
      orderBy: { publishedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { author: true, category: true, tags: { include: { tag: true } } },
    }),
    prisma.article.count({ where }),
  ]);

  res.json({
    items: items.map(serializeArticle),
    page, pageSize, total, totalPages: Math.ceil(total / pageSize) || 1,
  });
});

app.get('/api/articles/most-read', async (req, res) => {
  const window = req.query.window === 'today' ? 1 : 7;
  const items = await prisma.article.findMany({
    where: { status: 'PUBLISHED', publishedAt: { gte: new Date(Date.now() - window * 86400000) } },
    orderBy: { views: 'desc' },
    take: 8,
    include: { author: true, category: true, tags: { include: { tag: true } } },
  });
  res.json({ items: items.map(serializeArticle) });
});

app.get('/api/articles/:slug', async (req, res) => {
  const article = await prisma.article.findUnique({
    where: { slug: req.params.slug },
    include: { author: true, category: true, tags: { include: { tag: true } } },
  });
  if (!article) return res.status(404).json({ error: 'Article not found.' });

  // Only staff or the owning reporter may view non-published articles.
  if (article.status !== 'PUBLISHED') {
    const token = req.cookies?.jt_token || (req.headers.authorization || '').replace('Bearer ', '');
    let user = null;
    if (token) {
      try { user = await prisma.user.findUnique({ where: { id: jwt.verify(token, AUTH_SECRET).sub } }); } catch {}
    }
    if (!user || !canEditArticle(user, article)) return res.status(404).json({ error: 'Article not found.' });
  } else {
    // Lightweight view counting: only count once per slug per 30 minutes per
    // client, tracked via a short-lived signed cookie — avoids inflating
    // counts on every refresh without needing a separate analytics store.
    const cookieKey = `v_${article.id}`;
    if (!req.cookies?.[cookieKey]) {
      await prisma.article.update({ where: { id: article.id }, data: { views: { increment: 1 } } });
      article.views += 1;
      res.cookie(cookieKey, '1', { maxAge: 30 * 60 * 1000, httpOnly: true, sameSite: 'lax' });
    }
  }

  res.json({ article: serializeArticle(article) });
});

function serializeArticle(a) {
  return {
    id: a.id, title: a.title, slug: a.slug, excerpt: a.excerpt, content: a.content,
    featuredImage: a.featuredImage, imageCaption: a.imageCaption, status: a.status,
    isBreaking: a.isBreaking, isFeatured: a.isFeatured, views: a.views,
    publishedAt: a.publishedAt, createdAt: a.createdAt, updatedAt: a.updatedAt,
    author: a.author && { id: a.author.id, name: a.author.name, avatar: a.author.avatar, bio: a.author.bio },
    category: a.category && { id: a.category.id, name: a.category.name, slug: a.category.slug },
    tags: (a.tags || []).map((t) => ({ id: t.tag.id, name: t.tag.name, slug: t.tag.slug })),
  };
}

// ---------------------------------------------------------------------
// SEARCH — PostgreSQL full-text search (no client-side loading of all rows)
// ---------------------------------------------------------------------
app.get('/api/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  const category = req.query.category;
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const pageSize = 12;
  if (!q) return res.json({ items: [], total: 0, page, pageSize, totalPages: 1 });

  const catFilter = category ? prisma.$queryRaw`AND c.slug = ${category}` : prisma.$queryRaw``;

  const rows = await prisma.$queryRaw`
    SELECT a.id FROM "Article" a
    JOIN "Category" c ON c.id = a."categoryId"
    LEFT JOIN "ArticleTag" at ON at."articleId" = a.id
    LEFT JOIN "Tag" t ON t.id = at."tagId"
    WHERE a.status = 'PUBLISHED'
      AND ${category ? prisma.$queryRaw`c.slug = ${category} AND` : prisma.$queryRaw``}
      (to_tsvector('english', coalesce(a.title,'') || ' ' || coalesce(a.excerpt,'') || ' ' || coalesce(a.content,''))
        @@ plainto_tsquery('english', ${q})
       OR t.name ILIKE ${'%' + q + '%'})
    GROUP BY a.id
    ORDER BY a."publishedAt" DESC
    LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
  `.catch(async () => {
    // Fallback (e.g. if raw query construction above fails on some PG versions): ILIKE search.
    return prisma.article.findMany({
      where: {
        status: 'PUBLISHED',
        ...(category ? { category: { slug: category } } : {}),
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { excerpt: { contains: q, mode: 'insensitive' } },
          { content: { contains: q, mode: 'insensitive' } },
        ],
      },
      select: { id: true },
      take: pageSize,
      skip: (page - 1) * pageSize,
    });
  });

  const ids = rows.map((r) => r.id);
  const items = ids.length
    ? await prisma.article.findMany({
        where: { id: { in: ids } },
        include: { author: true, category: true, tags: { include: { tag: true } } },
        orderBy: { publishedAt: 'desc' },
      })
    : [];

  res.json({ items: items.map(serializeArticle), page, pageSize, total: items.length, totalPages: 1 });
});

// ---------------------------------------------------------------------
// CATEGORIES
// ---------------------------------------------------------------------
app.get('/api/categories', async (req, res) => {
  const categories = await prisma.category.findMany({ orderBy: { order: 'asc' } });
  res.json({ items: categories });
});

app.post('/api/categories', requireAuth, requireRole('ADMIN'), async (req, res) => {
  const { name, description } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Name is required.' });
  const category = await prisma.category.create({ data: { name, slug: slugify(name), description } });
  res.status(201).json({ category });
});

app.put('/api/categories/:id', requireAuth, requireRole('ADMIN'), async (req, res) => {
  const { name, description, order } = req.body || {};
  const data = {};
  if (name) { data.name = name; data.slug = slugify(name); }
  if (description !== undefined) data.description = description;
  if (order !== undefined) data.order = order;
  const category = await prisma.category.update({ where: { id: parseInt(req.params.id) }, data });
  res.json({ category });
});

app.delete('/api/categories/:id', requireAuth, requireRole('ADMIN'), async (req, res) => {
  await prisma.category.delete({ where: { id: parseInt(req.params.id) } });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------
// TAGS
// ---------------------------------------------------------------------
app.get('/api/tags', async (req, res) => res.json({ items: await prisma.tag.findMany({ orderBy: { name: 'asc' } }) }));

app.post('/api/tags', requireAuth, requireRole('ADMIN', 'EDITOR'), async (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Name is required.' });
  const tag = await prisma.tag.upsert({
    where: { slug: slugify(name) },
    update: {},
    create: { name, slug: slugify(name) },
  });
  res.status(201).json({ tag });
});

// ---------------------------------------------------------------------
// ARTICLES — create / update / workflow (server-side RBAC enforced)
// ---------------------------------------------------------------------
app.post('/api/articles', requireAuth, requireRole('ADMIN', 'EDITOR', 'REPORTER'), async (req, res) => {
  const { title, excerpt, content, categoryId, featuredImage, imageCaption, tags, isBreaking, isFeatured } = req.body || {};
  if (!title || !content || !categoryId) return res.status(400).json({ error: 'Title, content and category are required.' });

  const baseSlug = slugify(title);
  let slug = baseSlug;
  let n = 1;
  while (await prisma.article.findUnique({ where: { slug } })) slug = `${baseSlug}-${++n}`;

  const canFlag = isStaff(req.user);
  const article = await prisma.article.create({
    data: {
      title, slug, excerpt, content: sanitize(content),
      categoryId: parseInt(categoryId), authorId: req.user.id,
      featuredImage: featuredImage || null, imageCaption: imageCaption || null,
      isBreaking: canFlag ? !!isBreaking : false,
      isFeatured: canFlag ? !!isFeatured : false,
      status: 'DRAFT',
      tags: tags?.length
        ? { create: await Promise.all(tags.map(async (name) => ({
            tag: { connectOrCreate: { where: { slug: slugify(name) }, create: { name, slug: slugify(name) } } },
          }))) }
        : undefined,
    },
    include: { author: true, category: true, tags: { include: { tag: true } } },
  });
  res.status(201).json({ article: serializeArticle(article) });
});

app.put('/api/articles/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  const article = await prisma.article.findUnique({ where: { id } });
  if (!article) return res.status(404).json({ error: 'Article not found.' });
  if (!canEditArticle(req.user, article)) return res.status(403).json({ error: 'Forbidden' });
  // Reporters may only edit their own drafts/revision-required stories.
  if (req.user.role === 'REPORTER' && !['DRAFT', 'REVISION_REQUIRED'].includes(article.status)) {
    return res.status(403).json({ error: 'This article is no longer editable at its current stage.' });
  }

  const { title, excerpt, content, categoryId, featuredImage, imageCaption, isBreaking, isFeatured } = req.body || {};
  const data = {};
  if (title) data.title = title;
  if (excerpt !== undefined) data.excerpt = excerpt;
  if (content !== undefined) data.content = sanitize(content);
  if (categoryId) data.categoryId = parseInt(categoryId);
  if (featuredImage !== undefined) data.featuredImage = featuredImage;
  if (imageCaption !== undefined) data.imageCaption = imageCaption;
  if (isStaff(req.user)) {
    if (isBreaking !== undefined) data.isBreaking = !!isBreaking;
    if (isFeatured !== undefined) data.isFeatured = !!isFeatured;
  }

  const updated = await prisma.article.update({
    where: { id }, data,
    include: { author: true, category: true, tags: { include: { tag: true } } },
  });
  res.json({ article: serializeArticle(updated) });
});

app.delete('/api/articles/:id', requireAuth, requireRole('ADMIN'), async (req, res) => {
  await prisma.article.delete({ where: { id: parseInt(req.params.id) } });
  res.json({ ok: true });
});

async function transition(req, res, { from, to, allowedRoles, action }) {
  const id = parseInt(req.params.id);
  const article = await prisma.article.findUnique({ where: { id } });
  if (!article) return res.status(404).json({ error: 'Article not found.' });

  const isOwner = req.user.role === 'REPORTER' && article.authorId === req.user.id;
  const roleOk = allowedRoles.includes(req.user.role) && (allowedRoles.includes('REPORTER') ? isOwner || isStaff(req.user) : true);
  if (!roleOk) return res.status(403).json({ error: 'Forbidden' });
  if (req.user.role === 'ADMIN') {
    // Admin can override the workflow from any state.
  } else if (from.length && !from.includes(article.status)) {
    return res.status(409).json({ error: `Article must be in one of [${from.join(', ')}] for this action (currently ${article.status}).` });
  }

  const data = { status: to };
  if (to === 'PUBLISHED') data.publishedAt = new Date();

  const updated = await prisma.$transaction([
    prisma.article.update({ where: { id }, data, include: { author: true, category: true, tags: { include: { tag: true } } } }),
    prisma.editorialAction.create({ data: { articleId: id, userId: req.user.id, action, note: req.body?.note || null } }),
  ]);
  res.json({ article: serializeArticle(updated[0]) });
}

app.post('/api/articles/:id/submit', requireAuth, requireRole('ADMIN', 'EDITOR', 'REPORTER'), (req, res) =>
  transition(req, res, { from: ['DRAFT', 'REVISION_REQUIRED'], to: 'SUBMITTED', allowedRoles: ['ADMIN', 'EDITOR', 'REPORTER'], action: 'SUBMITTED' }));

app.post('/api/articles/:id/review', requireAuth, requireRole('ADMIN', 'EDITOR'), (req, res) =>
  transition(req, res, { from: ['SUBMITTED'], to: 'IN_REVIEW', allowedRoles: ['ADMIN', 'EDITOR'], action: 'IN_REVIEW' }));

app.post('/api/articles/:id/request-revision', requireAuth, requireRole('ADMIN', 'EDITOR'), (req, res) =>
  transition(req, res, { from: ['IN_REVIEW', 'SUBMITTED'], to: 'REVISION_REQUIRED', allowedRoles: ['ADMIN', 'EDITOR'], action: 'REVISION_REQUIRED' }));

app.post('/api/articles/:id/approve', requireAuth, requireRole('ADMIN', 'EDITOR'), (req, res) =>
  transition(req, res, { from: ['IN_REVIEW'], to: 'APPROVED', allowedRoles: ['ADMIN', 'EDITOR'], action: 'APPROVED' }));

app.post('/api/articles/:id/publish', requireAuth, requireRole('ADMIN', 'EDITOR'), (req, res) =>
  transition(req, res, { from: ['APPROVED', 'IN_REVIEW'], to: 'PUBLISHED', allowedRoles: ['ADMIN', 'EDITOR'], action: 'PUBLISHED' }));

app.post('/api/articles/:id/unpublish', requireAuth, requireRole('ADMIN', 'EDITOR'), (req, res) =>
  transition(req, res, { from: ['PUBLISHED'], to: 'APPROVED', allowedRoles: ['ADMIN', 'EDITOR'], action: 'UNPUBLISHED' }));

app.post('/api/articles/:id/archive', requireAuth, requireRole('ADMIN', 'EDITOR'), (req, res) =>
  transition(req, res, { from: [], to: 'ARCHIVED', allowedRoles: ['ADMIN', 'EDITOR'], action: 'ARCHIVED' }));

// ---------------------------------------------------------------------
// AUTHORS (public)
// ---------------------------------------------------------------------
app.get('/api/authors/:id', async (req, res) => {
  const author = await prisma.user.findUnique({ where: { id: parseInt(req.params.id) } });
  if (!author) return res.status(404).json({ error: 'Author not found.' });
  const articles = await prisma.article.findMany({
    where: { authorId: author.id, status: 'PUBLISHED' },
    orderBy: { publishedAt: 'desc' },
    include: { author: true, category: true, tags: { include: { tag: true } } },
  });
  res.json({ author: publicUser(author), articles: articles.map(serializeArticle) });
});

// ---------------------------------------------------------------------
// USERS (admin only)
// ---------------------------------------------------------------------
app.get('/api/users', requireAuth, requireRole('ADMIN'), async (req, res) => {
  const users = await prisma.user.findMany({ orderBy: { createdAt: 'desc' } });
  res.json({ items: users.map(publicUser) });
});

app.post('/api/users', requireAuth, requireRole('ADMIN'), async (req, res) => {
  const { name, email, password, role, bio } = req.body || {};
  if (!name || !email || !password || !role) return res.status(400).json({ error: 'Name, email, password and role are required.' });
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({ data: { name, email: email.toLowerCase().trim(), passwordHash, role, bio } });
  res.status(201).json({ user: publicUser(user) });
});

app.put('/api/users/:id', requireAuth, requireRole('ADMIN'), async (req, res) => {
  const { name, role, bio, active, password } = req.body || {};
  const data = {};
  if (name !== undefined) data.name = name;
  if (role !== undefined) data.role = role;
  if (bio !== undefined) data.bio = bio;
  if (active !== undefined) data.active = active;
  if (password) data.passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.update({ where: { id: parseInt(req.params.id) }, data });
  res.json({ user: publicUser(user) });
});

// ---------------------------------------------------------------------
// ADMIN STATS
// ---------------------------------------------------------------------
app.get('/api/admin/stats', requireAuth, requireRole('ADMIN', 'EDITOR'), async (req, res) => {
  const [total, published, drafts, pending, revisions, reporters, users, comments, recent] = await Promise.all([
    prisma.article.count(),
    prisma.article.count({ where: { status: 'PUBLISHED' } }),
    prisma.article.count({ where: { status: 'DRAFT' } }),
    prisma.article.count({ where: { status: { in: ['SUBMITTED', 'IN_REVIEW'] } } }),
    prisma.article.count({ where: { status: 'REVISION_REQUIRED' } }),
    prisma.user.count({ where: { role: 'REPORTER' } }),
    prisma.user.count(),
    prisma.comment.count({ where: { approved: false } }),
    prisma.article.findMany({ orderBy: { updatedAt: 'desc' }, take: 8, include: { author: true, category: true, tags: { include: { tag: true } } } }),
  ]);
  const totalViews = await prisma.article.aggregate({ _sum: { views: true } });
  res.json({
    totalArticles: total, published, drafts, pendingReview: pending, revisionRequired: revisions,
    totalReporters: reporters, totalUsers: users, totalViews: totalViews._sum.views || 0,
    commentsAwaitingModeration: comments, recentArticles: recent.map(serializeArticle),
  });
});

// ---------------------------------------------------------------------
// COMMENTS
// ---------------------------------------------------------------------
app.get('/api/comments', requireAuth, requireRole('ADMIN', 'EDITOR'), async (req, res) => {
  const where = req.query.approved !== undefined ? { approved: req.query.approved === 'true' } : {};
  const items = await prisma.comment.findMany({ where, orderBy: { createdAt: 'desc' }, include: { article: true } });
  res.json({ items });
});

app.get('/api/articles/:slug/comments', async (req, res) => {
  const article = await prisma.article.findUnique({ where: { slug: req.params.slug } });
  if (!article) return res.status(404).json({ error: 'Article not found.' });
  const items = await prisma.comment.findMany({ where: { articleId: article.id, approved: true }, orderBy: { createdAt: 'desc' } });
  res.json({ items });
});

app.post('/api/comments', async (req, res) => {
  const { articleId, name, email, content } = req.body || {};
  if (!articleId || !name || !email || !content) return res.status(400).json({ error: 'All fields are required.' });
  if (content.length > 2000) return res.status(400).json({ error: 'Comment too long.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email.' });
  const comment = await prisma.comment.create({
    data: { articleId: parseInt(articleId), name: sanitizeHtml(name, { allowedTags: [] }), email, content: sanitizeHtml(content, { allowedTags: [] }), approved: false },
  });
  res.status(201).json({ comment });
});

app.put('/api/comments/:id', requireAuth, requireRole('ADMIN', 'EDITOR'), async (req, res) => {
  const { approved } = req.body || {};
  const comment = await prisma.comment.update({ where: { id: parseInt(req.params.id) }, data: { approved: !!approved } });
  res.json({ comment });
});

app.delete('/api/comments/:id', requireAuth, requireRole('ADMIN', 'EDITOR'), async (req, res) => {
  await prisma.comment.delete({ where: { id: parseInt(req.params.id) } });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------
// SITE SETTINGS
// ---------------------------------------------------------------------
app.get('/api/settings', async (req, res) => {
  const items = await prisma.siteSetting.findMany();
  res.json({ items: Object.fromEntries(items.map((s) => [s.key, s.value])) });
});

app.put('/api/settings/:key', requireAuth, requireRole('ADMIN'), async (req, res) => {
  const { value } = req.body || {};
  const setting = await prisma.siteSetting.upsert({
    where: { key: req.params.key }, update: { value }, create: { key: req.params.key, value },
  });
  res.json({ setting });
});

// ---------------------------------------------------------------------
// NEWSLETTER (lightweight — stores to SiteSetting-style table via Comment-free path)
// ---------------------------------------------------------------------
app.post('/api/newsletter', async (req, res) => {
  const { email } = req.body || {};
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'A valid email is required.' });
  // Stored as a namespaced SiteSetting so no extra table/migration is needed;
  // swap for a real ESP (Mailchimp/Sendy/etc.) integration later.
  await prisma.siteSetting.upsert({
    where: { key: `newsletter_${email.toLowerCase()}` },
    update: { value: new Date().toISOString() },
    create: { key: `newsletter_${email.toLowerCase()}`, value: new Date().toISOString() },
  });
  res.status(201).json({ ok: true });
});

// ---------------------------------------------------------------------
// MEDIA: Cloudinary signed uploads
//
// Images/video are never stored on the server disk or in Postgres —
// Render's free Web Service has an ephemeral filesystem (wiped on every
// deploy/restart), so anything saved locally would be lost. Instead the
// browser uploads straight to Cloudinary's free tier, and this endpoint
// only hands out a short-lived signature so the upload can't be forged.
// The database only ever stores the resulting Cloudinary URL (see
// Article.featuredImage / imageCaption in the schema).
// ---------------------------------------------------------------------
app.post('/api/uploads/sign', requireAuth, requireRole('ADMIN', 'EDITOR', 'REPORTER'), (req, res) => {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) {
    return res.status(500).json({ error: 'Media storage is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET.' });
  }
  const timestamp = Math.round(Date.now() / 1000);
  const folder = `jigawa-times/${req.user.role.toLowerCase()}`;
  // Only the params actually sent to Cloudinary (besides file/api_key) go
  // into the signature, sorted alphabetically, per Cloudinary's spec.
  const toSign = `folder=${folder}&timestamp=${timestamp}${apiSecret}`;
  const signature = crypto.createHash('sha1').update(toSign).digest('hex');
  res.json({ timestamp, signature, apiKey, cloudName, folder });
});

// ---------------------------------------------------------------------
// SEO: sitemap + robots
// ---------------------------------------------------------------------
app.get('/sitemap.xml', async (req, res) => {
  const base = `${req.protocol}://${req.get('host')}`;
  const articles = await prisma.article.findMany({ where: { status: 'PUBLISHED' }, select: { slug: true, updatedAt: true } });
  const categories = await prisma.category.findMany({ select: { slug: true } });
  const staticUrls = ['/', '/about', '/contact', '/editorial-policy', '/privacy', '/terms', '/search'];
  const urls = [
    ...staticUrls.map((u) => `<url><loc>${base}${u}</loc></url>`),
    ...categories.map((c) => `<url><loc>${base}/category/${c.slug}</loc></url>`),
    ...articles.map((a) => `<url><loc>${base}/news/${a.slug}</loc><lastmod>${a.updatedAt.toISOString()}</lastmod></url>`),
  ];
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`);
});

app.get('/robots.txt', (req, res) => {
  const base = `${req.protocol}://${req.get('host')}`;
  res.type('text/plain').send(`User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\n`);
});

// ---------------------------------------------------------------------
// AI NEWSROOM API
// All routes require ADMIN or EDITOR authentication.
// These routes reuse existing auth middleware — no second auth system.
// ---------------------------------------------------------------------

// GET /api/newsroom/items — list newsroom_items with optional status filter
app.get('/api/newsroom/items', requireAuth, requireRole('ADMIN', 'EDITOR'), async (req, res) => {
  const { status, pageSize: ps, page: pg } = req.query;
  const pageSize = Math.min(Math.max(parseInt(ps) || 20, 1), 100);
  const page     = Math.max(parseInt(pg) || 1, 1);
  const where    = status ? { status } : {};
  const [items, total] = await Promise.all([
    prisma.newsroomItem.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { article: { select: { id: true, title: true, slug: true, status: true } } },
    }),
    prisma.newsroomItem.count({ where }),
  ]);
  res.json({ items, page, pageSize, total, totalPages: Math.ceil(total / pageSize) || 1 });
});

// GET /api/newsroom/stats — headline counts for the admin dashboard
app.get('/api/newsroom/stats', requireAuth, requireRole('ADMIN', 'EDITOR'), async (req, res) => {
  const statuses = ['DISCOVERED', 'ANALYZING', 'PENDING_REVIEW', 'GENERATED', 'PUBLISHED', 'FAILED', 'REJECTED'];
  const counts   = await Promise.all(
    statuses.map((s) => prisma.newsroomItem.count({ where: { status: s } }))
  );
  const result = Object.fromEntries(statuses.map((s, i) => [s.toLowerCase(), counts[i]]));
  res.json(result);
});

// POST /api/newsroom/items — create/record a newsroom item (called by newsroom pipeline)
app.post('/api/newsroom/items', requireAuth, requireRole('ADMIN', 'EDITOR'), async (req, res) => {
  const { source_url, source_name, source_title, content_hash, status, category, article_id, review_required, verification, raw_data } = req.body || {};
  if (!source_url || !source_name) return res.status(400).json({ error: 'source_url and source_name are required.' });
  const item = await prisma.newsroomItem.upsert({
    where: { sourceUrl: source_url },
    update: { status: status || 'DISCOVERED', articleId: article_id || null, verification: verification || undefined, rawData: raw_data || undefined },
    create: {
      sourceUrl:     source_url,
      sourceName:    source_name,
      sourceTitle:   source_title || null,
      contentHash:   content_hash || null,
      status:        status || 'DISCOVERED',
      category:      category || null,
      reviewRequired: !!review_required,
      articleId:     article_id || null,
      verification:  verification || null,
      rawData:       raw_data || null,
    },
  });
  res.status(201).json({ item });
});

// POST /api/newsroom/items/:id/approve — approve a pending item and publish its linked article
app.post('/api/newsroom/items/:id/approve', requireAuth, requireRole('ADMIN', 'EDITOR'), async (req, res) => {
  const id   = parseInt(req.params.id);
  const item = await prisma.newsroomItem.findUnique({ where: { id } });
  if (!item) return res.status(404).json({ error: 'Newsroom item not found.' });

  let articleStatus = null;
  if (item.articleId) {
    // Walk the article through the workflow to PUBLISHED
    const article = await prisma.article.findUnique({ where: { id: item.articleId } });
    if (article) {
      if (article.status === 'DRAFT') {
        await prisma.$transaction([
          prisma.article.update({ where: { id: item.articleId }, data: { status: 'SUBMITTED' } }),
          prisma.editorialAction.create({ data: { articleId: item.articleId, userId: req.user.id, action: 'SUBMITTED', note: 'Auto-submitted from AI Newsroom approval' } }),
        ]);
        await prisma.$transaction([
          prisma.article.update({ where: { id: item.articleId }, data: { status: 'IN_REVIEW' } }),
          prisma.editorialAction.create({ data: { articleId: item.articleId, userId: req.user.id, action: 'IN_REVIEW', note: 'AI Newsroom approval' } }),
        ]);
        await prisma.$transaction([
          prisma.article.update({ where: { id: item.articleId }, data: { status: 'APPROVED' } }),
          prisma.editorialAction.create({ data: { articleId: item.articleId, userId: req.user.id, action: 'APPROVED', note: 'AI Newsroom approval' } }),
        ]);
        await prisma.$transaction([
          prisma.article.update({ where: { id: item.articleId }, data: { status: 'PUBLISHED', publishedAt: new Date() } }),
          prisma.editorialAction.create({ data: { articleId: item.articleId, userId: req.user.id, action: 'PUBLISHED', note: 'Published from AI Newsroom' } }),
        ]);
        articleStatus = 'PUBLISHED';
      } else if (['SUBMITTED', 'IN_REVIEW', 'APPROVED'].includes(article.status)) {
        await prisma.$transaction([
          prisma.article.update({ where: { id: item.articleId }, data: { status: 'PUBLISHED', publishedAt: new Date() } }),
          prisma.editorialAction.create({ data: { articleId: item.articleId, userId: req.user.id, action: 'PUBLISHED', note: 'Published from AI Newsroom' } }),
        ]);
        articleStatus = 'PUBLISHED';
      } else {
        articleStatus = article.status;
      }
    }
  }

  const updated = await prisma.newsroomItem.update({
    where: { id },
    data: { status: 'PUBLISHED' },
    include: { article: { select: { id: true, slug: true, status: true } } },
  });
  res.json({ item: updated, articleStatus });
});

// POST /api/newsroom/items/:id/reject — reject a newsroom item
app.post('/api/newsroom/items/:id/reject', requireAuth, requireRole('ADMIN', 'EDITOR'), async (req, res) => {
  const id   = parseInt(req.params.id);
  const item = await prisma.newsroomItem.findUnique({ where: { id } });
  if (!item) return res.status(404).json({ error: 'Newsroom item not found.' });

  // Archive the linked article if it exists and is a draft
  if (item.articleId) {
    const article = await prisma.article.findUnique({ where: { id: item.articleId } });
    if (article && ['DRAFT', 'SUBMITTED'].includes(article.status)) {
      await prisma.$transaction([
        prisma.article.update({ where: { id: item.articleId }, data: { status: 'ARCHIVED' } }),
        prisma.editorialAction.create({ data: { articleId: item.articleId, userId: req.user.id, action: 'ARCHIVED', note: req.body?.note || 'Rejected from AI Newsroom' } }),
      ]);
    }
  }

  const updated = await prisma.newsroomItem.update({ where: { id }, data: { status: 'REJECTED' } });
  res.json({ item: updated });
});

// GET /api/newsroom/logs — retrieve recent in-memory newsroom logs for live admin dashboard
app.get('/api/newsroom/logs', requireAuth, requireRole('ADMIN', 'EDITOR'), (req, res) => {
  const logger = require('./newsroom/logger.js');
  res.json({ logs: logger.getRecentLogs() });
});

// POST /api/newsroom/run — manually trigger one newsroom scan cycle (ADMIN only)
app.post('/api/newsroom/run', requireAuth, requireRole('ADMIN'), async (req, res) => {
  const logger = require('./newsroom/logger.js');
  if (!newsroom) {
    logger.error('Manual run requested but AI Newsroom is not loaded.');
    return res.status(503).json({ error: 'AI Newsroom is not configured. Check server logs and environment variables.' });
  }
  logger.info(`Manual scan initiated from Admin UI by ${req.user.email}`);
  res.json({ ok: true, message: 'Newsroom scan started. Check server logs or live terminal below.' });
  newsroom.runNewsroom().catch((err) => logger.error('Manual run failed:', err.message));
});

// ---------------------------------------------------------------------
// Static frontend (single Render Web Service serves the Vue build)
// ---------------------------------------------------------------------
const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath, { maxAge: IS_PROD ? '1d' : 0 }));
app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(distPath, 'index.html')));

// ---------------------------------------------------------------------
// Error handling — never leak internals
// ---------------------------------------------------------------------
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: IS_PROD ? 'Something went wrong.' : err.message });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Jigawa Times server listening on port ${PORT} [${NODE_ENV}]`);
  // Start the AI Newsroom scheduler (no-op if NEWSROOM_INTERVAL_MINUTES is 0 or not set)
  if (newsroom) {
    newsroom.startScheduler();
  }
});
