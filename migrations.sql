-- =====================================================================
-- JIGAWA TIMES — MANUAL DATABASE MIGRATION + SEED SCRIPT
-- Run this entire file in the Neon SQL Editor (Neon Console > SQL Editor).
-- Render's free Web Service plan has no shell/SSH access after deploy,
-- so there is no way to run `prisma migrate deploy` interactively in
-- production. This script creates the full schema and seed data by
-- hand, in plain SQL, so you can paste-and-run it directly in Neon.
--
-- Safe to re-run: every statement is guarded with IF NOT EXISTS /
-- ON CONFLICT so running it twice will not duplicate data or error out.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. EXTENSIONS
-- ---------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------
-- 1. ENUM TYPES
-- ---------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'EDITOR', 'REPORTER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ArticleStatus" AS ENUM (
    'DRAFT', 'SUBMITTED', 'IN_REVIEW', 'REVISION_REQUIRED',
    'APPROVED', 'PUBLISHED', 'ARCHIVED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------
-- 2. TABLES
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "User" (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  "passwordHash" TEXT NOT NULL,
  role          "UserRole" NOT NULL DEFAULT 'REPORTER',
  bio           TEXT,
  avatar        TEXT,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "Category" (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  description TEXT,
  "order"     INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "Article" (
  id             SERIAL PRIMARY KEY,
  title          TEXT NOT NULL,
  slug           TEXT NOT NULL UNIQUE,
  excerpt        TEXT,
  content        TEXT NOT NULL,
  "featuredImage" TEXT,
  "imageCaption" TEXT,
  status         "ArticleStatus" NOT NULL DEFAULT 'DRAFT',
  "isBreaking"   BOOLEAN NOT NULL DEFAULT FALSE,
  "isFeatured"   BOOLEAN NOT NULL DEFAULT FALSE,
  "authorId"     INTEGER NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "categoryId"   INTEGER NOT NULL REFERENCES "Category"(id) ON DELETE RESTRICT,
  views          INTEGER NOT NULL DEFAULT 0,
  "publishedAt"  TIMESTAMPTZ,
  "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "Tag" (
  id   SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS "ArticleTag" (
  "articleId" INTEGER NOT NULL REFERENCES "Article"(id) ON DELETE CASCADE,
  "tagId"     INTEGER NOT NULL REFERENCES "Tag"(id) ON DELETE CASCADE,
  PRIMARY KEY ("articleId", "tagId")
);

CREATE TABLE IF NOT EXISTS "Comment" (
  id          SERIAL PRIMARY KEY,
  "articleId" INTEGER NOT NULL REFERENCES "Article"(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL,
  content     TEXT NOT NULL,
  approved    BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "EditorialAction" (
  id          SERIAL PRIMARY KEY,
  "articleId" INTEGER NOT NULL REFERENCES "Article"(id) ON DELETE CASCADE,
  "userId"    INTEGER NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  action      TEXT NOT NULL,
  note        TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "SiteSetting" (
  id          SERIAL PRIMARY KEY,
  key         TEXT NOT NULL UNIQUE,
  value       TEXT NOT NULL,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 3. INDEXES
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_article_status       ON "Article"(status);
CREATE INDEX IF NOT EXISTS idx_article_published_at ON "Article"("publishedAt");
CREATE INDEX IF NOT EXISTS idx_article_category      ON "Article"("categoryId");
CREATE INDEX IF NOT EXISTS idx_article_author        ON "Article"("authorId");
CREATE INDEX IF NOT EXISTS idx_article_views         ON "Article"(views);
CREATE INDEX IF NOT EXISTS idx_article_breaking      ON "Article"("isBreaking") WHERE "isBreaking" = TRUE;
CREATE INDEX IF NOT EXISTS idx_article_featured      ON "Article"("isFeatured") WHERE "isFeatured" = TRUE;
CREATE INDEX IF NOT EXISTS idx_comment_article        ON "Comment"("articleId");
CREATE INDEX IF NOT EXISTS idx_editorial_article       ON "EditorialAction"("articleId");
-- full-text search index (title + excerpt + content)
CREATE INDEX IF NOT EXISTS idx_article_search ON "Article"
  USING GIN (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(excerpt,'') || ' ' || coalesce(content,'')));

-- ---------------------------------------------------------------------
-- 4. SEED: USERS
-- Dev-only credentials. Password for ALL seeded accounts: DevPass123!
-- Hashes below are bcrypt(10) of that string — do NOT reuse in production.
-- Change these (or delete + recreate real accounts) before going live.
-- ---------------------------------------------------------------------
INSERT INTO "User" (name, email, "passwordHash", role, bio, active)
VALUES
  ('Admin User', 'admin@jigawatimes.ng',
   '$2b$10$w9HMFm7ivouOPFtmwgtCrO1Uik6ei1OUwB.w6WEWW9dueVJQe6X0y',
   'ADMIN', 'Platform administrator.', TRUE),
  ('Chief Editor', 'editor@jigawatimes.ng',
   '$2b$10$jDGmlZnXFfwl0tfdDv9rH.h9.ESI.3eU4CdSZrS6dvrL4MLR6Z8mu',
   'EDITOR', 'Newsroom editor overseeing the editorial queue.', TRUE),
  ('Amina Yusuf', 'amina.reporter@jigawatimes.ng',
   '$2b$10$gXjgW9c63AWLNwis5sJ2.eoKZFbyM6bwMgQuETU6UJpYzm9NgtAEK',
   'REPORTER', 'Reporter covering Buji and Jigawa State affairs.', TRUE),
  ('Ibrahim Sule', 'ibrahim.reporter@jigawatimes.ng',
   '$2b$10$hAoWyvqUeuSAY8Zsa52vxutR9dfuqS.TGHJemsoEgKkV9br2zjXFC',
   'REPORTER', 'Reporter covering governance and development.', TRUE)
ON CONFLICT (email) DO NOTHING;

-- ---------------------------------------------------------------------
-- 5. SEED: CATEGORIES
-- Consolidated to 6 top-level categories (down from an earlier 17) —
-- fewer, broader beats read better in navigation. Slugs kept stable
-- (buji, jigawa, politics, business, education, investigations) so
-- existing links and the homepage's category-filtered sections keep
-- working unchanged. Narrower topics (agriculture, security, sports,
-- community, opinion, world, etc.) now live as tags instead.
-- ---------------------------------------------------------------------
INSERT INTO "Category" (name, slug, description, "order") VALUES
  ('Buji',                     'buji',            'Local news from Buji Local Government Area.', 1),
  ('Jigawa',                   'jigawa',          'State-level news across Jigawa.', 2),
  ('Politics & Governance',    'politics',        'Political reporting, government accountability and public policy.', 3),
  ('Business & Development',   'business',        'Business, economy, infrastructure and development stories.', 4),
  ('Education & Health',       'education',       'Education and public health reporting.', 5),
  ('Investigations & Opinion', 'investigations',  'Investigative journalism, interviews and opinion pieces.', 6)
ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, "order" = EXCLUDED."order";

-- ---------------------------------------------------------------------
-- 5b. CLEANUP: consolidate the old 17-category set down to the 6 above.
-- Safe to run against a database that already has the old categories —
-- reassigns any articles filed under a retired category to the closest
-- surviving one, then removes the now-empty retired category rows. A
-- no-op on a fresh database (nothing to reassign or delete).
-- ---------------------------------------------------------------------
DO $$
DECLARE
  retired_to_new RECORD;
BEGIN
  FOR retired_to_new IN
    SELECT * FROM (VALUES
      ('nigeria', 'jigawa'), ('governance', 'politics'), ('development', 'business'),
      ('health', 'education'), ('agriculture', 'jigawa'), ('security', 'politics'),
      ('community', 'jigawa'), ('opinion', 'investigations'), ('interviews', 'investigations'),
      ('sports', 'jigawa'), ('world', 'jigawa')
    ) AS t(old_slug, new_slug)
  LOOP
    UPDATE "Article" SET "categoryId" = (SELECT id FROM "Category" WHERE slug = retired_to_new.new_slug)
    WHERE "categoryId" = (SELECT id FROM "Category" WHERE slug = retired_to_new.old_slug);

    DELETE FROM "Category" WHERE slug = retired_to_new.old_slug;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 6. SEED: TAGS
-- ---------------------------------------------------------------------
INSERT INTO "Tag" (name, slug) VALUES
  ('Local Government', 'local-government'),
  ('Elections', 'elections'),
  ('Youth', 'youth'),
  ('Infrastructure', 'infrastructure'),
  ('Accountability', 'accountability')
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------------
-- 7. SEED: SAMPLE ARTICLES
-- ---------------------------------------------------------------------
INSERT INTO "Article"
  (title, slug, excerpt, content, "featuredImage", "imageCaption", status,
   "isBreaking", "isFeatured", "authorId", "categoryId", views, "publishedAt")
SELECT
  'Buji LGA Commissions New Primary Healthcare Centre',
  'buji-lga-commissions-new-primary-healthcare-centre',
  'The newly built facility is expected to serve thousands of residents across surrounding wards.',
  '<p>The Buji Local Government Area has commissioned a new Primary Healthcare Centre aimed at improving access to basic medical services for residents.</p><p>Officials say the facility will reduce travel time for emergency care and expand maternal health services in the area.</p>',
  'https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d?w=1200',
  'The new Primary Healthcare Centre in Buji LGA.',
  'PUBLISHED', TRUE, TRUE,
  u.id, c.id, 142, now() - interval '2 days'
FROM "User" u, "Category" c
WHERE u.email = 'amina.reporter@jigawatimes.ng' AND c.slug = 'buji'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO "Article"
  (title, slug, excerpt, content, "featuredImage", "imageCaption", status,
   "isBreaking", "isFeatured", "authorId", "categoryId", views, "publishedAt")
SELECT
  'Jigawa State Government Announces Rural Road Rehabilitation Plan',
  'jigawa-rural-road-rehabilitation-plan',
  'The plan targets over 200km of feeder roads connecting farming communities to major markets.',
  '<p>The Jigawa State Government has unveiled a rural road rehabilitation plan intended to link agricultural communities with major trading centres across the state.</p><p>Officials say the project will be executed in phases, prioritising the most economically active corridors first.</p>',
  'https://images.unsplash.com/photo-1502920917128-1aa500764cbd?w=1200',
  'A rural feeder road earmarked for rehabilitation.',
  'PUBLISHED', FALSE, TRUE,
  u.id, c.id, 98, now() - interval '5 days'
FROM "User" u, "Category" c
WHERE u.email = 'ibrahim.reporter@jigawatimes.ng' AND c.slug = 'business'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO "Article"
  (title, slug, excerpt, content, "featuredImage", "imageCaption", status,
   "isBreaking", "isFeatured", "authorId", "categoryId", views, "publishedAt")
SELECT
  'Farmers in Jigawa Report Improved Yields After Extension Programme',
  'farmers-jigawa-improved-yields-extension-programme',
  'Agricultural extension officers say adoption of improved seed varieties is driving the gains.',
  '<p>Farmers across several districts in Jigawa State report improved crop yields this season, which agricultural officers attribute to a state-backed extension and training programme.</p><p>The programme has focused on drought-resistant seed varieties and improved irrigation practices.</p>',
  'https://images.unsplash.com/photo-1500937386664-56d1dfef3854?w=1200',
  'A farmer inspecting crops in rural Jigawa.',
  'PUBLISHED', FALSE, FALSE,
  u.id, c.id, 61, now() - interval '1 day'
FROM "User" u, "Category" c
WHERE u.email = 'amina.reporter@jigawatimes.ng' AND c.slug = 'jigawa'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO "Article"
  (title, slug, excerpt, content, "featuredImage", "imageCaption", status,
   "isBreaking", "isFeatured", "authorId", "categoryId", views)
SELECT
  'Draft: Investigation into Delayed Scholarship Payments',
  'draft-investigation-delayed-scholarship-payments',
  'An early-stage investigation into reported delays in state scholarship disbursement.',
  '<p>This is an in-progress investigative draft examining reports of delayed scholarship disbursements to Jigawa State students in tertiary institutions.</p>',
  NULL, NULL,
  'DRAFT', FALSE, FALSE,
  u.id, c.id, 0
FROM "User" u, "Category" c
WHERE u.email = 'ibrahim.reporter@jigawatimes.ng' AND c.slug = 'investigations'
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------------
-- 8. SEED: TAG LINKS
-- ---------------------------------------------------------------------
INSERT INTO "ArticleTag" ("articleId", "tagId")
SELECT a.id, t.id FROM "Article" a, "Tag" t
WHERE a.slug = 'buji-lga-commissions-new-primary-healthcare-centre' AND t.slug = 'local-government'
ON CONFLICT DO NOTHING;

INSERT INTO "ArticleTag" ("articleId", "tagId")
SELECT a.id, t.id FROM "Article" a, "Tag" t
WHERE a.slug = 'jigawa-rural-road-rehabilitation-plan' AND t.slug = 'infrastructure'
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------
-- 9. SEED: SAMPLE EDITORIAL ACTIONS
-- ---------------------------------------------------------------------
INSERT INTO "EditorialAction" ("articleId", "userId", action, note)
SELECT a.id, u.id, 'PUBLISHED', 'Approved and published after review.'
FROM "Article" a, "User" u
WHERE a.slug = 'buji-lga-commissions-new-primary-healthcare-centre' AND u.email = 'editor@jigawatimes.ng'
  AND NOT EXISTS (SELECT 1 FROM "EditorialAction" ea WHERE ea."articleId" = a.id AND ea.action = 'PUBLISHED');

INSERT INTO "EditorialAction" ("articleId", "userId", action, note)
SELECT a.id, u.id, 'PUBLISHED', 'Approved and published after review.'
FROM "Article" a, "User" u
WHERE a.slug = 'jigawa-rural-road-rehabilitation-plan' AND u.email = 'editor@jigawatimes.ng'
  AND NOT EXISTS (SELECT 1 FROM "EditorialAction" ea WHERE ea."articleId" = a.id AND ea.action = 'PUBLISHED');

-- ---------------------------------------------------------------------
-- 10. SEED: SITE SETTINGS
-- ---------------------------------------------------------------------
INSERT INTO "SiteSetting" (key, value) VALUES
  ('site_name', 'Jigawa Times'),
  ('site_tagline', 'Informing People, Demanding Accountability.'),
  ('contact_general_email', 'info@jigawatimes.ng'),
  ('contact_editorial_email', 'editorial@jigawatimes.ng'),
  ('contact_advertising_email', 'ads@jigawatimes.ng'),
  ('social_facebook', ''),
  ('social_x', ''),
  ('social_whatsapp', '')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------
-- 11. AI NEWSROOM: newsroom_items tracking table
-- Stores discovered source stories with their processing status.
-- The article_id column links back to the Article table once an article
-- is created. review_required flags stories that need human approval.
-- This is the ONLY new table introduced by the AI Newsroom feature.
-- All article data continues to live in the existing "Article" table.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "newsroom_items" (
  id               SERIAL PRIMARY KEY,
  source_url       TEXT NOT NULL UNIQUE,
  source_name      TEXT NOT NULL,
  source_title     TEXT,
  content_hash     TEXT,
  status           TEXT NOT NULL DEFAULT 'DISCOVERED',
  category         TEXT,
  review_required  BOOLEAN NOT NULL DEFAULT FALSE,
  article_id       INTEGER REFERENCES "Article"(id) ON DELETE SET NULL,
  verification     JSONB,
  raw_data         JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for fast status filtering and hash deduplication
CREATE INDEX IF NOT EXISTS idx_newsroom_status  ON "newsroom_items"(status);
CREATE INDEX IF NOT EXISTS idx_newsroom_hash    ON "newsroom_items"(content_hash);
CREATE INDEX IF NOT EXISTS idx_newsroom_article ON "newsroom_items"(article_id) WHERE article_id IS NOT NULL;

-- Auto-update updated_at on any row change
CREATE OR REPLACE FUNCTION update_newsroom_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  CREATE TRIGGER trg_newsroom_updated_at
  BEFORE UPDATE ON "newsroom_items"
  FOR EACH ROW EXECUTE FUNCTION update_newsroom_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------
-- 12. ENTERPRISE ENHANCEMENTS: ADS, REVISIONS, EDITORIAL NOTES,
--     LIVE UPDATES, READING STATS, SCHEDULED PUBLISHING
-- ---------------------------------------------------------------------
DO $$ BEGIN
  ALTER TYPE "ArticleStatus" ADD VALUE IF NOT EXISTS 'SCHEDULED';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "Article" ADD COLUMN IF NOT EXISTS "scheduled_publish_at" TIMESTAMPTZ;
ALTER TABLE "Article" ADD COLUMN IF NOT EXISTS "is_live" BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_article_scheduled ON "Article"("scheduled_publish_at");
CREATE INDEX IF NOT EXISTS idx_article_live ON "Article"("is_live");

CREATE TABLE IF NOT EXISTS "ads" (
  id            SERIAL PRIMARY KEY,
  title         TEXT NOT NULL,
  sponsor_name  TEXT NOT NULL,
  placement     TEXT NOT NULL,
  image_url     TEXT NOT NULL,
  target_url    TEXT NOT NULL,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  impressions   INTEGER NOT NULL DEFAULT 0,
  clicks        INTEGER NOT NULL DEFAULT 0,
  start_date    TIMESTAMPTZ,
  end_date      TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ads_placement_active ON "ads"(placement, active);

CREATE TABLE IF NOT EXISTS "article_revisions" (
  id          SERIAL PRIMARY KEY,
  article_id  INTEGER NOT NULL REFERENCES "Article"(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  excerpt     TEXT,
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_article_revisions_article ON "article_revisions"(article_id);

CREATE TABLE IF NOT EXISTS "editorial_comments" (
  id          SERIAL PRIMARY KEY,
  article_id  INTEGER NOT NULL REFERENCES "Article"(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  content     TEXT NOT NULL,
  resolved    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_editorial_comments_article ON "editorial_comments"(article_id);

CREATE TABLE IF NOT EXISTS "live_updates" (
  id           SERIAL PRIMARY KEY,
  article_id   INTEGER NOT NULL REFERENCES "Article"(id) ON DELETE CASCADE,
  author_id    INTEGER NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  title        TEXT,
  content      TEXT NOT NULL,
  is_pinned    BOOLEAN NOT NULL DEFAULT FALSE,
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_live_updates_article ON "live_updates"(article_id, published_at);

CREATE TABLE IF NOT EXISTS "article_reading_stats" (
  id          SERIAL PRIMARY KEY,
  article_id  INTEGER NOT NULL REFERENCES "Article"(id) ON DELETE CASCADE,
  milestone   INTEGER NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reading_stats_article ON "article_reading_stats"(article_id, milestone);

-- Seed default sponsored banners
INSERT INTO "ads" (title, sponsor_name, placement, image_url, target_url, active)
VALUES
  ('Empowering Jigawa Agriculture Initiative', 'Jigawa AgriTech', 'HEADER_LEADERBOARD', 'https://images.unsplash.com/photo-1595974482597-4b8da8879bc5?auto=format&fit=crop&w=1200&q=80', 'https://jigawa.gov.ng', TRUE),
  ('Northern Solar Clean Energy Grant', 'Northern Clean Power', 'IN_ARTICLE', 'https://images.unsplash.com/photo-1509391365360-2e959784a276?auto=format&fit=crop&w=1000&q=80', 'https://jigawa.gov.ng', TRUE),
  ('Dutse Digital Hub Training Fellowship', 'Dutse Tech Academy', 'SIDEBAR_STICKY', 'https://images.unsplash.com/photo-1531482615713-2afd69097998?auto=format&fit=crop&w=800&q=80', 'https://jigawa.gov.ng', TRUE)
ON CONFLICT DO NOTHING;

-- =====================================================================
-- DONE. Verify with:
--   SELECT role, count(*) FROM "User" GROUP BY role;
--   SELECT status, count(*) FROM "Article" GROUP BY status;
--   SELECT count(*) FROM "newsroom_items";
--   SELECT count(*) FROM "ads";
-- =====================================================================

