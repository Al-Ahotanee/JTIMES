import { defineComponent, ref, reactive, computed, onMounted, onUnmounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from './api.js';
import { store } from './store.js';
import { notify, confirmDialog } from './notifications.js';
import {
  ArticleCard, ArticleListRow, Pagination,
  ShareButtons, CommentsBlock, ImageUploader, NewsletterBox,
  DashSidebar, DashTopbar,
  timeAgo, readingTime,
} from './components.js';

// -----------------------------------------------------------------------
// Shared — State block (loading / error / empty)
// -----------------------------------------------------------------------
const StateBlock = defineComponent({
  props: { icon: { type: String, default: 'fa-solid fa-circle-info' }, title: String, body: String },
  template: `
    <div class="state-block">
      <div class="state-icon"><i :class="icon" aria-hidden="true"></i></div>
      <h2>{{ title }}</h2>
      <p v-if="body">{{ body }}</p>
    </div>
  `,
});

// -----------------------------------------------------------------------
// Dashboard shell — persistent sidebar + topbar layout
// -----------------------------------------------------------------------
const DashShell = defineComponent({
  props: { title: { type: String, default: 'Dashboard' }, links: Array },
  setup() {
    const route = useRoute();
    const mobileOpen = ref(false);
    // Close sidebar on route change
    watch(() => route.path, () => { mobileOpen.value = false; });
    return { mobileOpen, store };
  },
  template: `
    <div class="dash-frame">
      <!-- Mobile overlay -->
      <div class="sidebar-backdrop" v-show="mobileOpen" @click="mobileOpen=false" aria-hidden="true"></div>
      <!-- Sidebar -->
      <dash-sidebar :class="{ 'is-mobile-open': mobileOpen }" @close="mobileOpen=false" />
      <!-- Main -->
      <div class="dash-main-area">
        <dash-topbar :title="title" @toggle="mobileOpen=!mobileOpen" />
        <main class="dash-content">
          <slot />
        </main>
      </div>
    </div>
  `,
  components: { DashSidebar, DashTopbar },
});

const ADMIN_LINKS  = [['Overview', '/admin'], ['Articles', '/admin/articles'], ['Users', '/admin/users'], ['Categories', '/admin/categories'], ['Comments', '/admin/comments']];
const EDITOR_LINKS = [['Editorial Queue', '/editor'], ['Comments', '/editor/comments']];
const REPORTER_LINKS = [['My Stories', '/reporter'], ['New Story', '/reporter/new']];

// -----------------------------------------------------------------------
// PUBLIC PAGES
// -----------------------------------------------------------------------

// HOME (The Athletic Inspired Layout)
export const Home = defineComponent({
  setup() {
    const featured  = ref([]);
    const latest    = ref([]);
    const mostRead  = ref([]);
    const buji      = ref([]);
    const jigawa    = ref([]);
    const politics  = ref([]);
    const spotlight = ref(null);
    const loading   = ref(true);
    const error     = ref(false);

    onMounted(async () => {
      try {
        const [f, l, m, b, j, p] = await Promise.all([
          api.get('/api/articles?featured=true&pageSize=6').catch(() => ({ items: [] })),
          api.get('/api/articles?pageSize=12').catch(() => ({ items: [] })),
          api.get('/api/articles/most-read?window=week').catch(() => ({ items: [] })),
          api.get('/api/articles?category=buji&pageSize=3').catch(() => ({ items: [] })),
          api.get('/api/articles?category=jigawa&pageSize=3').catch(() => ({ items: [] })),
          api.get('/api/articles?category=politics&pageSize=3').catch(() => ({ items: [] })),
        ]);
        featured.value  = f.items || [];
        latest.value    = l.items || [];
        mostRead.value  = m.items || [];
        buji.value      = b.items || [];
        jigawa.value    = j.items || [];
        politics.value  = p.items || [];
        
        // Pick an investigative / deep dive spotlight story if available
        spotlight.value = featured.value.find(a => a.category?.slug === 'investigations') || featured.value[1] || latest.value[1];
      } catch {
        error.value = true;
      } finally {
        loading.value = false;
      }
    });

    const hero     = computed(() => featured.value[0] || latest.value[0]);
    const heroSide = computed(() => {
      const pool = featured.value.length >= 2 ? featured.value : latest.value;
      return pool.filter(a => a.id !== hero.value?.id).slice(0, 4);
    });

    return { featured, latest, mostRead, buji, jigawa, politics, spotlight, loading, error, hero, heroSide, timeAgo, readingTime };
  },
  template: `
    <!-- Loading -->
    <div v-if="loading" class="state-block" style="min-height:60vh;display:flex;align-items:center;justify-content:center;">
      <div>
        <div class="state-icon"><i class="fa-solid fa-newspaper" aria-hidden="true"></i></div>
        <p style="font-family:var(--font-sans);font-weight:500;letter-spacing:0.02em;">Loading Jigawa Times…</p>
      </div>
    </div>

    <!-- Error -->
    <div v-else-if="error || (!hero && !latest.length)" class="state-block container" style="min-height:60vh;display:flex;flex-direction:column;align-items:center;justify-content:center;">
      <div class="state-icon"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true" style="color:var(--accent);"></i></div>
      <h2 style="font-family:var(--font-display);font-size:1.6rem;">Unable to Load Stories</h2>
      <p>Our server is updating. Please refresh in a moment.</p>
      <button class="btn accent" @click="window.location.reload()"><i class="fa-solid fa-rotate" aria-hidden="true"></i> Reload</button>
    </div>

    <!-- Main Content -->
    <div v-else class="nyt-home">

      <!-- ════ HERO BROADSHEET ════ -->
      <div class="container nyt-hero">
        <div class="nyt-hero-grid" v-if="hero">
          <!-- Lead Story -->
          <div class="nyt-hero-lead">
            <router-link :to="'/news/'+hero.slug" class="nyt-hero-lead-media">
              <img v-if="hero.featuredImage" :src="hero.featuredImage" :alt="hero.imageCaption||hero.title" />
              <div v-else class="nyt-img-placeholder"><i class="fa-solid fa-newspaper" aria-hidden="true"></i></div>
            </router-link>
            <div class="nyt-hero-lead-kicker" v-if="hero.category?.name">{{ hero.category.name }}</div>
            <h1 class="nyt-hero-lead-headline"><router-link :to="'/news/'+hero.slug">{{ hero.title }}</router-link></h1>
            <p class="nyt-hero-lead-summary" v-if="hero.excerpt">{{ hero.excerpt }}</p>
            <div class="nyt-hero-lead-byline">
              <span class="nyt-author-name" v-if="hero.author?.name">By {{ hero.author.name }}</span>
              <span class="nyt-byline-sep">&bull;</span>
              <span class="nyt-time-text">{{ timeAgo(hero.publishedAt) }}</span>
              <span class="nyt-byline-sep">&bull;</span>
              <span class="nyt-time-text">{{ readingTime(hero.content) }} min read</span>
            </div>
          </div>

          <!-- Vertical Rule -->
          <div class="nyt-col-rule"></div>

          <!-- Secondary Stories -->
          <div class="nyt-hero-col">
            <div class="nyt-hero-story" v-for="(a, i) in heroSide" :key="a.id">
              <div class="nyt-hero-story-row">
                <div class="nyt-hero-story-text">
                  <div class="nyt-hero-story-kicker" v-if="a.category?.name">{{ a.category.name }}</div>
                  <h3 class="nyt-hero-story-headline"><router-link :to="'/news/'+a.slug">{{ a.title }}</router-link></h3>
                  <div class="nyt-hero-story-byline">
                    <span>{{ timeAgo(a.publishedAt) }}</span>
                    <span>&bull;</span>
                    <span>{{ readingTime(a.content) }}m read</span>
                  </div>
                </div>
                <img v-if="a.featuredImage" :src="a.featuredImage" :alt="a.title" class="nyt-hero-story-img" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ════ LATEST NEWS ════ -->
      <section class="nyt-section container" aria-labelledby="latest-head">
        <div class="nyt-section-header">
          <h2 class="nyt-section-label" id="latest-head">Latest News</h2>
        </div>
        <div class="nyt-stories-grid">
          <article-card v-for="a in latest.slice(0, 6)" :key="a.id" :article="a" />
        </div>
      </section>

      <!-- ════ MOST READ ════ -->
      <section class="nyt-section container" v-if="mostRead.length" aria-labelledby="mostread-head">
        <div class="nyt-section-header">
          <h2 class="nyt-section-label" id="mostread-head">Most Read This Week</h2>
        </div>
        <div class="nyt-ranked-list">
          <article-list-row v-for="(a, i) in mostRead.slice(0, 5)" :key="a.id" :article="a" :rank="i+1" />
        </div>
      </section>

      <!-- ════ INVESTIGATIVE SPOTLIGHT ════ -->
      <section class="nyt-spotlight" v-if="spotlight">
        <div class="container">
          <div class="nyt-spotlight-label"><i class="fa-solid fa-magnifying-glass-chart" aria-hidden="true"></i> Investigation</div>
          <div class="nyt-spotlight-grid">
            <div class="nyt-spotlight-text">
              <h2 class="nyt-spotlight-headline"><router-link :to="'/news/'+spotlight.slug">{{ spotlight.title }}</router-link></h2>
              <p class="nyt-spotlight-summary" v-if="spotlight.excerpt">{{ spotlight.excerpt }}</p>
              <div class="nyt-spotlight-byline">
                <span>By {{ spotlight.author?.name || 'Investigation Unit' }}</span>
                <span>&bull;</span>
                <span>{{ readingTime(spotlight.content) }} min read</span>
              </div>
              <router-link :to="'/news/'+spotlight.slug" class="btn accent">Read Full Investigation <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></router-link>
            </div>
            <div class="nyt-spotlight-media" v-if="spotlight.featuredImage">
              <img :src="spotlight.featuredImage" :alt="spotlight.title" />
            </div>
          </div>
        </div>
      </section>

      <!-- ════ BUJI LGA ════ -->
      <section class="nyt-section container" v-if="buji.length" aria-labelledby="buji-head">
        <div class="nyt-section-header">
          <h2 class="nyt-section-label" id="buji-head">Buji LGA</h2>
          <router-link to="/category/buji" class="nyt-section-more">More Coverage <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></router-link>
        </div>
        <div class="nyt-stories-grid"><article-card v-for="a in buji" :key="a.id" :article="a" /></div>
      </section>

      <!-- ════ JIGAWA STATE ════ -->
      <section class="nyt-section container" v-if="jigawa.length" aria-labelledby="jigawa-head">
        <div class="nyt-section-header">
          <h2 class="nyt-section-label" id="jigawa-head">Jigawa State</h2>
          <router-link to="/category/jigawa" class="nyt-section-more">More Coverage <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></router-link>
        </div>
        <div class="nyt-stories-grid"><article-card v-for="a in jigawa" :key="a.id" :article="a" /></div>
      </section>

      <!-- ════ POLITICS & GOVERNANCE ════ -->
      <section class="nyt-section container" v-if="politics.length" aria-labelledby="politics-head">
        <div class="nyt-section-header">
          <h2 class="nyt-section-label" id="politics-head">Politics &amp; Governance</h2>
          <router-link to="/category/politics" class="nyt-section-more">More Coverage <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></router-link>
        </div>
        <div class="nyt-stories-grid"><article-card v-for="a in politics" :key="a.id" :article="a" /></div>
      </section>

      <!-- ════ NEWSLETTER ════ -->
      <section class="container" style="padding:32px 0;">
        <newsletter-box></newsletter-box>
      </section>
    </div>
  `,
  components: { ArticleCard, ArticleListRow, NewsletterBox },
});

// ARTICLE PAGE (The Athletic Broadsheet Reading View)
export const ArticlePage = defineComponent({
  setup() {
    const route   = useRoute();
    const article = ref(null);
    const related = ref([]);
    const mostRead = ref([]);
    const error   = ref(false);

    const load = async () => {
      error.value = false; article.value = null;
      try {
        const res = await api.get(`/api/articles/${route.params.slug}`);
        article.value = res.article;
        
        // Fetch related & most-read with error resilience
        const [r, m] = await Promise.all([
          api.get(`/api/articles?category=${res.article.category?.slug}&pageSize=5`).catch(() => ({ items: [] })),
          api.get('/api/articles/most-read?window=week').catch(() => ({ items: [] })),
        ]);
        related.value  = (r.items || []).filter(x => x.slug !== res.article.slug).slice(0, 4);
        mostRead.value = (m.items || []).slice(0, 5);
      } catch { error.value = true; }
    };
    onMounted(load);
    watch(() => route.params.slug, load);

    return { article, related, mostRead, error, timeAgo, readingTime };
  },
  template: `
    <div v-if="error" class="state-block container" style="min-height:60vh;display:flex;flex-direction:column;align-items:center;justify-content:center;">
      <div class="state-icon"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true" style="color:var(--accent);"></i></div>
      <h2 style="font-family:var(--font-serif);font-size:2rem;">Report Unavailable</h2>
      <p>This article may have been archived, updated, or the link is temporary unavailable.</p>
      <router-link class="btn accent" to="/"><i class="fa-solid fa-house" aria-hidden="true"></i> Return to Homepage</router-link>
    </div>

    <article v-else-if="article" class="athletic-article-view">
      <!-- Article Header -->
      <div class="container article-head athletic-article-head">
        <div class="eyebrow-row" style="margin-bottom:var(--s4);">
          <span class="cat-pill"><router-link :to="'/category/'+article.category?.slug" style="color:inherit;">{{ article.category?.name }}</router-link></span>
          <span class="read-chip"><i class="fa-solid fa-book-open" aria-hidden="true"></i> {{ readingTime(article.content) }} min read</span>
        </div>
        <h1>{{ article.title }}</h1>
        <p class="article-dek" v-if="article.excerpt">{{ article.excerpt }}</p>
        
        <div class="article-author-bar">
          <div class="author-chip-lg">
            <img v-if="article.author?.avatar" :src="article.author.avatar" :alt="article.author.name" class="author-img" />
            <span v-else class="author-avatar-chip">{{ article.author?.name?.[0] }}</span>
            <div>
              <div class="author-name"><router-link :to="'/author/'+article.author?.id">{{ article.author?.name }}</router-link></div>
              <div class="author-role">{{ article.author?.role || 'Staff Reporter' }}</div>
            </div>
          </div>
          <div class="article-meta-right">
            <span><i class="fa-regular fa-clock" aria-hidden="true"></i> {{ timeAgo(article.publishedAt) }}</span>
            <span>&bull;</span>
            <span><i class="fa-regular fa-eye" aria-hidden="true"></i> {{ article.views?.toLocaleString() || 0 }} reads</span>
          </div>
        </div>
      </div>

      <!-- Featured Hero Image -->
      <figure class="container article-figure athletic-article-figure" v-if="article.featuredImage">
        <img :src="article.featuredImage" :alt="article.imageCaption||article.title" />
        <figcaption v-if="article.imageCaption"><i class="fa-solid fa-camera" aria-hidden="true" style="margin-right:6px;color:var(--accent);"></i> {{ article.imageCaption }}</figcaption>
      </figure>

      <!-- Article Reading Content + Sticky Sidebar -->
      <div class="container article-body-wrap athletic-article-layout">
        <!-- Main Reading Column -->
        <div class="article-col">
          <div class="article-body athletic-prose" v-html="article.content"></div>

          <div class="tags-row" v-if="article.tags?.length" aria-label="Article tags">
            <span class="tags-label"><i class="fa-solid fa-tags" aria-hidden="true"></i> Topics:</span>
            <router-link v-for="t in article.tags" :key="t.id" class="tag-pill" :to="'/search?q='+t.name">
              #{{ t.name }}
            </router-link>
          </div>

          <share-buttons :title="article.title" />
          <comments-block :slug="article.slug" :article-id="article.id" />
        </div>

        <!-- Sidebar -->
        <aside class="article-aside athletic-aside" aria-label="Related content">
          <div class="sidebar-block athletic-sidebar-block" v-if="mostRead.length">
            <div class="sidebar-block-title"><i class="fa-solid fa-fire" aria-hidden="true" style="color:var(--accent);"></i> Most Read</div>
            <article-list-row v-for="(a, i) in mostRead" :key="a.id" :article="a" :rank="i+1" />
          </div>

          <div class="sidebar-block athletic-sidebar-block" v-if="related.length">
            <div class="sidebar-block-title"><i class="fa-solid fa-newspaper" aria-hidden="true" style="color:var(--accent);"></i> Related Coverage</div>
            <article-list-row v-for="a in related" :key="a.id" :article="a" />
          </div>

          <!-- Sidebar Newsletter Box -->
          <newsletter-box></newsletter-box>
        </aside>
      </div>
    </article>

    <div v-else class="state-block" style="min-height:60vh;">
      <div class="state-icon"><i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i></div>
      <p>Loading report…</p>
    </div>
  `,
  components: { ArticleListRow, ShareButtons, CommentsBlock, NewsletterBox },
});

// CATEGORY PAGE
export const CategoryPage = defineComponent({
  setup() {
    const route      = useRoute();
    const items      = ref([]);
    const page       = ref(1);
    const totalPages = ref(1);
    const loading    = ref(true);
    const catName    = computed(() => store.categories.find(c => c.slug === route.params.slug)?.name || route.params.slug);

    const load = async () => {
      loading.value = true;
      try {
        const r = await api.get(`/api/articles?category=${route.params.slug}&page=${page.value}`);
        items.value = r.items; totalPages.value = r.totalPages;
      } finally { loading.value = false; }
    };
    onMounted(load);
    watch(() => [route.params.slug, page.value], load);

    return { items, page, totalPages, loading, catName };
  },
  template: `
    <div class="container section" style="border-top:none;padding-top:var(--s8);">
      <div class="section-head">
        <h2>{{ catName }}</h2>
      </div>
      <div v-if="loading" class="state-block">
        <div class="state-icon"><i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i></div>
        <p>Loading&hellip;</p>
      </div>
      <div v-else-if="!items.length" class="state-block">
        <div class="state-icon"><i class="fa-regular fa-folder-open" aria-hidden="true"></i></div>
        <h2>No stories yet</h2>
        <p>Check back soon for coverage in this category.</p>
      </div>
      <div v-else>
        <div class="card-grid">
          <article-card v-for="a in items" :key="a.id" :article="a" />
        </div>
        <pagination :page="page" :total-pages="totalPages" @change="p => page = p" />
      </div>
    </div>
  `,
  components: { ArticleCard, Pagination },
});

// SEARCH PAGE
export const SearchPage = defineComponent({
  setup() {
    const route    = useRoute();
    const router   = useRouter();
    const q        = ref(route.query.q || '');
    const items    = ref([]);
    const loading  = ref(false);
    const searched = ref(false);

    const run = async () => {
      if (!q.value.trim()) return;
      loading.value = true; searched.value = true;
      try {
        const r = await api.get(`/api/search?q=${encodeURIComponent(q.value)}`);
        items.value = r.items;
      } finally { loading.value = false; }
    };
    onMounted(() => { if (q.value) run(); });
    watch(() => route.query.q, (nq) => { q.value = nq || ''; if (nq) run(); });

    const submit = () => router.push({ path: '/search', query: { q: q.value } });
    return { q, items, loading, searched, submit };
  },
  template: `
    <div class="container" style="padding-top:var(--s8);padding-bottom:var(--s12);">
      <h1 style="font-size:var(--text-2xl);margin-bottom:var(--s6);">Search</h1>
      <form @submit.prevent="submit" style="display:flex;gap:var(--s3);max-width:560px;margin-bottom:var(--s8);">
        <div style="flex:1;position:relative;">
          <i class="fa-solid fa-magnifying-glass" aria-hidden="true" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--ink-4);font-size:13px;"></i>
          <input v-model="q" type="search" placeholder="Search stories, topics, tags\u2026" style="padding-left:36px;" aria-label="Search" />
        </div>
        <button class="btn" type="submit"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i> Search</button>
      </form>

      <p v-if="searched && !loading" class="muted" style="margin-bottom:var(--s6);font-size:var(--text-sm);">
        <i class="fa-solid fa-circle-info" aria-hidden="true"></i>
        {{ items.length }} result{{ items.length !== 1 ? 's' : '' }} for &ldquo;{{ q }}&rdquo;
      </p>
      <div v-if="loading" class="state-block">
        <div class="state-icon"><i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i></div>
        <p>Searching&hellip;</p>
      </div>
      <div v-else-if="searched && !items.length" class="state-block">
        <div class="state-icon"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i></div>
        <h2>No results found</h2>
        <p>Try a different keyword or check your spelling.</p>
      </div>
      <div v-else-if="items.length" class="card-grid">
        <article-card v-for="a in items" :key="a.id" :article="a" />
      </div>
    </div>
  `,
  components: { ArticleCard },
});

// AUTHOR PAGE
export const AuthorPage = defineComponent({
  setup() {
    const route    = useRoute();
    const author   = ref(null);
    const articles = ref([]);
    onMounted(async () => {
      try {
        const r = await api.get(`/api/authors/${route.params.id}`);
        author.value = r.author; articles.value = r.articles;
      } catch { /* silently fail */ }
    });
    return { author, articles };
  },
  template: `
    <div class="container" style="padding:var(--s8) var(--s5) var(--s12);" v-if="author">
      <!-- Author profile -->
      <div style="display:flex;gap:var(--s6);align-items:flex-start;margin-bottom:var(--s8);padding-bottom:var(--s8);border-bottom:3px solid var(--ink);">
        <img v-if="author.avatar" :src="author.avatar" :alt="author.name"
          style="width:88px;height:88px;border-radius:50%;object-fit:cover;border:3px solid var(--line);flex-shrink:0;" />
        <div v-else style="width:88px;height:88px;border-radius:50%;background:var(--brand);display:flex;align-items:center;justify-content:center;font-family:var(--font-serif);font-size:2.2rem;font-weight:700;color:var(--accent);flex-shrink:0;">
          {{ author.name?.[0] }}
        </div>
        <div>
          <h1 style="font-size:var(--text-2xl);margin-bottom:var(--s2);">{{ author.name }}</h1>
          <p class="muted" style="max-width:52ch;line-height:1.6;margin-bottom:var(--s3);">{{ author.bio || 'Reporter at Jigawa Times.' }}</p>
          <div class="byline">
            <i class="fa-solid fa-newspaper" aria-hidden="true"></i>
            <span>{{ articles.length }} published article{{ articles.length !== 1 ? 's' : '' }}</span>
          </div>
        </div>
      </div>
      <div class="card-grid">
        <article-card v-for="a in articles" :key="a.id" :article="a" />
      </div>
      <div v-if="!articles.length" class="state-block">
        <div class="state-icon"><i class="fa-regular fa-newspaper" aria-hidden="true"></i></div>
        <p>No published articles yet.</p>
      </div>
    </div>
    <div v-else class="state-block" style="min-height:60vh;">
      <div class="state-icon"><i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i></div>
      <p>Loading author&hellip;</p>
    </div>
  `,
  components: { ArticleCard },
});

// Static editorial pages
const editorialPage = (h1, sections) => defineComponent({
  template: `
    <div class="container" style="max-width:var(--measure);padding:var(--s8) var(--s5) var(--s12);">
      ${h1}
      ${sections}
    </div>
  `,
});

export const AboutPage = editorialPage(
  `<h1 style="font-size:var(--text-2xl);margin-bottom:var(--s6);padding-bottom:var(--s5);border-bottom:3px solid var(--ink);">About Jigawa Times</h1>`,
  `<p style="font-size:var(--text-md);line-height:1.75;margin-bottom:var(--s5);">Jigawa Times is an independent digital newsroom covering Buji Local Government Area, Jigawa State and Nigeria &mdash; with a focus on governance, public accountability and community development.</p>
   <h2 style="margin-top:var(--s8);margin-bottom:var(--s3);">Mission</h2>
   <p style="line-height:1.75;margin-bottom:var(--s5);">To inform residents with accurate, fair reporting and to hold public institutions accountable to the communities they serve.</p>
   <h2 style="margin-top:var(--s8);margin-bottom:var(--s3);">Editorial Values</h2>
   <p style="line-height:1.75;margin-bottom:var(--s5);">We report facts as we verify them, correct our errors openly, and separate news reporting from opinion.</p>
   <h2 style="margin-top:var(--s8);margin-bottom:var(--s3);">Coverage Area</h2>
   <p style="line-height:1.75;margin-bottom:var(--s5);">Our primary coverage area is Buji LGA and Jigawa State, with national context where it affects our readers.</p>
   <h2 style="margin-top:var(--s8);margin-bottom:var(--s3);">Commitment to Accuracy</h2>
   <p style="line-height:1.75;">Every story is reviewed by an editor before publication. Readers can request corrections through our contact page.</p>`
);

export const ContactPage = defineComponent({
  setup() { return { settings: store.settings }; },
  template: `
    <div class="container" style="max-width:var(--measure);padding:var(--s8) var(--s5) var(--s12);">
      <h1 style="font-size:var(--text-2xl);margin-bottom:var(--s6);padding-bottom:var(--s5);border-bottom:3px solid var(--ink);">Contact Jigawa Times</h1>
      <div style="display:grid;gap:var(--s5);">
        <div style="background:var(--bg-2);border:1px solid var(--line);border-radius:var(--radius-lg);padding:var(--s5) var(--s6);">
          <div style="display:flex;align-items:center;gap:var(--s3);margin-bottom:var(--s2);">
            <div style="width:36px;height:36px;background:var(--accent-bg);border-radius:var(--radius);display:flex;align-items:center;justify-content:center;color:var(--accent);"><i class="fa-solid fa-envelope" aria-hidden="true"></i></div>
            <h3 style="font-family:var(--font-sans);font-size:var(--text-base);font-weight:700;">General Enquiries</h3>
          </div>
          <a :href="'mailto:'+(settings.contact_general_email||'info@jigawatimes.ng')" style="color:var(--brand);text-decoration:underline;">{{ settings.contact_general_email || 'info@jigawatimes.ng' }}</a>
        </div>
        <div style="background:var(--bg-2);border:1px solid var(--line);border-radius:var(--radius-lg);padding:var(--s5) var(--s6);">
          <div style="display:flex;align-items:center;gap:var(--s3);margin-bottom:var(--s2);">
            <div style="width:36px;height:36px;background:var(--red-bg);border-radius:var(--radius);display:flex;align-items:center;justify-content:center;color:var(--red);"><i class="fa-solid fa-bell-concierge" aria-hidden="true"></i></div>
            <h3 style="font-family:var(--font-sans);font-size:var(--text-base);font-weight:700;">News Tips &amp; Editorial</h3>
          </div>
          <a :href="'mailto:'+(settings.contact_editorial_email||'editorial@jigawatimes.ng')" style="color:var(--brand);text-decoration:underline;">{{ settings.contact_editorial_email || 'editorial@jigawatimes.ng' }}</a>
        </div>
        <div style="background:var(--bg-2);border:1px solid var(--line);border-radius:var(--radius-lg);padding:var(--s5) var(--s6);">
          <div style="display:flex;align-items:center;gap:var(--s3);margin-bottom:var(--s2);">
            <div style="width:36px;height:36px;background:var(--green-bg);border-radius:var(--radius);display:flex;align-items:center;justify-content:center;color:var(--green);"><i class="fa-solid fa-chart-line" aria-hidden="true"></i></div>
            <h3 style="font-family:var(--font-sans);font-size:var(--text-base);font-weight:700;">Advertising</h3>
          </div>
          <a :href="'mailto:'+(settings.contact_advertising_email||'ads@jigawatimes.ng')" style="color:var(--brand);text-decoration:underline;">{{ settings.contact_advertising_email || 'ads@jigawatimes.ng' }}</a>
        </div>
      </div>
    </div>
  `,
});

export const EditorialPolicyPage = editorialPage(
  `<h1 style="font-size:var(--text-2xl);margin-bottom:var(--s6);padding-bottom:var(--s5);border-bottom:3px solid var(--ink);">Editorial Policy</h1>`,
  `<div style="display:grid;gap:var(--s5);">
    <div><h2 style="font-size:var(--text-lg);margin-bottom:var(--s2);">Accuracy</h2><p style="line-height:1.75;color:var(--ink-2);">We verify facts before publication and correct errors transparently, with a visible note on the article.</p></div>
    <div><h2 style="font-size:var(--text-lg);margin-bottom:var(--s2);">Fairness &amp; Right of Reply</h2><p style="line-height:1.75;color:var(--ink-2);">Subjects of critical reporting are given a genuine opportunity to respond before publication.</p></div>
    <div><h2 style="font-size:var(--text-lg);margin-bottom:var(--s2);">Source Protection</h2><p style="line-height:1.75;color:var(--ink-2);">We protect the identity of confidential sources where safety or public interest requires it.</p></div>
    <div><h2 style="font-size:var(--text-lg);margin-bottom:var(--s2);">Conflict of Interest</h2><p style="line-height:1.75;color:var(--ink-2);">Reporters disclose conflicts of interest to editors before publication.</p></div>
    <div><h2 style="font-size:var(--text-lg);margin-bottom:var(--s2);">Independence</h2><p style="line-height:1.75;color:var(--ink-2);">Our newsroom operates independently of political and commercial pressure.</p></div>
  </div>`
);

export const PrivacyPage = editorialPage(
  `<h1 style="font-size:var(--text-2xl);margin-bottom:var(--s6);padding-bottom:var(--s5);border-bottom:3px solid var(--ink);">Privacy Policy</h1>`,
  `<p style="line-height:1.75;color:var(--ink-2);">We collect only the information needed to operate this website, such as comment submissions and newsletter sign-ups. We do not sell reader data to third parties. Comment submissions are subject to moderation before appearing publicly.</p>`
);

export const TermsPage = editorialPage(
  `<h1 style="font-size:var(--text-2xl);margin-bottom:var(--s6);padding-bottom:var(--s5);border-bottom:3px solid var(--ink);">Terms of Use</h1>`,
  `<p style="line-height:1.75;color:var(--ink-2);">Content on Jigawa Times is for personal, non-commercial use. Reproduction of full articles requires permission from the editors; brief quotation with attribution and a link back is welcome.</p>`
);

// LOGIN PAGE
export const LoginPage = defineComponent({
  setup() {
    const router   = useRouter();
    const route    = useRoute();
    const email    = ref('');
    const password = ref('');
    const error    = ref('');
    const loading  = ref(false);
    const submit   = async () => {
      error.value = ''; loading.value = true;
      try {
        const user = await store.login(email.value, password.value);
        const dest = route.query.redirect || (user.role === 'REPORTER' ? '/reporter' : user.role === 'EDITOR' ? '/editor' : '/admin');
        router.push(dest);
      } catch (e) { error.value = e.message || 'Invalid credentials.'; }
      finally { loading.value = false; }
    };
    return { email, password, error, loading, submit };
  },
  template: `
    <div class="auth-wrap">
      <div class="auth-card">
        <div class="auth-card-head">
          <div class="auth-logo" aria-hidden="true">JT</div>
          <h1>Staff Login</h1>
          <p>Jigawa Times Newsroom</p>
        </div>
        <div class="auth-card-body">
          <div v-if="error" class="auth-error" role="alert">
            <i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i>
            {{ error }}
          </div>
          <form @submit.prevent="submit">
            <div class="field">
              <label for="login-email"><i class="fa-regular fa-envelope" aria-hidden="true" style="margin-right:4px;"></i> Email address</label>
              <input id="login-email" type="email" v-model="email" required autocomplete="email" placeholder="you@jigawatimes.ng" />
            </div>
            <div class="field">
              <label for="login-pw"><i class="fa-solid fa-lock" aria-hidden="true" style="margin-right:4px;"></i> Password</label>
              <input id="login-pw" type="password" v-model="password" required autocomplete="current-password" placeholder="••••••••" />
            </div>
            <button class="btn accent" type="submit" :disabled="loading" style="width:100%;justify-content:center;padding:12px;">
              <i :class="loading ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-arrow-right-to-bracket'" aria-hidden="true"></i>
              {{ loading ? 'Signing in…' : 'Sign in to Newsroom' }}
            </button>
          </form>
        </div>
      </div>
    </div>
  `,
});

// NOT FOUND
export const NotFound = defineComponent({
  template: `
    <div class="state-block" style="min-height:70vh;display:flex;flex-direction:column;align-items:center;justify-content:center;">
      <div class="state-icon" style="font-size:5rem;opacity:.1;"><i class="fa-solid fa-map-pin" aria-hidden="true"></i></div>
      <h2 style="font-size:var(--text-2xl);">Page not found</h2>
      <p>The page you&rsquo;re looking for doesn&rsquo;t exist or has been moved.</p>
      <router-link class="btn accent" to="/"><i class="fa-solid fa-house" aria-hidden="true"></i> Back to homepage</router-link>
    </div>
  `,
});

// -----------------------------------------------------------------------
// ADMIN DASHBOARD
// -----------------------------------------------------------------------

export const AdminOverview = defineComponent({
  setup() {
    const stats = ref(null);
    onMounted(async () => { try { stats.value = await api.get('/api/admin/stats'); } catch { stats.value = null; } });
    return { stats, timeAgo };
  },
  template: `
    <dash-shell title="Newsroom Overview">
      <div v-if="!stats" class="state-block">
        <div class="state-icon"><i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i></div>
        <p>Loading stats&hellip;</p>
      </div>
      <template v-else>
        <!-- Stat cards -->
        <div class="stat-grid">
          <div class="stat-card">
            <div class="stat-card-top">
              <div class="stat-icon brand"><i class="fa-solid fa-newspaper" aria-hidden="true"></i></div>
            </div>
            <div class="stat-num">{{ stats.totalArticles?.toLocaleString() }}</div>
            <div class="stat-label">Total Articles</div>
          </div>
          <div class="stat-card">
            <div class="stat-card-top">
              <div class="stat-icon green"><i class="fa-solid fa-circle-check" aria-hidden="true"></i></div>
            </div>
            <div class="stat-num">{{ stats.published?.toLocaleString() }}</div>
            <div class="stat-label">Published</div>
          </div>
          <div class="stat-card">
            <div class="stat-card-top">
              <div class="stat-icon amber"><i class="fa-solid fa-hourglass-half" aria-hidden="true"></i></div>
            </div>
            <div class="stat-num">{{ stats.pendingReview?.toLocaleString() }}</div>
            <div class="stat-label">Pending Review</div>
          </div>
          <div class="stat-card">
            <div class="stat-card-top">
              <div class="stat-icon red"><i class="fa-solid fa-rotate-left" aria-hidden="true"></i></div>
            </div>
            <div class="stat-num">{{ stats.revisionRequired?.toLocaleString() }}</div>
            <div class="stat-label">Revision Requested</div>
          </div>
          <div class="stat-card">
            <div class="stat-card-top">
              <div class="stat-icon accent"><i class="fa-solid fa-pen-to-square" aria-hidden="true"></i></div>
            </div>
            <div class="stat-num">{{ stats.drafts?.toLocaleString() }}</div>
            <div class="stat-label">Drafts</div>
          </div>
          <div class="stat-card">
            <div class="stat-card-top">
              <div class="stat-icon blue"><i class="fa-solid fa-users" aria-hidden="true"></i></div>
            </div>
            <div class="stat-num">{{ stats.totalReporters?.toLocaleString() }}</div>
            <div class="stat-label">Reporters</div>
          </div>
          <div class="stat-card">
            <div class="stat-card-top">
              <div class="stat-icon violet"><i class="fa-solid fa-eye" aria-hidden="true"></i></div>
            </div>
            <div class="stat-num">{{ stats.totalViews?.toLocaleString() }}</div>
            <div class="stat-label">Total Views</div>
          </div>
          <div class="stat-card">
            <div class="stat-card-top">
              <div class="stat-icon brand"><i class="fa-solid fa-comments" aria-hidden="true"></i></div>
            </div>
            <div class="stat-num">{{ stats.commentsAwaitingModeration?.toLocaleString() }}</div>
            <div class="stat-label">Comments Pending</div>
          </div>
        </div>

        <!-- Recent activity -->
        <div class="table-section-title"><i class="fa-solid fa-clock-rotate-left" aria-hidden="true" style="margin-right:6px;"></i>Recent Activity</div>
        <div class="table-wrap">
          <table aria-label="Recent article activity">
            <thead>
              <tr>
                <th>Title</th>
                <th>Status</th>
                <th>Author</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="a in stats.recentArticles" :key="a.id">
                <td class="td-title"><router-link :to="'/reporter/edit/'+a.id">{{ a.title }}</router-link></td>
                <td><span :class="'badge status-'+a.status">{{ a.status.replace(/_/g,' ') }}</span></td>
                <td>{{ a.author?.name }}</td>
                <td class="muted" style="white-space:nowrap;font-size:var(--text-xs);">{{ timeAgo(a.updatedAt) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </dash-shell>
  `,
  components: { DashShell },
});

// USER FORM (inline sub-component, not exported)
const UserForm = defineComponent({
  props: { onSaved: Function },
  setup(props) {
    const form    = reactive({ name: '', email: '', password: '', role: 'REPORTER', bio: '' });
    const error   = ref('');
    const loading = ref(false);
    const submit  = async () => {
      error.value = ''; loading.value = true;
      try {
        await api.post('/api/users', { ...form });
        Object.assign(form, { name: '', email: '', password: '', role: 'REPORTER', bio: '' });
        props.onSaved();
      } catch (e) { error.value = e.message; }
      finally { loading.value = false; }
    };
    return { form, error, loading, submit };
  },
  template: `
    <form @submit.prevent="submit" style="margin-bottom:var(--s6);">
      <div class="form-card">
        <div class="form-card-head">
          <h3><i class="fa-solid fa-user-plus" aria-hidden="true" style="margin-right:6px;color:var(--accent);"></i>Create New User</h3>
        </div>
        <div class="form-card-body">
          <div class="form-two-col">
            <div class="field"><label for="uf-name">Full Name</label><input id="uf-name" v-model="form.name" required placeholder="e.g. Amina Ibrahim" /></div>
            <div class="field"><label for="uf-email">Email Address</label><input id="uf-email" type="email" v-model="form.email" required placeholder="amina@jigawatimes.ng" /></div>
            <div class="field"><label for="uf-pw">Temporary Password</label><input id="uf-pw" type="password" v-model="form.password" required minlength="8" placeholder="Min. 8 characters" /></div>
            <div class="field"><label for="uf-role">Role</label>
              <select id="uf-role" v-model="form.role">
                <option value="REPORTER">Reporter</option>
                <option value="EDITOR">Editor</option>
                <option value="ADMIN">Admin</option>
              </select>
            </div>
          </div>
          <div v-if="error" class="form-error"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> {{ error }}</div>
          <div class="form-actions">
            <button class="btn accent" type="submit" :disabled="loading">
              <i :class="loading ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-user-plus'" aria-hidden="true"></i>
              {{ loading ? 'Creating\u2026' : 'Create User' }}
            </button>
          </div>
        </div>
      </div>
    </form>
  `,
});

export const AdminUsers = defineComponent({
  setup() {
    const users = ref([]);
    const load = async () => { users.value = (await api.get('/api/users')).items; };
    onMounted(load);
    const toggleActive = async (u) => { await api.put(`/api/users/${u.id}`, { active: !u.active }); load(); };
    return { users, load, toggleActive };
  },
  template: `
    <dash-shell title="Manage Users">
      <user-form :on-saved="load" />
      <div class="table-wrap">
        <table aria-label="Staff users">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!users.length">
              <td colspan="5" class="table-empty"><i class="fa-solid fa-users" aria-hidden="true"></i><br>No users found.</td>
            </tr>
            <tr v-for="u in users" :key="u.id">
              <td style="font-weight:600;color:var(--ink);">
                <div style="display:flex;align-items:center;gap:var(--s3);">
                  <div style="width:32px;height:32px;border-radius:50%;background:var(--brand);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:var(--text-sm);color:var(--accent);flex-shrink:0;" aria-hidden="true">{{ u.name?.[0] }}</div>
                  {{ u.name }}
                </div>
              </td>
              <td class="muted">{{ u.email }}</td>
              <td><span :class="'role-badge '+u.role">{{ u.role }}</span></td>
              <td>
                <span v-if="u.active" style="color:var(--green);font-size:var(--text-xs);font-weight:700;"><i class="fa-solid fa-circle-check" aria-hidden="true"></i> Active</span>
                <span v-else style="color:var(--ink-4);font-size:var(--text-xs);font-weight:700;"><i class="fa-solid fa-circle-xmark" aria-hidden="true"></i> Disabled</span>
              </td>
              <td>
                <div class="action-btns">
                  <button :class="u.active ? 'icon-btn danger' : 'icon-btn success'" @click="toggleActive(u)" :title="u.active ? 'Disable user' : 'Enable user'" :aria-label="u.active ? 'Disable '+u.name : 'Enable '+u.name">
                    <i :class="u.active ? 'fa-solid fa-ban' : 'fa-solid fa-circle-check'" aria-hidden="true"></i>
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </dash-shell>
  `,
  components: { DashShell, UserForm },
});

// CATEGORY FORM
const CategoryForm = defineComponent({
  props: { onSaved: Function },
  setup(props) {
    const name = ref(''); const description = ref(''); const loading = ref(false);
    const submit = async () => {
      loading.value = true;
      try { await api.post('/api/categories', { name: name.value, description: description.value }); name.value = ''; description.value = ''; props.onSaved(); }
      finally { loading.value = false; }
    };
    return { name, description, loading, submit };
  },
  template: `
    <form @submit.prevent="submit" style="margin-bottom:var(--s6);">
      <div class="form-card">
        <div class="form-card-head">
          <h3><i class="fa-solid fa-tag" aria-hidden="true" style="margin-right:6px;color:var(--accent);"></i>New Category</h3>
        </div>
        <div class="form-card-body">
          <div class="form-two-col">
            <div class="field"><label for="cat-name">Category Name</label><input id="cat-name" v-model="name" required placeholder="e.g. Sports" /></div>
            <div class="field"><label for="cat-desc">Description <span style="font-weight:400;color:var(--ink-4);">(optional)</span></label><input id="cat-desc" v-model="description" placeholder="Brief description" /></div>
          </div>
          <div class="form-actions">
            <button class="btn accent" type="submit" :disabled="loading">
              <i :class="loading ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-plus'" aria-hidden="true"></i>
              {{ loading ? 'Saving\u2026' : 'Add Category' }}
            </button>
          </div>
        </div>
      </div>
    </form>
  `,
});

export const AdminCategories = defineComponent({
  setup() {
    const items = ref([]);
    const load = async () => { items.value = (await api.get('/api/categories')).items; };
    onMounted(load);
    const remove = async (c) => {
      confirmDialog({
        header: 'Delete Category',
        message: `Delete category "${c.name}"? Articles must be reassigned first.`,
        icon: 'pi pi-trash',
        acceptLabel: 'Delete Category',
        acceptSeverity: 'danger',
        onAccept: async () => {
          try {
            await api.del(`/api/categories/${c.id}`);
            notify.success('Category Deleted', `"${c.name}" was removed.`);
            load();
          } catch (e) {
            notify.error('Delete Failed', e.message);
          }
        },
      });
    };
    return { items, load, remove };
  },
  template: `
    <dash-shell title="Manage Categories">
      <category-form :on-saved="load" />
      <div class="table-wrap">
        <table aria-label="Categories">
          <thead>
            <tr><th>Name</th><th>Slug</th><th>Actions</th></tr>
          </thead>
          <tbody>
            <tr v-if="!items.length">
              <td colspan="3" class="table-empty"><i class="fa-solid fa-tags" aria-hidden="true"></i><br>No categories found.</td>
            </tr>
            <tr v-for="c in items" :key="c.id">
              <td style="font-weight:600;color:var(--ink);">
                <i class="fa-solid fa-tag" aria-hidden="true" style="margin-right:6px;color:var(--accent);"></i>{{ c.name }}
              </td>
              <td><code style="font-size:var(--text-xs);background:var(--bg-3);padding:2px 6px;border-radius:3px;color:var(--ink-3);">/{{ c.slug }}</code></td>
              <td>
                <div class="action-btns">
                  <button class="icon-btn danger" @click="remove(c)" :title="'Delete '+c.name" :aria-label="'Delete category '+c.name">
                    <i class="fa-solid fa-trash" aria-hidden="true"></i>
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </dash-shell>
  `,
  components: { DashShell, CategoryForm },
});

export const AdminArticles = defineComponent({
  setup() {
    const items = ref([]); const statusFilter = ref(''); const loading = ref(true);
    const load = async () => {
      loading.value = true;
      const q = statusFilter.value ? `&status=${statusFilter.value}` : '';
      items.value = (await api.get(`/api/articles?pageSize=100${q}`)).items;
      loading.value = false;
    };
    onMounted(load);
    watch(statusFilter, load);
    const remove = async (a) => {
      confirmDialog({
        header: 'Delete Article',
        message: `Permanently delete "${a.title}"? This cannot be undone.`,
        icon: 'pi pi-trash',
        acceptLabel: 'Delete Permanently',
        acceptSeverity: 'danger',
        onAccept: async () => {
          try {
            await api.del(`/api/articles/${a.id}`);
            notify.success('Article Deleted', `"${a.title}" has been removed.`);
            load();
          } catch (e) {
            notify.error('Delete Failed', e.message);
          }
        },
      });
    };
    const publish = async (a) => {
      confirmDialog({
        header: 'Publish Article Live',
        message: `Publish "${a.title}" immediately to Jigawa Times?`,
        icon: 'pi pi-cloud-upload',
        acceptLabel: 'Publish Live',
        acceptSeverity: 'success',
        onAccept: async () => {
          try {
            await api.post(`/api/articles/${a.id}/publish`);
            notify.success('Article Published!', `"${a.title}" is now live on the site.`, `/news/${a.slug}`, 'View Article on Site');
            load();
          } catch (e) {
            notify.error('Publish Failed', e.message);
          }
        },
      });
    };
    const unpublish = async (a) => {
      confirmDialog({
        header: 'Unpublish Article',
        message: `Take "${a.title}" offline and return to draft?`,
        icon: 'pi pi-eye-slash',
        acceptLabel: 'Unpublish',
        acceptSeverity: 'warn',
        onAccept: async () => {
          try {
            await api.post(`/api/articles/${a.id}/unpublish`);
            notify.info('Article Unpublished', `"${a.title}" was moved to drafts.`);
            load();
          } catch (e) {
            notify.error('Unpublish Failed', e.message);
          }
        },
      });
    };
    return { items, statusFilter, loading, remove, publish, unpublish, timeAgo };
  },
  template: `
    <dash-shell title="Manage Articles">
      <div class="filter-bar">
        <div class="field">
          <label for="art-status-filter"><i class="fa-solid fa-filter" aria-hidden="true"></i> Filter by status</label>
          <select id="art-status-filter" v-model="statusFilter">
            <option value="">All statuses</option>
            <option v-for="s in ['DRAFT','SUBMITTED','IN_REVIEW','REVISION_REQUIRED','APPROVED','PUBLISHED','ARCHIVED']" :key="s" :value="s">{{ s.replace(/_/g,' ') }}</option>
          </select>
        </div>
      </div>

      <div v-if="loading" class="state-block">
        <div class="state-icon"><i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i></div>
        <p>Loading articles&hellip;</p>
      </div>
      <div v-else-if="!items.length" class="state-block">
        <div class="state-icon"><i class="fa-regular fa-newspaper" aria-hidden="true"></i></div>
        <h2>No articles found</h2>
        <p v-if="statusFilter">Try a different status filter.</p>
      </div>
      <div v-else class="table-wrap">
        <table aria-label="All articles">
          <thead>
            <tr>
              <th>Title</th>
              <th>Status</th>
              <th>Author</th>
              <th>Category</th>
              <th>Updated</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="a in items" :key="a.id">
              <td class="td-title"><router-link :to="'/news/'+a.slug" target="_blank" :title="'View: '+a.title">{{ a.title }}</router-link></td>
              <td><span :class="'badge status-'+a.status">{{ a.status.replace(/_/g,' ') }}</span></td>
              <td class="muted">{{ a.author?.name }}</td>
              <td class="muted">{{ a.category?.name }}</td>
              <td class="muted" style="white-space:nowrap;font-size:var(--text-xs);">{{ timeAgo(a.updatedAt) }}</td>
              <td>
                <div class="action-btns">
                  <router-link class="icon-btn" :to="'/reporter/edit/'+a.id" title="Edit article" aria-label="Edit article">
                    <i class="fa-solid fa-pen" aria-hidden="true"></i>
                  </router-link>
                  <button v-if="a.status!=='PUBLISHED'" class="icon-btn success" @click="publish(a)" title="Publish" aria-label="Publish article">
                    <i class="fa-solid fa-cloud-arrow-up" aria-hidden="true"></i>
                  </button>
                  <button v-else class="icon-btn accent" @click="unpublish(a)" title="Unpublish" aria-label="Unpublish article">
                    <i class="fa-solid fa-cloud-arrow-down" aria-hidden="true"></i>
                  </button>
                  <button class="icon-btn danger" @click="remove(a)" title="Delete article" aria-label="Delete article">
                    <i class="fa-solid fa-trash" aria-hidden="true"></i>
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </dash-shell>
  `,
  components: { DashShell },
});

export const AdminComments = defineComponent({
  setup() {
    const pending = ref([]);
    const load    = async () => { pending.value = (await api.get('/api/comments?approved=false')).items; };
    onMounted(load);
    const approve = async (c) => { await api.put(`/api/comments/${c.id}`, { approved: true }); load(); };
    const remove  = async (c) => { await api.del(`/api/comments/${c.id}`); load(); };
    const isAdmin = computed(() => store.user?.role === 'ADMIN');
    return { pending, approve, remove, isAdmin };
  },
  template: `
    <dash-shell title="Moderate Comments">
      <div v-if="!pending.length" class="state-block">
        <div class="state-icon" style="color:var(--green);"><i class="fa-solid fa-circle-check" aria-hidden="true"></i></div>
        <h2>All caught up</h2>
        <p>No comments awaiting moderation. Great work!</p>
      </div>
      <div v-else class="table-wrap">
        <div class="table-toolbar">
          <span style="font-size:var(--text-sm);font-weight:600;color:var(--ink-2);">
            <i class="fa-solid fa-comments" aria-hidden="true" style="margin-right:5px;color:var(--amber);"></i>
            {{ pending.length }} comment{{ pending.length !== 1 ? 's' : '' }} awaiting review
          </span>
        </div>
        <table aria-label="Comments awaiting moderation">
          <thead>
            <tr>
              <th>Article</th>
              <th>Commenter</th>
              <th>Comment</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in pending" :key="c.id">
              <td class="td-title" style="max-width:200px;">{{ c.article?.title }}</td>
              <td>
                <div style="font-weight:600;font-size:var(--text-sm);">{{ c.name }}</div>
                <div class="muted" style="font-size:var(--text-xs);">{{ c.email }}</div>
              </td>
              <td style="max-width:320px;font-size:var(--text-sm);color:var(--ink-2);">{{ c.content }}</td>
              <td>
                <div class="action-btns">
                  <button class="icon-btn success" @click="approve(c)" title="Approve comment" aria-label="Approve comment">
                    <i class="fa-solid fa-check" aria-hidden="true"></i>
                  </button>
                  <button class="icon-btn danger" @click="remove(c)" title="Delete comment" aria-label="Delete comment">
                    <i class="fa-solid fa-trash" aria-hidden="true"></i>
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </dash-shell>
  `,
  components: { DashShell },
});

// -----------------------------------------------------------------------
// AI NEWSROOM ADMIN PAGE
// -----------------------------------------------------------------------

// -----------------------------------------------------------------------
// AI NEWSROOM ADMIN PAGE
// -----------------------------------------------------------------------

export const AdminNewsroom = defineComponent({
  setup() {
    const items          = ref([]);
    const stats          = ref({ discovered: 0, pending_review: 0, generated: 0, published: 0, failed: 0, rejected: 0 });
    const logs           = ref([]);
    const statusFilter   = ref('');
    const categoryFilter = ref('');
    const reviewFilter   = ref('');
    const searchQuery    = ref('');
    const page           = ref(1);
    const pageSize       = ref(20);
    const total          = ref(0);
    const totalPages     = ref(1);
    const loading        = ref(true);
    const running        = ref(false);
    const error          = ref('');
    const selectedIds    = ref([]);

    const engine = reactive({
      isPaused: false,
      isRunning: false,
      inWindow: false,
      currentWindow: null,
      nextWindow: '08:00 - 09:00 WAT',
      currentTimeWat: '',
      windows: ['08:00 - 09:00 WAT', '13:00 - 14:00 WAT', '19:00 - 20:00 WAT', '00:00 - 01:00 WAT'],
    });

    const previewModal = reactive({
      show: false,
      item: null,
    });

    let logPollTimer    = null;
    let enginePollTimer = null;

    const fetchEngineStatus = async () => {
      try {
        const res = await api.get('/api/newsroom/status');
        Object.assign(engine, res);
        running.value = !!res.isRunning;
      } catch {}
    };

    const fetchLogs = async () => {
      try {
        const res = await api.get('/api/newsroom/logs');
        logs.value = res.logs || [];
      } catch {}
    };

    const load = async () => {
      loading.value = true;
      error.value   = '';
      try {
        const params = new URLSearchParams();
        params.append('page', page.value);
        params.append('pageSize', pageSize.value);
        if (statusFilter.value) params.append('status', statusFilter.value);
        if (categoryFilter.value) params.append('category', categoryFilter.value);
        if (reviewFilter.value) params.append('review', reviewFilter.value);
        if (searchQuery.value && searchQuery.value.trim()) params.append('q', searchQuery.value.trim());

        const [itemsRes, statsRes] = await Promise.all([
          api.get(`/api/newsroom/items?${params.toString()}`),
          api.get('/api/newsroom/stats'),
        ]);

        items.value      = itemsRes.items || [];
        total.value      = itemsRes.total || 0;
        totalPages.value = itemsRes.totalPages || 1;
        stats.value = {
          discovered:     statsRes.discovered     || 0,
          pending_review: statsRes.pending_review || 0,
          generated:      statsRes.generated      || 0,
          published:      statsRes.published      || 0,
          failed:         statsRes.failed         || 0,
          rejected:       statsRes.rejected       || 0,
        };

        // Filter out selected IDs that are no longer in items
        const currentItemIds = new Set(items.value.map((i) => i.id));
        selectedIds.value = selectedIds.value.filter((id) => currentItemIds.has(id));

        await Promise.all([fetchLogs(), fetchEngineStatus()]);
      } catch (e) {
        error.value = e.message || 'Failed to load newsroom data.';
      } finally {
        loading.value = false;
      }
    };

    onMounted(() => {
      load();
      logPollTimer    = setInterval(fetchLogs, 5000);
      enginePollTimer = setInterval(fetchEngineStatus, 10000);
    });

    onUnmounted(() => {
      if (logPollTimer) clearInterval(logPollTimer);
      if (enginePollTimer) clearInterval(enginePollTimer);
    });

    watch([statusFilter, categoryFilter, reviewFilter, pageSize], () => {
      page.value = 1;
      load();
    });

    // Pagination handlers
    const prevPage = () => {
      if (page.value > 1) {
        page.value--;
        load();
      }
    };
    const nextPage = () => {
      if (page.value < totalPages.value) {
        page.value++;
        load();
      }
    };
    const goToPage = (p) => {
      if (p >= 1 && p <= totalPages.value) {
        page.value = p;
        load();
      }
    };

    // Engine controls
    const toggleEnginePause = () => {
      if (engine.isPaused) {
        confirmDialog({
          header: 'Resume AI Newsroom Engine',
          message: 'Resume automatic story discovery? The engine will scan during active operating windows (08-09, 13-14, 19-20, 00-01 WAT).',
          icon: 'pi pi-play',
          acceptSeverity: 'primary',
          acceptLabel: 'Resume Engine',
          onAccept: async () => {
            try {
              const res = await api.post('/api/newsroom/engine/resume');
              Object.assign(engine, res.status || {});
              notify.success('Engine Resumed', 'Automatic story scanning is active for scheduled windows.');
              await fetchEngineStatus();
            } catch (e) {
              notify.error('Resume Failed', e.message);
            }
          },
        });
      } else {
        confirmDialog({
          header: 'Pause AI Newsroom Engine',
          message: 'Pause automatic story discovery indefinitely? All background interval scans will halt until you resume.',
          icon: 'pi pi-pause',
          acceptSeverity: 'warn',
          acceptLabel: 'Pause Indefinitely',
          onAccept: async () => {
            try {
              const res = await api.post('/api/newsroom/engine/pause');
              Object.assign(engine, res.status || {});
              notify.warn('Engine Paused', 'AI discovery paused indefinitely. You can still trigger manual scans.');
              await fetchEngineStatus();
            } catch (e) {
              notify.error('Pause Failed', e.message);
            }
          },
        });
      }
    };

    const stopScan = () => {
      confirmDialog({
        header: 'Stop Active Scan',
        message: 'Abort the newsroom scan currently in progress?',
        icon: 'pi pi-stop-circle',
        acceptSeverity: 'danger',
        acceptLabel: 'Abort Scan',
        onAccept: async () => {
          try {
            await api.post('/api/newsroom/engine/stop');
            notify.info('Stop Signal Sent', 'Ongoing news scan has been instructed to cancel.');
            await fetchEngineStatus();
          } catch (e) {
            notify.error('Stop Failed', e.message);
          }
        },
      });
    };

    const runNow = async () => {
      running.value = true;
      try {
        const res = await api.post('/api/newsroom/run');
        notify.info(
          'AI Newsroom Scan Started',
          res.message || 'Scanning news sources and processing candidates in background. Live output below.'
        );
        await Promise.all([fetchLogs(), fetchEngineStatus()]);
      } catch (e) {
        notify.error('Scan Failed', e.message || 'Could not start newsroom scan. Check GEMINI_API_KEY.');
      } finally {
        setTimeout(() => { running.value = false; load(); }, 4000);
      }
    };

    // Story actions
    const approve = (item) => {
      confirmDialog({
        header: 'Publish Story Live',
        message: `Publish "${item.sourceTitle || item.sourceName}" immediately to Jigawa Times? It will be visible to all readers on the homepage and news category.`,
        icon: 'pi pi-cloud-upload',
        acceptSeverity: 'success',
        acceptLabel: 'Approve & Publish',
        onAccept: async () => {
          try {
            const res = await api.post(`/api/newsroom/items/${item.id}/approve`);
            const slug = res.articleSlug || res.item?.article?.slug || item.article?.slug;
            notify.success(
              'Story Published Live!',
              `"${item.sourceTitle || item.sourceName}" is now live on Jigawa Times.`,
              slug ? `/news/${slug}` : '',
              'View Article on Site'
            );
            if (previewModal.show && previewModal.item?.id === item.id) {
              previewModal.show = false;
            }
            await load();
          } catch (e) {
            notify.error('Publish Failed', e.message || 'Could not approve and publish article.');
          }
        },
      });
    };

    const reject = (item) => {
      confirmDialog({
        header: 'Reject Story',
        message: `Reject "${item.sourceTitle || item.sourceName}"? Its linked draft article (if any) will be archived and removed from review.`,
        icon: 'pi pi-box-archive',
        acceptSeverity: 'danger',
        acceptLabel: 'Reject & Archive',
        onAccept: async () => {
          try {
            await api.post(`/api/newsroom/items/${item.id}/reject`);
            notify.info('Story Rejected', 'The news item has been marked as rejected and archived.');
            if (previewModal.show && previewModal.item?.id === item.id) {
              previewModal.show = false;
            }
            await load();
          } catch (e) {
            notify.error('Action Failed', e.message || 'Could not reject item.');
          }
        },
      });
    };

    const deleteItem = (item) => {
      confirmDialog({
        header: 'Delete Newsroom Item',
        message: `Permanently delete "${item.sourceTitle || item.sourceName}" from the newsroom records?`,
        icon: 'pi pi-trash',
        acceptSeverity: 'danger',
        acceptLabel: 'Delete Permanently',
        onAccept: async () => {
          try {
            await api.del(`/api/newsroom/items/${item.id}`);
            notify.success('Item Deleted', 'The newsroom item was permanently deleted.');
            if (previewModal.show && previewModal.item?.id === item.id) {
              previewModal.show = false;
            }
            await load();
          } catch (e) {
            notify.error('Delete Failed', e.message);
          }
        },
      });
    };

    // Batch Actions
    const isAllSelected = computed(() => {
      if (!items.value.length) return false;
      return items.value.every((i) => selectedIds.value.includes(i.id));
    });

    const toggleSelectAll = () => {
      if (isAllSelected.value) {
        selectedIds.value = [];
      } else {
        selectedIds.value = items.value.map((i) => i.id);
      }
    };

    const toggleSelect = (id) => {
      const idx = selectedIds.value.indexOf(id);
      if (idx === -1) {
        selectedIds.value.push(id);
      } else {
        selectedIds.value.splice(idx, 1);
      }
    };

    const batchPublish = () => {
      const count = selectedIds.value.length;
      if (!count) return;

      confirmDialog({
        header: `Publish ${count} Stories Live`,
        message: `Publish all ${count} selected stories live to Jigawa Times? They will appear immediately on the homepage and respective categories.`,
        icon: 'pi pi-cloud-upload',
        acceptSeverity: 'success',
        acceptLabel: `Publish ${count} Stories`,
        onAccept: async () => {
          try {
            const res = await api.post('/api/newsroom/batch/approve', { ids: selectedIds.value });
            notify.success('Batch Published Live', `Successfully published ${res.successful} stories (${res.failed} failed).`);
            selectedIds.value = [];
            await load();
          } catch (e) {
            notify.error('Batch Publish Failed', e.message);
          }
        },
      });
    };

    const batchReject = () => {
      const count = selectedIds.value.length;
      if (!count) return;

      confirmDialog({
        header: `Reject ${count} Stories`,
        message: `Mark all ${count} selected stories as rejected and archive their linked drafts?`,
        icon: 'pi pi-box-archive',
        acceptSeverity: 'warn',
        acceptLabel: `Reject ${count} Stories`,
        onAccept: async () => {
          try {
            const res = await api.post('/api/newsroom/batch/reject', { ids: selectedIds.value });
            notify.info('Batch Rejected', `Marked ${res.successful} stories as rejected.`);
            selectedIds.value = [];
            await load();
          } catch (e) {
            notify.error('Batch Reject Failed', e.message);
          }
        },
      });
    };

    const batchDelete = () => {
      const count = selectedIds.value.length;
      if (!count) return;

      confirmDialog({
        header: `Delete ${count} Stories Permanently`,
        message: `Permanently delete ${count} selected newsroom records? This action cannot be undone.`,
        icon: 'pi pi-trash',
        acceptSeverity: 'danger',
        acceptLabel: `Delete ${count} Items`,
        onAccept: async () => {
          try {
            const res = await api.post('/api/newsroom/batch/delete', { ids: selectedIds.value });
            notify.success('Batch Deleted', `Deleted ${res.deleted || count} newsroom records.`);
            selectedIds.value = [];
            await load();
          } catch (e) {
            notify.error('Batch Delete Failed', e.message);
          }
        },
      });
    };

    const openPreview = (item) => {
      previewModal.item = item;
      previewModal.show = true;
    };

    const statusLabel = (s) => (s || '').replace(/_/g, ' ');

    return {
      items, stats, logs, statusFilter, categoryFilter, reviewFilter, searchQuery,
      page, pageSize, total, totalPages, loading, running, error,
      engine, previewModal, selectedIds, isAllSelected,
      load, prevPage, nextPage, goToPage,
      toggleEnginePause, stopScan, runNow,
      approve, reject, deleteItem, openPreview,
      toggleSelectAll, toggleSelect,
      batchPublish, batchReject, batchDelete,
      statusLabel, fetchLogs, timeAgo,
    };
  },
  template: `
    <dash-shell title="AI Newsroom">
      <!-- Enterprise Engine Control Card -->
      <div style="background:var(--bg-1);border:1px solid var(--line);border-radius:var(--radius);padding:18px 22px;margin-bottom:var(--s6);box-shadow:var(--shadow-sm);">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:14px;">
          <div style="display:flex;align-items:center;gap:14px;">
            <!-- Status Icon Pill -->
            <div :style="'width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:18px;background:' + (running ? 'rgba(34,197,94,0.14)' : engine.isPaused ? 'rgba(234,179,8,0.14)' : engine.inWindow ? 'rgba(34,197,94,0.14)' : 'rgba(59,130,246,0.14)') + ';color:' + (running ? 'var(--green)' : engine.isPaused ? 'var(--amber)' : engine.inWindow ? 'var(--green)' : 'var(--blue)')">
              <i :class="running ? 'pi pi-spin pi-spinner' : engine.isPaused ? 'pi pi-pause' : engine.inWindow ? 'pi pi-check-circle' : 'pi pi-clock'"></i>
            </div>
            <div>
              <div style="display:flex;align-items:center;gap:8px;">
                <h3 style="margin:0;font-size:16px;font-weight:700;">
                  <span v-if="running" style="color:var(--green);">AI Engine Currently Scanning...</span>
                  <span v-else-if="engine.isPaused" style="color:var(--amber);">AI Search Paused Indefinitely</span>
                  <span v-else-if="engine.inWindow" style="color:var(--green);">Operational Window Active ({{ engine.currentWindow }})</span>
                  <span v-else style="color:var(--blue);">Scheduled Standby (Next: {{ engine.nextWindow }})</span>
                </h3>
                <span v-if="engine.currentTimeWat" style="font-size:11px;font-weight:600;padding:2px 7px;border-radius:12px;background:var(--bg-3);color:var(--ink-3);">
                  {{ engine.currentTimeWat }}
                </span>
              </div>
              <p style="margin:4px 0 0 0;font-size:12px;color:var(--ink-3);line-height:1.4;">
                Active Scan Intervals: <strong>08:00–09:00</strong> &bull; <strong>13:00–14:00</strong> &bull; <strong>19:00–20:00</strong> &bull; <strong>00:00–01:00 WAT</strong>.
                <span v-if="engine.isPaused" style="color:var(--amber);font-weight:600;"> Auto-scan is halted.</span>
              </p>
            </div>
          </div>

          <!-- Quick Action Buttons -->
          <div style="display:flex;align-items:center;gap:8px;">
            <!-- Stop Running Scan -->
            <button
              v-if="running"
              type="button"
              class="btn sm danger"
              @click="stopScan"
              title="Stop ongoing scan">
              <i class="pi pi-stop-circle" aria-hidden="true"></i> Stop Scan
            </button>

            <!-- Pause / Resume Toggle -->
            <button
              type="button"
              :class="'btn sm ' + (engine.isPaused ? 'accent' : 'ghost')"
              @click="toggleEnginePause"
              :title="engine.isPaused ? 'Resume scheduled scanning' : 'Pause automatic searches indefinitely'">
              <i :class="engine.isPaused ? 'pi pi-play' : 'pi pi-pause'" aria-hidden="true"></i>
              {{ engine.isPaused ? 'Resume Engine' : 'Pause Engine' }}
            </button>

            <!-- Run Now Override -->
            <button
              type="button"
              class="btn sm accent"
              @click="runNow"
              :disabled="running"
              title="Trigger an immediate scan cycle right now">
              <i :class="running ? 'pi pi-spin pi-spinner' : 'pi pi-bolt'" aria-hidden="true"></i>
              {{ running ? 'Scanning…' : 'Run Now' }}
            </button>
          </div>
        </div>
      </div>

      <!-- Stats row -->
      <div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(120px,1fr));margin-bottom:var(--s6);">
        <div class="stat-card">
          <div class="stat-value">{{ stats.discovered }}</div>
          <div class="stat-label"><i class="fa-solid fa-satellite-dish" aria-hidden="true"></i> Discovered</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="color:var(--amber);">{{ stats.pending_review }}</div>
          <div class="stat-label"><i class="fa-solid fa-hourglass-half" aria-hidden="true"></i> Pending Review</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="color:var(--accent);">{{ stats.generated }}</div>
          <div class="stat-label"><i class="fa-solid fa-file-pen" aria-hidden="true"></i> Generated</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="color:var(--green);">{{ stats.published }}</div>
          <div class="stat-label"><i class="fa-solid fa-cloud-arrow-up" aria-hidden="true"></i> Published</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="color:var(--red);">{{ stats.failed }}</div>
          <div class="stat-label"><i class="fa-solid fa-circle-xmark" aria-hidden="true"></i> Failed</div>
        </div>
      </div>

      <!-- Filters & Search Toolbar -->
      <div style="background:var(--bg-1);border:1px solid var(--line);border-radius:var(--radius);padding:14px 18px;margin-bottom:var(--s4);display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap;">
        <!-- Search -->
        <div class="field" style="margin:0;flex:2;min-width:180px;">
          <label style="font-size:12px;font-weight:600;"><i class="pi pi-search"></i> Search</label>
          <input type="text" v-model="searchQuery" @keyup.enter="load" placeholder="Search headline or source..." style="padding:6px 10px;font-size:13px;width:100%;border:1px solid var(--line);border-radius:var(--radius);" />
        </div>

        <!-- Status Filter -->
        <div class="field" style="margin:0;flex:1;min-width:140px;">
          <label style="font-size:12px;font-weight:600;"><i class="pi pi-filter"></i> Status</label>
          <select v-model="statusFilter" style="padding:6px 10px;font-size:13px;width:100%;border:1px solid var(--line);border-radius:var(--radius);">
            <option value="">All Statuses</option>
            <option v-for="s in ['DISCOVERED','ANALYZING','PENDING_REVIEW','GENERATED','PUBLISHED','FAILED','REJECTED']" :key="s" :value="s">{{ statusLabel(s) }}</option>
          </select>
        </div>

        <!-- Category Filter -->
        <div class="field" style="margin:0;flex:1;min-width:130px;">
          <label style="font-size:12px;font-weight:600;"><i class="pi pi-tag"></i> Category</label>
          <select v-model="categoryFilter" style="padding:6px 10px;font-size:13px;width:100%;border:1px solid var(--line);border-radius:var(--radius);">
            <option value="">All Categories</option>
            <option value="jigawa">Jigawa</option>
            <option value="buji">Buji</option>
            <option value="politics">Politics</option>
            <option value="business">Business</option>
            <option value="education">Education</option>
            <option value="investigations">Investigations</option>
          </select>
        </div>

        <!-- Review Filter -->
        <div class="field" style="margin:0;flex:1;min-width:130px;">
          <label style="font-size:12px;font-weight:600;"><i class="pi pi-exclamation-triangle"></i> Review</label>
          <select v-model="reviewFilter" style="padding:6px 10px;font-size:13px;width:100%;border:1px solid var(--line);border-radius:var(--radius);">
            <option value="">All</option>
            <option value="true">Review Required</option>
            <option value="false">Standard</option>
          </select>
        </div>

        <!-- Page Size -->
        <div class="field" style="margin:0;width:100px;">
          <label style="font-size:12px;font-weight:600;">Per Page</label>
          <select v-model="pageSize" style="padding:6px 10px;font-size:13px;width:100%;border:1px solid var(--line);border-radius:var(--radius);">
            <option :value="10">10</option>
            <option :value="20">20</option>
            <option :value="50">50</option>
            <option :value="100">100</option>
          </select>
        </div>

        <!-- Action buttons -->
        <div style="display:flex;gap:8px;">
          <button class="btn ghost" @click="load" :disabled="loading" title="Refresh list">
            <i :class="loading ? 'pi pi-spin pi-spinner' : 'pi pi-refresh'" aria-hidden="true"></i>
            Refresh
          </button>
        </div>
      </div>

      <!-- Batch Actions Floating/Sticky Bar -->
      <div
        v-if="selectedIds.length > 0"
        style="background:#0f172a;color:#f8fafc;padding:12px 20px;border-radius:var(--radius);margin-bottom:var(--s4);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;box-shadow:0 10px 25px -5px rgba(0,0,0,0.25);border:1px solid #334155;">
        <div style="display:flex;align-items:center;gap:10px;font-size:13px;font-weight:600;">
          <span style="background:#2563eb;color:#fff;padding:2px 8px;border-radius:12px;font-size:11px;">
            {{ selectedIds.length }}
          </span>
          <span>Selected story items</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <button type="button" class="btn sm success" @click="batchPublish" style="background:#16a34a;color:#fff;font-weight:600;">
            <i class="pi pi-cloud-upload"></i> Publish Selected
          </button>
          <button type="button" class="btn sm ghost" @click="batchReject" style="background:rgba(255,255,255,0.1);color:#f1f5f9;">
            <i class="pi pi-box-archive"></i> Reject Selected
          </button>
          <button type="button" class="btn sm danger" @click="batchDelete">
            <i class="pi pi-trash"></i> Delete Selected
          </button>
          <button type="button" class="btn sm ghost" @click="selectedIds = []" style="color:#94a3b8;">
            Cancel
          </button>
        </div>
      </div>

      <!-- Error banner if load failed -->
      <Message v-if="error" severity="error" icon="pi pi-exclamation-triangle" style="margin-bottom:var(--s4);">
        {{ error }}
      </Message>

      <!-- Items table -->
      <div v-if="loading" class="state-block">
        <div class="state-icon"><i class="pi pi-spin pi-spinner" style="font-size:28px;"></i></div>
        <p>Loading newsroom items&hellip;</p>
      </div>
      <div v-else-if="!items.length" class="state-block">
        <div class="state-icon" style="color:var(--ink-4);"><i class="fa-solid fa-robot" aria-hidden="true"></i></div>
        <h2>No items found</h2>
        <p>Click <strong>Run Now</strong> to start an AI newsroom scan cycle or adjust filters.</p>
      </div>
      <div v-else class="table-wrap">
        <table aria-label="Newsroom items">
          <thead>
            <tr>
              <th style="width:36px;text-align:center;">
                <input type="checkbox" :checked="isAllSelected" @change="toggleSelectAll" title="Select all on this page" style="cursor:pointer;" />
              </th>
              <th style="width:70px;">Media</th>
              <th>Story</th>
              <th>Source</th>
              <th>Status</th>
              <th>Category</th>
              <th>Review?</th>
              <th>Discovered</th>
              <th style="text-align:right;">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in items" :key="item.id" :style="selectedIds.includes(item.id) ? 'background:rgba(59,130,246,0.05);' : ''">
              <!-- Checkbox -->
              <td style="text-align:center;">
                <input type="checkbox" :checked="selectedIds.includes(item.id)" @change="toggleSelect(item.id)" style="cursor:pointer;" />
              </td>

              <!-- Thumbnail Preview -->
              <td>
                <div style="width:60px;height:42px;border-radius:4px;overflow:hidden;background:var(--bg-3);display:flex;align-items:center;justify-content:center;">
                  <img
                    v-if="item.article?.featuredImage || item.rawData?.imageUrl"
                    :src="item.article?.featuredImage || item.rawData?.imageUrl"
                    alt=""
                    style="width:100%;height:100%;object-fit:cover;"
                    loading="lazy"
                    @error="$event.target.style.display='none'" />
                  <i v-else class="pi pi-image" style="color:var(--ink-4);font-size:16px;"></i>
                </div>
              </td>

              <!-- Story Title & Links -->
              <td class="td-title" style="max-width:280px;">
                <a href="#" @click.prevent="openPreview(item)" :title="item.sourceTitle || item.sourceName" style="font-weight:600;line-height:1.35;display:block;color:var(--ink);">
                  {{ item.sourceTitle || item.sourceName }}
                </a>
                <div style="display:flex;align-items:center;gap:6px;margin-top:4px;flex-wrap:wrap;">
                  <!-- Live Article Link -->
                  <a
                    v-if="item.article?.slug && item.status === 'PUBLISHED'"
                    :href="'/news/' + item.article.slug"
                    target="_blank"
                    style="font-size:11px;font-weight:700;color:var(--green);display:inline-flex;align-items:center;gap:4px;background:rgba(34,197,94,0.12);padding:2px 7px;border-radius:4px;text-decoration:none;">
                    <i class="pi pi-arrow-up-right" style="font-size:9px;"></i> Live on Site
                  </a>
                  <!-- Draft Article Link -->
                  <router-link
                    v-else-if="item.article?.id"
                    :to="'/reporter/edit/' + item.article.id"
                    target="_blank"
                    style="font-size:11px;font-weight:600;color:var(--accent);display:inline-flex;align-items:center;gap:4px;text-decoration:none;">
                    <i class="pi pi-pencil" style="font-size:9px;"></i> Edit Draft #{{ item.article.id }}
                  </router-link>
                  <!-- Sourced Only Item -->
                  <span v-else style="font-size:11px;color:var(--ink-4);display:inline-flex;align-items:center;gap:4px;">
                    <i class="pi pi-globe" style="font-size:9px;"></i> Sourced story
                  </span>
                  <!-- Quick Preview Button -->
                  <button type="button" @click="openPreview(item)" style="background:none;border:none;color:var(--blue);font-size:11px;cursor:pointer;padding:0 4px;text-decoration:underline;">
                    Preview
                  </button>
                </div>
              </td>

              <td class="muted" style="font-size:var(--text-xs);">{{ item.sourceName }}</td>
              <td><span :class="'badge status-'+(item.status==='PENDING_REVIEW'?'IN_REVIEW':item.status==='PUBLISHED'?'PUBLISHED':item.status==='FAILED'?'ARCHIVED':'DRAFT')">{{ statusLabel(item.status) }}</span></td>
              <td class="muted" style="font-size:var(--text-xs);text-transform:capitalize;">{{ item.category || '—' }}</td>
              <td>
                <span v-if="item.reviewRequired" style="color:var(--amber);font-size:var(--text-xs);font-weight:700;display:inline-flex;align-items:center;gap:3px;">
                  <i class="pi pi-exclamation-triangle" style="font-size:10px;"></i> Yes
                </span>
                <span v-else style="color:var(--ink-4);font-size:var(--text-xs);">—</span>
              </td>
              <td class="muted" style="white-space:nowrap;font-size:var(--text-xs);">{{ timeAgo(item.createdAt) }}</td>

              <!-- Action Buttons -->
              <td style="text-align:right;">
                <div class="action-btns" style="display:inline-flex;align-items:center;gap:6px;">
                  <!-- Preview button -->
                  <button
                    type="button"
                    class="btn sm ghost"
                    @click="openPreview(item)"
                    title="Preview full article"
                    style="padding:3px 7px;font-size:12px;">
                    <i class="pi pi-eye"></i>
                  </button>

                  <!-- Publish Button -->
                  <button
                    v-if="item.status !== 'PUBLISHED' && item.status !== 'REJECTED'"
                    type="button"
                    class="btn sm accent"
                    @click="approve(item)"
                    title="Publish Live on Jigawa Times"
                    style="padding:3px 9px;font-size:12px;font-weight:600;display:inline-flex;align-items:center;gap:4px;">
                    <i class="pi pi-cloud-upload"></i> Publish
                  </button>

                  <!-- Reject Button -->
                  <button
                    v-if="item.status !== 'REJECTED'"
                    type="button"
                    class="btn sm ghost danger"
                    @click="reject(item)"
                    title="Reject & Archive"
                    style="padding:3px 7px;font-size:12px;">
                    <i class="pi pi-times"></i>
                  </button>

                  <!-- Delete Button -->
                  <button
                    type="button"
                    class="btn sm ghost danger"
                    @click="deleteItem(item)"
                    title="Delete item permanently"
                    style="padding:3px 7px;font-size:12px;color:var(--red);">
                    <i class="pi pi-trash"></i>
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Pagination Toolbar -->
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-top:var(--s5);padding-top:var(--s4);border-top:1px solid var(--line);">
        <div style="font-size:12px;color:var(--ink-3);">
          Showing <strong>{{ items.length ? (page - 1) * pageSize + 1 : 0 }}</strong> to <strong>{{ Math.min(page * pageSize, total) }}</strong> of <strong>{{ total }}</strong> stories
        </div>
        <div style="display:flex;align-items:center;gap:6px;">
          <button
            type="button"
            class="btn sm ghost"
            :disabled="page <= 1"
            @click="prevPage"
            style="padding:4px 10px;font-size:12px;">
            <i class="pi pi-chevron-left"></i> Previous
          </button>
          <span style="font-size:12px;font-weight:600;padding:0 8px;">
            Page {{ page }} of {{ totalPages }}
          </span>
          <button
            type="button"
            class="btn sm ghost"
            :disabled="page >= totalPages"
            @click="nextPage"
            style="padding:4px 10px;font-size:12px;">
            Next <i class="pi pi-chevron-right"></i>
          </button>
        </div>
      </div>

      <!-- Article Preview Modal -->
      <Dialog
        v-model:visible="previewModal.show"
        modal
        header="Article Preview"
        :style="{ width: '90vw', maxWidth: '780px' }">
        <div v-if="previewModal.item" style="display:flex;flex-direction:column;gap:16px;">
          <!-- Featured Image -->
          <div
            v-if="previewModal.item.article?.featuredImage || previewModal.item.rawData?.imageUrl"
            style="width:100%;height:320px;border-radius:8px;overflow:hidden;background:#000;">
            <img
              :src="previewModal.item.article?.featuredImage || previewModal.item.rawData?.imageUrl"
              :alt="previewModal.item.sourceTitle"
              style="width:100%;height:100%;object-fit:cover;" />
          </div>
          <div v-if="previewModal.item.article?.imageCaption" style="font-size:12px;color:var(--ink-3);font-style:italic;">
            {{ previewModal.item.article.imageCaption }}
          </div>

          <!-- Metadata row -->
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <span class="badge" style="background:var(--accent);color:#fff;text-transform:uppercase;">
              {{ previewModal.item.category || 'General' }}
            </span>
            <span :class="'badge status-'+(previewModal.item.status==='PENDING_REVIEW'?'IN_REVIEW':previewModal.item.status==='PUBLISHED'?'PUBLISHED':'DRAFT')">
              {{ statusLabel(previewModal.item.status) }}
            </span>
            <span v-if="previewModal.item.reviewRequired" style="background:rgba(234,179,8,0.15);color:var(--amber);font-size:11px;font-weight:700;padding:2px 8px;border-radius:4px;">
              <i class="pi pi-exclamation-triangle"></i> Review Required
            </span>
            <span style="font-size:12px;color:var(--ink-4);margin-left:auto;">
              Source: <strong>{{ previewModal.item.sourceName }}</strong>
            </span>
          </div>

          <!-- Title -->
          <h2 style="font-size:22px;line-height:1.3;margin:0;">
            {{ previewModal.item.article?.title || previewModal.item.sourceTitle }}
          </h2>

          <!-- Excerpt -->
          <p v-if="previewModal.item.article?.excerpt" style="font-size:14px;color:var(--ink-2);font-weight:500;line-height:1.5;margin:0;border-left:3px solid var(--accent);padding-left:12px;">
            {{ previewModal.item.article.excerpt }}
          </p>

          <!-- Article Content Body -->
          <div
            v-if="previewModal.item.article?.content"
            v-html="previewModal.item.article.content"
            style="font-size:14px;line-height:1.75;color:var(--ink);border-top:1px solid var(--line);padding-top:14px;">
          </div>
          <div v-else style="background:var(--bg-3);padding:14px;border-radius:6px;font-size:13px;color:var(--ink-3);">
            <em>Full article has not been compiled yet. Click <strong>Publish Story</strong> to generate and publish this article immediately.</em>
          </div>

          <!-- Original Source URL Link -->
          <div style="font-size:12px;color:var(--ink-4);border-top:1px solid var(--line);padding-top:10px;">
            Original Source URL:
            <a :href="previewModal.item.sourceUrl" target="_blank" rel="noopener noreferrer" style="color:var(--accent);word-break:break-all;">
              {{ previewModal.item.sourceUrl }} <i class="pi pi-external-link" style="font-size:10px;"></i>
            </a>
          </div>
        </div>

        <template #footer>
          <div style="display:flex;justify-content:flex-end;gap:10px;width:100%;">
            <button type="button" class="btn sm ghost" @click="previewModal.show = false">
              Close
            </button>
            <button
              v-if="previewModal.item && previewModal.item.status !== 'REJECTED'"
              type="button"
              class="btn sm ghost danger"
              @click="reject(previewModal.item)">
              <i class="pi pi-times"></i> Reject Story
            </button>
            <button
              v-if="previewModal.item && previewModal.item.status !== 'PUBLISHED'"
              type="button"
              class="btn sm accent"
              @click="approve(previewModal.item)">
              <i class="pi pi-cloud-upload"></i> Publish Story Live
            </button>
          </div>
        </template>
      </Dialog>

      <!-- Live Newsroom Logs Terminal -->
      <div style="margin-top:var(--s6);background:#181825;color:#cdd6f4;border-radius:var(--r-md);padding:var(--s4);font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:12px;box-shadow:var(--shadow-sm);border:1px solid #313244;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--s2);border-bottom:1px solid #313244;padding-bottom:var(--s2);">
          <span style="font-weight:bold;color:#89b4fa;display:flex;align-items:center;gap:6px;">
            <i class="fa-solid fa-terminal" aria-hidden="true"></i> Live Execution Terminal
            <span v-if="running" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#a6e3a1;animation:pulse 1.5s infinite;"></span>
          </span>
          <button class="btn ghost" style="color:#a6adc8;font-size:11px;padding:2px 8px;border:1px solid #45475a;" @click="fetchLogs" title="Refresh logs">
            <i class="fa-solid fa-rotate-right" aria-hidden="true"></i> Refresh Logs
          </button>
        </div>
        <div style="max-height:220px;overflow-y:auto;line-height:1.6;">
          <div v-if="!logs.length" style="color:#6c7086;font-style:italic;">No logs recorded yet. The scheduler will run during operational windows (08-09, 13-14, 19-20, 00-01 WAT), or click 'Run Now' above.</div>
          <div v-for="(l, i) in logs" :key="i" :style="{color: l.level === 'error' ? '#f38ba8' : l.level === 'warn' ? '#f9e2af' : '#a6e3a1', padding:'1px 0'}">
            <span style="color:#6c7086;">[{{ l.time ? l.time.split('T')[1].slice(0,8) : '' }}]</span> {{ l.message }}
          </div>
        </div>
      </div>

      <!-- AI disclosure note -->
      <p style="font-size:var(--text-xs);color:var(--ink-4);margin-top:var(--s5);line-height:1.6;">
        <i class="fa-solid fa-robot" aria-hidden="true"></i>
        Articles generated by the AI Newsroom are prepared from verified public sources with authentic imagery.
        All articles follow the Jigawa Times comprehensive editorial workflow. High-risk stories are always flagged for manual review.
      </p>
    </dash-shell>
  `,
  components: { DashShell },
});

// -----------------------------------------------------------------------
// HYBRID NEWS AGGREGATOR
// -----------------------------------------------------------------------

export const AdminAggregator = defineComponent({
  setup() {
    const router         = useRouter();
    const items          = ref([]);
    const stats          = reactive({ total: 0, discovered: 0, drafted: 0, published: 0, jigawa: 0, nigeria: 0, africa: 0, world: 0 });
    const activeRegion   = ref('all');
    const activeStatus   = ref('ALL');
    const activeSource   = ref('');
    const searchQuery    = ref('');
    const page           = ref(1);
    const pageSize       = ref(24);
    const total          = ref(0);
    const totalPages     = ref(1);
    const loading        = ref(true);
    const scanning       = ref(false);
    const generatingId   = ref(null);
    const selectedIds    = ref([]);
    const viewMode       = ref('grid');

    const engine = reactive({
      isPaused: false,
      isRunning: false,
      inWindow: false,
      currentWindow: null,
      nextWindow: '08:00 - 09:00 WAT',
      currentTimeWat: '',
      windows: ['08:00 - 09:00 WAT', '13:00 - 14:00 WAT', '19:00 - 20:00 WAT', '00:00 - 01:00 WAT'],
    });

    const previewModal = reactive({
      show: false,
      item: null,
      publishing: false,
    });

    const sourcesList = [
      'Google News – Jigawa',
      'Google News – Dutse & Buji',
      'Daily Trust – Northern News',
      'Jigawa State Government',
      'Channels Television',
      'Vanguard News',
      'Punch Newspapers',
      'Premium Times',
      'Tribune Online',
      'BBC News Africa',
      'AllAfrica',
      'AfricaNews',
      'BBC News World',
      'Al Jazeera English',
      'The Guardian World',
    ];

    let pollTimer = null;

    const fetchStatus = async () => {
      try {
        const res = await api.get('/api/newsroom/status');
        Object.assign(engine, res);
      } catch {}
    };

    const fetchStats = async () => {
      try {
        const res = await api.get('/api/aggregator/stats');
        Object.assign(stats, res);
      } catch {}
    };

    const fetchItems = async () => {
      loading.value = true;
      try {
        const params = new URLSearchParams();
        params.append('page', page.value);
        params.append('pageSize', pageSize.value);
        if (activeRegion.value && activeRegion.value !== 'all') params.append('region', activeRegion.value);
        if (activeStatus.value && activeStatus.value !== 'ALL') params.append('status', activeStatus.value);
        if (activeSource.value) params.append('source', activeSource.value);
        if (searchQuery.value && searchQuery.value.trim()) params.append('q', searchQuery.value.trim());

        const res = await api.get(`/api/aggregator/items?${params.toString()}`);
        items.value = res.items || [];
        total.value = res.total || 0;
        totalPages.value = res.totalPages || 1;
      } catch (err) {
        notify.error('Feed Error', err.message || 'Could not load aggregated news.');
      } finally {
        loading.value = false;
      }
    };

    const scanFeeds = async () => {
      scanning.value = true;
      try {
        const res = await api.post('/api/aggregator/scan');
        notify.success('Feed Scan Completed', `Discovered ${res.totalDiscovered} stories across Jigawa, Nigeria, Africa, and Global feeds.`);
        await Promise.all([fetchStats(), fetchItems()]);
      } catch (err) {
        notify.error('Scan Failed', err.message || 'Failed to scan news feeds.');
      } finally {
        scanning.value = false;
      }
    };

    const togglePause = async () => {
      const willPause = !engine.isPaused;
      confirmDialog({
        message: willPause
          ? 'Pause scheduled automated RSS background scans indefinitely? You can still manually scan feeds anytime.'
          : 'Resume automated background scans according to the 4 daily operational windows?',
        header: willPause ? 'Pause Automated Scans' : 'Resume Automated Scans',
        icon: willPause ? 'fa-solid fa-circle-pause' : 'fa-solid fa-circle-play',
        accept: async () => {
          try {
            if (willPause) {
              const res = await api.post('/api/newsroom/engine/pause');
              engine.isPaused = res.isPaused;
              notify.warn('Aggregator Paused', 'Automated RSS scans are now paused indefinitely.');
            } else {
              const res = await api.post('/api/newsroom/engine/resume');
              engine.isPaused = res.isPaused;
              notify.success('Aggregator Resumed', 'Automated scans resumed for operational windows.');
            }
          } catch (err) {
            notify.error('Action Failed', err.message);
          }
        },
      });
    };

    const draftStory = async (item) => {
      generatingId.value = item.id;
      try {
        const res = await api.post(`/api/aggregator/generate/${item.id}`);
        notify.success('Draft Created with AI', `"${res.article.title.slice(0, 45)}..." was successfully generated and saved to database as DRAFT.`);
        item.status = 'DRAFTED';
        item.articleId = res.article.id;
        item.article = res.article;
        fetchStats();
      } catch (err) {
        notify.error('Drafting Failed', err.message || 'AI synthesis failed.');
      } finally {
        generatingId.value = null;
      }
    };

    const batchDraft = () => {
      if (!selectedIds.value.length) return;
      confirmDialog({
        message: `Generate and draft ${selectedIds.value.length} selected stories with AI? Each story will be rewritten in an original human journalistic voice with 16:9 imagery and saved as a DRAFT.`,
        header: 'Confirm Batch AI Drafting',
        icon: 'fa-solid fa-wand-magic-sparkles',
        accept: async () => {
          try {
            const res = await api.post('/api/aggregator/batch-generate', { ids: selectedIds.value });
            notify.success('Batch Drafting Completed', `Successfully drafted ${res.draftedCount} stories (${res.failedCount} failed).`);
            selectedIds.value = [];
            await Promise.all([fetchStats(), fetchItems()]);
          } catch (err) {
            notify.error('Batch Draft Failed', err.message);
          }
        },
      });
    };

    const dismissStory = async (item) => {
      try {
        await api.post(`/api/aggregator/dismiss/${item.id}`);
        item.status = 'REJECTED';
        notify.info('Story Dismissed', 'Item moved to dismissed status.');
        fetchStats();
      } catch (err) {
        notify.error('Dismiss Failed', err.message);
      }
    };

    const batchDismiss = () => {
      if (!selectedIds.value.length) return;
      confirmDialog({
        message: `Dismiss ${selectedIds.value.length} selected stories?`,
        header: 'Confirm Batch Dismiss',
        icon: 'fa-solid fa-trash-can',
        accept: async () => {
          try {
            await api.post('/api/aggregator/batch-dismiss', { ids: selectedIds.value });
            notify.info('Batch Dismissed', `${selectedIds.value.length} stories dismissed.`);
            selectedIds.value = [];
            await Promise.all([fetchStats(), fetchItems()]);
          } catch (err) {
            notify.error('Dismiss Failed', err.message);
          }
        },
      });
    };

    const openEditor = (articleId) => {
      router.push(`/reporter/edit/${articleId}`);
    };

    const openPreview = (item) => {
      previewModal.item = item;
      previewModal.show = true;
    };

    const publishFromModal = async () => {
      if (!previewModal.item?.articleId) return;
      previewModal.publishing = true;
      try {
        await api.post(`/api/articles/${previewModal.item.articleId}/publish`);
        notify.success('Article Published', 'The story is now live on the public newspaper!');
        previewModal.item.status = 'PUBLISHED';
        if (previewModal.item.article) previewModal.item.article.status = 'PUBLISHED';
        previewModal.show = false;
        fetchStats();
      } catch (err) {
        notify.error('Publish Failed', err.message);
      } finally {
        previewModal.publishing = false;
      }
    };

    const toggleSelect = (id) => {
      const idx = selectedIds.value.indexOf(id);
      if (idx === -1) selectedIds.value.push(id);
      else selectedIds.value.splice(idx, 1);
    };

    const isAllSelected = computed(() => {
      return items.value.length > 0 && items.value.every((it) => selectedIds.value.includes(it.id));
    });

    const toggleSelectAll = () => {
      if (isAllSelected.value) {
        selectedIds.value = [];
      } else {
        selectedIds.value = items.value.map((it) => it.id);
      }
    };

    const setRegion = (reg) => {
      activeRegion.value = reg;
      page.value = 1;
      fetchItems();
    };

    const cleaning = ref(false);
    const cleanDuplicates = async () => {
      cleaning.value = true;
      try {
        const res = await api.post('/api/aggregator/deduplicate');
        notify.success('Deduplication Complete', `Cleaned ${res.cleanedCount} duplicate stories. ${res.remainingCount} unique stories active.`);
        await Promise.all([fetchStats(), fetchItems()]);
      } catch (err) {
        notify.error('Deduplication Failed', err.message);
      } finally {
        cleaning.value = false;
      }
    };

    const getItemRegion = (it) => {
      if (it.rawData?.region) return it.rawData.region.toLowerCase();
      const cat = (it.category || '').toLowerCase();
      if (cat === 'jigawa' || cat === 'buji') return 'jigawa';
      if (cat === 'africa') return 'africa';
      if (cat === 'world') return 'world';
      const name = it.sourceName || '';
      if (name.includes('Jigawa') || name.includes('Dutse') || name.includes('Daily Trust')) return 'jigawa';
      if (name.includes('Africa')) return 'africa';
      if (name.includes('World') || name.includes('Al Jazeera')) return 'world';
      return 'nigeria';
    };

    const getRegionBadgeClass = (reg) => {
      switch (reg) {
        case 'jigawa': return 'badge-jigawa';
        case 'africa': return 'badge-africa';
        case 'world': return 'badge-world';
        default: return 'badge-nigeria';
      }
    };

    const getRegionLabel = (reg) => {
      switch (reg) {
        case 'jigawa': return 'Jigawa State';
        case 'africa': return 'Africa';
        case 'world': return 'Global';
        default: return 'Nigeria';
      }
    };

    onMounted(async () => {
      await Promise.all([fetchStatus(), fetchStats(), fetchItems()]);
      pollTimer = setInterval(fetchStatus, 30000);
    });

    onUnmounted(() => {
      if (pollTimer) clearInterval(pollTimer);
    });

    watch([activeStatus, activeSource], () => {
      page.value = 1;
      fetchItems();
    });

    return {
      router,
      items,
      stats,
      activeRegion,
      activeStatus,
      activeSource,
      searchQuery,
      page,
      pageSize,
      total,
      totalPages,
      loading,
      scanning,
      cleaning,
      generatingId,
      selectedIds,
      viewMode,
      engine,
      previewModal,
      sourcesList,
      scanFeeds,
      cleanDuplicates,
      togglePause,
      draftStory,
      batchDraft,
      dismissStory,
      batchDismiss,
      openEditor,
      openPreview,
      publishFromModal,
      toggleSelect,
      isAllSelected,
      toggleSelectAll,
      setRegion,
      getItemRegion,
      getRegionBadgeClass,
      getRegionLabel,
      fetchItems,
      timeAgo,
    };
  },
  template: `
    <dash-shell title="Hybrid News Aggregator">
      <div class="aggregator-page">
        <!-- Header & Engine Bar -->
        <div class="aggregator-header-box">
          <div class="header-titles">
            <h1 class="page-main-title">
              <i class="fa-solid fa-satellite-dish" style="color:var(--accent);margin-right:8px;"></i>
              Hybrid News Aggregator
            </h1>
            <p class="page-sub-text">
              Multi-tier real-time news aggregation across <strong>Jigawa State</strong>, <strong>Nigeria</strong>, <strong>Africa</strong>, and <strong>World</strong> feeds.
              Synthesize original, in-depth reports with AI and publish under editorial supervision.
            </p>
          </div>

          <div class="header-engine-status">
            <div class="engine-time-chip" title="West Africa Time (UTC+1)">
              <i class="fa-regular fa-clock"></i>
              <span>{{ engine.currentTimeWat || 'WAT Lagos' }}</span>
            </div>

            <div class="engine-state-chip" :class="engine.isPaused ? 'chip-paused' : engine.inWindow ? 'chip-active' : 'chip-standby'">
              <span class="status-pulse-dot" :class="engine.isPaused ? 'dot-paused' : engine.inWindow ? 'dot-active' : 'dot-standby'"></span>
              <span>{{ engine.isPaused ? 'Engine Paused' : engine.inWindow ? 'Scan Window Active' : 'Window Standby' }}</span>
            </div>

            <div class="engine-actions-group">
              <button class="btn btn-primary" :disabled="scanning" @click="scanFeeds">
                <i :class="scanning ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-rotate'" aria-hidden="true"></i>
                <span>{{ scanning ? 'Scanning Feeds…' : 'Scan Feeds Now' }}</span>
              </button>
              <button class="btn ghost btn-sm" @click="togglePause" :title="engine.isPaused ? 'Resume scheduled scans' : 'Pause scheduled scans'">
                <i :class="engine.isPaused ? 'fa-solid fa-play text-success' : 'fa-solid fa-pause text-warning'"></i>
                <span>{{ engine.isPaused ? 'Resume' : 'Pause' }}</span>
              </button>
            </div>
          </div>
        </div>

        <!-- Metrics Cards -->
        <div class="aggregator-stats-grid">
          <div class="agg-metric-card">
            <div class="metric-icon" style="background:#e0f2fe;color:#0284c7;"><i class="fa-solid fa-layer-group"></i></div>
            <div class="metric-data">
              <div class="metric-num">{{ stats.total || 0 }}</div>
              <div class="metric-lbl">Total Sourced</div>
            </div>
          </div>

          <div class="agg-metric-card" @click="setRegion('jigawa')" style="cursor:pointer;" :class="{ 'card-active-reg': activeRegion === 'jigawa' }">
            <div class="metric-icon" style="background:#dcfce7;color:#16a34a;"><i class="fa-solid fa-location-dot"></i></div>
            <div class="metric-data">
              <div class="metric-num">{{ stats.jigawa || 0 }}</div>
              <div class="metric-lbl">Jigawa State</div>
            </div>
          </div>

          <div class="agg-metric-card" @click="setRegion('nigeria')" style="cursor:pointer;" :class="{ 'card-active-reg': activeRegion === 'nigeria' }">
            <div class="metric-icon" style="background:#e0e7ff;color:#4f46e5;"><i class="fa-solid fa-flag"></i></div>
            <div class="metric-data">
              <div class="metric-num">{{ stats.nigeria || 0 }}</div>
              <div class="metric-lbl">Nigeria</div>
            </div>
          </div>

          <div class="agg-metric-card" @click="setRegion('africa')" style="cursor:pointer;" :class="{ 'card-active-reg': activeRegion === 'africa' }">
            <div class="metric-icon" style="background:#fef3c7;color:#d97706;"><i class="fa-solid fa-earth-africa"></i></div>
            <div class="metric-data">
              <div class="metric-num">{{ stats.africa || 0 }}</div>
              <div class="metric-lbl">Africa</div>
            </div>
          </div>

          <div class="agg-metric-card" @click="setRegion('world')" style="cursor:pointer;" :class="{ 'card-active-reg': activeRegion === 'world' }">
            <div class="metric-icon" style="background:#f3e8ff;color:#9333ea;"><i class="fa-solid fa-globe"></i></div>
            <div class="metric-data">
              <div class="metric-num">{{ stats.world || 0 }}</div>
              <div class="metric-lbl">Global</div>
            </div>
          </div>

          <div class="agg-metric-card">
            <div class="metric-icon" style="background:#ecfdf5;color:#059669;"><i class="fa-solid fa-pen-nib"></i></div>
            <div class="metric-data">
              <div class="metric-num">{{ stats.drafted || 0 }}</div>
              <div class="metric-lbl">Ready Drafts</div>
            </div>
          </div>
        </div>

        <!-- Regional Filter Tabs -->
        <div class="aggregator-nav-tabs">
          <button class="nav-tab-btn" :class="{ 'active': activeRegion === 'all' }" @click="setRegion('all')">
            <i class="fa-solid fa-globe"></i>
            <span>All Regions</span>
            <span class="tab-badge">{{ stats.total || 0 }}</span>
          </button>
          <button class="nav-tab-btn" :class="{ 'active': activeRegion === 'jigawa' }" @click="setRegion('jigawa')">
            <i class="fa-solid fa-location-dot" style="color:#16a34a;"></i>
            <span>Jigawa (Local)</span>
            <span class="tab-badge badge-green">{{ stats.jigawa || 0 }}</span>
          </button>
          <button class="nav-tab-btn" :class="{ 'active': activeRegion === 'nigeria' }" @click="setRegion('nigeria')">
            <i class="fa-solid fa-flag" style="color:#2563eb;"></i>
            <span>Nigeria (National)</span>
            <span class="tab-badge badge-blue">{{ stats.nigeria || 0 }}</span>
          </button>
          <button class="nav-tab-btn" :class="{ 'active': activeRegion === 'africa' }" @click="setRegion('africa')">
            <i class="fa-solid fa-earth-africa" style="color:#d97706;"></i>
            <span>Africa (Continental)</span>
            <span class="tab-badge badge-amber">{{ stats.africa || 0 }}</span>
          </button>
          <button class="nav-tab-btn" :class="{ 'active': activeRegion === 'world' }" @click="setRegion('world')">
            <i class="fa-solid fa-earth-americas" style="color:#9333ea;"></i>
            <span>World (Global)</span>
            <span class="tab-badge badge-purple">{{ stats.world || 0 }}</span>
          </button>
        </div>

        <!-- Filter & Search Toolbar -->
        <div class="aggregator-toolbar">
          <div class="toolbar-left">
            <div class="search-input-box">
              <i class="fa-solid fa-magnifying-glass search-icon"></i>
              <input
                type="text"
                v-model="searchQuery"
                @keyup.enter="fetchItems"
                placeholder="Search headline or topic..."
                class="form-input search-input"
              />
              <button v-if="searchQuery" class="clear-search-btn" @click="searchQuery=''; fetchItems();">
                <i class="fa-solid fa-xmark"></i>
              </button>
            </div>

            <select v-model="activeSource" class="form-select filter-select">
              <option value="">All Sources (15 feeds)</option>
              <option v-for="s in sourcesList" :key="s" :value="s">{{ s }}</option>
            </select>

            <select v-model="activeStatus" class="form-select filter-select">
              <option value="ALL">All Statuses</option>
              <option value="DISCOVERED">Discovered (Ready to Draft)</option>
              <option value="DRAFTED">Drafted (Ready to Edit)</option>
              <option value="PUBLISHED">Published</option>
            </select>
          </div>

          <div class="toolbar-right">
            <div class="view-switch-btns">
              <button class="view-btn" :class="{ 'active': viewMode === 'grid' }" @click="viewMode='grid'" title="Card Grid View">
                <i class="fa-solid fa-grip"></i>
              </button>
              <button class="view-btn" :class="{ 'active': viewMode === 'list' }" @click="viewMode='list'" title="Table List View">
                <i class="fa-solid fa-list"></i>
              </button>
            </div>

            <button class="btn ghost btn-sm" :disabled="cleaning" @click="cleanDuplicates" title="Clean duplicate stories across feeds">
              <i :class="cleaning ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-broom'" style="color:var(--accent);"></i>
              <span>{{ cleaning ? 'Cleaning…' : 'Clean Duplicates' }}</span>
            </button>

            <button class="btn ghost btn-sm" @click="fetchItems" title="Refresh list">
              <i class="fa-solid fa-rotate-right"></i>
            </button>
          </div>

        </div>

        <!-- Batch Operations Bar (when items selected) -->
        <div v-if="selectedIds.length > 0" class="batch-action-bar animate-fade-in">
          <div class="batch-count-info">
            <i class="fa-solid fa-check-double" style="color:var(--accent);"></i>
            <span><strong>{{ selectedIds.length }}</strong> stories selected</span>
          </div>

          <div class="batch-buttons">
            <button class="btn btn-primary btn-sm" @click="batchDraft">
              <i class="fa-solid fa-wand-magic-sparkles"></i>
              <span>Batch Draft with AI ({{ selectedIds.length }})</span>
            </button>
            <button class="btn ghost btn-sm text-danger" @click="batchDismiss">
              <i class="fa-solid fa-trash-can"></i>
              <span>Dismiss Selected</span>
            </button>
            <button class="btn ghost btn-sm" @click="selectedIds = []">
              <span>Clear</span>
            </button>
          </div>
        </div>

        <!-- Loading State -->
        <div v-if="loading" class="aggregator-loading-box">
          <i class="fa-solid fa-spinner fa-spin" style="font-size:2rem;color:var(--accent);"></i>
          <p style="margin-top:12px;color:var(--ink-3);">Loading aggregated news feed...</p>
        </div>

        <!-- Empty State -->
        <div v-else-if="!items.length" class="aggregator-empty-box">
          <div class="empty-icon-circle"><i class="fa-solid fa-rss"></i></div>
          <h3>No stories found for current filter</h3>
          <p>Click "Scan Feeds Now" above to capture live stories across Jigawa, Nigeria, Africa, and Global feeds.</p>
          <button class="btn btn-primary" style="margin-top:16px;" @click="scanFeeds">
            <i class="fa-solid fa-rotate"></i> Scan Feeds Now
          </button>
        </div>

        <!-- Feed Cards Grid View -->
        <div v-else-if="viewMode === 'grid'" class="aggregator-grid">
          <div
            v-for="item in items"
            :key="item.id"
            class="story-card"
            :class="{
              'card-selected': selectedIds.includes(item.id),
              'card-drafted': item.status === 'DRAFTED',
              'card-published': item.status === 'PUBLISHED'
            }"
          >
            <!-- Card Header: Checkbox, Region Badge & Source -->
            <div class="story-card-top">
              <label class="custom-checkbox-container" @click.stop>
                <input
                  type="checkbox"
                  :checked="selectedIds.includes(item.id)"
                  @change="toggleSelect(item.id)"
                />
                <span class="custom-checkmark"></span>
              </label>

              <span class="region-pill" :class="getRegionBadgeClass(getItemRegion(item))">
                {{ getRegionLabel(getItemRegion(item)) }}
              </span>

              <span class="source-tag" :title="item.sourceName">
                {{ item.sourceName }}
              </span>
            </div>

            <!-- Thumbnail Image -->
            <div class="story-card-image-wrap">
              <img
                v-if="item.article?.featuredImage || item.rawData?.originalImageUrl || item.rawData?.imageUrl || item.imageUrl"
                :src="item.article?.featuredImage || item.rawData?.originalImageUrl || item.rawData?.imageUrl || item.imageUrl"
                :alt="item.sourceTitle || item.title"
                loading="lazy"
                class="story-card-img"
              />

              <div v-else class="story-card-img-placeholder">
                <i class="fa-solid fa-newspaper" aria-hidden="true"></i>
              </div>

              <!-- Status Tag Overlay -->
              <div class="story-status-overlay">
                <span v-if="item.status === 'DRAFTED'" class="status-pill status-pill-drafted">
                  <i class="fa-solid fa-file-lines"></i> Drafted
                </span>
                <span v-else-if="item.status === 'PUBLISHED'" class="status-pill status-pill-published">
                  <i class="fa-solid fa-check"></i> Published
                </span>
                <span v-else class="status-pill status-pill-discovered">
                  <i class="fa-solid fa-bolt"></i> Discovered
                </span>
              </div>
            </div>

            <!-- Card Body -->
            <div class="story-card-content">
              <div class="story-card-meta">
                <span class="meta-time">
                  <i class="fa-regular fa-clock"></i>
                  {{ timeAgo(item.rawData?.publishedAt || item.createdAt) }}
                </span>
              </div>

              <h3 class="story-card-title" :title="item.sourceTitle || item.title">
                {{ item.sourceTitle || item.title }}
              </h3>

              <p class="story-card-snippet">
                {{ (item.rawData?.snippet || item.content || '').slice(0, 160) }}...
              </p>
            </div>

            <!-- Card Actions Footer -->
            <div class="story-card-actions">
              <div class="action-left">
                <a
                  :href="item.sourceUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="action-link-btn"
                  title="View original article on publisher site"
                >
                  <i class="fa-solid fa-arrow-up-right-from-square"></i>
                </a>
              </div>

              <div class="action-right">
                <!-- If Drafted: Edit & Publish / Preview -->
                <template v-if="item.status === 'DRAFTED'">
                  <button class="btn btn-sm btn-outline-success" @click="openPreview(item)">
                    <i class="fa-solid fa-eye"></i> Preview
                  </button>
                  <button class="btn btn-sm btn-success" @click="openEditor(item.articleId)">
                    <i class="fa-solid fa-pen-to-square"></i> Edit & Publish
                  </button>
                </template>

                <!-- If Published: View Live -->
                <template v-else-if="item.status === 'PUBLISHED'">
                  <router-link
                    v-if="item.article?.slug"
                    :to="'/news/' + item.article.slug"
                    class="btn btn-sm ghost text-success"
                    target="_blank"
                  >
                    <i class="fa-solid fa-globe"></i> View Live
                  </router-link>
                </template>

                <!-- If Discovered: Draft with AI -->
                <template v-else>
                  <button
                    class="btn btn-sm btn-primary"
                    :disabled="generatingId === item.id"
                    @click="draftStory(item)"
                  >
                    <i :class="generatingId === item.id ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-wand-magic-sparkles'"></i>
                    <span>{{ generatingId === item.id ? 'Drafting…' : 'Draft with AI' }}</span>
                  </button>
                </template>

                <button class="btn ghost btn-sm btn-icon" @click="dismissStory(item)" title="Dismiss story">
                  <i class="fa-solid fa-xmark text-muted"></i>
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Feed Table List View -->
        <div v-else class="aggregator-table-wrap">
          <table class="aggregator-table">
            <thead>
              <tr>
                <th style="width:36px;">
                  <label class="custom-checkbox-container">
                    <input type="checkbox" :checked="isAllSelected" @change="toggleSelectAll" />
                    <span class="custom-checkmark"></span>
                  </label>
                </th>
                <th style="width:70px;">Media</th>
                <th>Story Headline & Source</th>
                <th style="width:110px;">Region</th>
                <th style="width:110px;">Status</th>
                <th style="width:110px;">Discovered</th>
                <th style="width:180px;text-align:right;">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="item in items"
                :key="item.id"
                :class="{ 'row-selected': selectedIds.includes(item.id) }"
              >
                <td>
                  <label class="custom-checkbox-container">
                    <input type="checkbox" :checked="selectedIds.includes(item.id)" @change="toggleSelect(item.id)" />
                    <span class="custom-checkmark"></span>
                  </label>
                </td>
                <td>
                  <div class="table-thumb">
                    <img
                      v-if="item.article?.featuredImage || item.rawData?.originalImageUrl || item.rawData?.imageUrl || item.imageUrl"
                      :src="item.article?.featuredImage || item.rawData?.originalImageUrl || item.rawData?.imageUrl || item.imageUrl"
                      class="table-thumb-img"
                    />
                    <i v-else class="fa-solid fa-newspaper text-muted"></i>
                  </div>

                </td>
                <td>
                  <div class="table-title">{{ item.sourceTitle || item.title }}</div>
                  <div class="table-sub-source">
                    <span class="source-name">{{ item.sourceName }}</span>
                    <a :href="item.sourceUrl" target="_blank" rel="noopener noreferrer" class="source-ext-link">
                      <i class="fa-solid fa-arrow-up-right-from-square"></i>
                    </a>
                  </div>
                </td>
                <td>
                  <span class="region-pill" :class="getRegionBadgeClass(getItemRegion(item))">
                    {{ getRegionLabel(getItemRegion(item)) }}
                  </span>
                </td>
                <td>
                  <span v-if="item.status === 'DRAFTED'" class="status-pill status-pill-drafted">Drafted</span>
                  <span v-else-if="item.status === 'PUBLISHED'" class="status-pill status-pill-published">Published</span>
                  <span v-else class="status-pill status-pill-discovered">Discovered</span>
                </td>
                <td style="font-size:12px;color:var(--ink-4);">
                  {{ timeAgo(item.rawData?.publishedAt || item.createdAt) }}
                </td>
                <td style="text-align:right;">
                  <template v-if="item.status === 'DRAFTED'">
                    <button class="btn btn-xs btn-success" @click="openEditor(item.articleId)">
                      <i class="fa-solid fa-pen-to-square"></i> Edit
                    </button>
                  </template>
                  <template v-else-if="item.status === 'PUBLISHED'">
                    <router-link v-if="item.article?.slug" :to="'/news/' + item.article.slug" class="btn btn-xs ghost text-success" target="_blank">
                      Live
                    </router-link>
                  </template>
                  <template v-else>
                    <button
                      class="btn btn-xs btn-primary"
                      :disabled="generatingId === item.id"
                      @click="draftStory(item)"
                    >
                      <i :class="generatingId === item.id ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-wand-magic-sparkles'"></i>
                      Draft
                    </button>
                  </template>
                  <button class="btn btn-xs ghost btn-icon" @click="dismissStory(item)" title="Dismiss">
                    <i class="fa-solid fa-xmark"></i>
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Pagination -->
        <div class="aggregator-pagination-bar" v-if="total > 0">
          <div class="pagination-info">
            Showing {{ ((page - 1) * pageSize) + 1 }} to {{ Math.min(page * pageSize, total) }} of {{ total }} stories
          </div>
          <div class="pagination-controls">
            <button class="btn ghost btn-sm" :disabled="page <= 1" @click="page--; fetchItems();">
              <i class="fa-solid fa-chevron-left"></i> Previous
            </button>
            <span class="pagination-current-page">Page {{ page }} of {{ totalPages }}</span>
            <button class="btn ghost btn-sm" :disabled="page >= totalPages" @click="page++; fetchItems();">
              Next <i class="fa-solid fa-chevron-right"></i>
            </button>
          </div>
        </div>

        <!-- Article Preview & Quick Publish Modal -->
        <Dialog
          v-model:visible="previewModal.show"
          modal
          header="AI Generated Draft Preview"
          :style="{ width: '820px', maxWidth: '95vw' }"
        >
          <div v-if="previewModal.item?.article" style="padding: 10px 0;">
            <div v-if="previewModal.item.article.featuredImage" style="margin-bottom:16px;border-radius:8px;overflow:hidden;max-height:340px;">
              <img :src="previewModal.item.article.featuredImage" style="width:100%;height:auto;object-fit:cover;" />
              <div v-if="previewModal.item.article.imageCaption" style="font-size:12px;color:var(--ink-4);padding:6px 0;">
                <i class="fa-solid fa-camera"></i> {{ previewModal.item.article.imageCaption }}
              </div>
            </div>

            <h2 style="font-size:1.4rem;font-weight:700;line-height:1.3;margin-bottom:12px;">
              {{ previewModal.item.article.title }}
            </h2>

            <div style="display:flex;gap:12px;font-size:12px;color:var(--ink-4);margin-bottom:16px;">
              <span><strong>Source:</strong> {{ previewModal.item.sourceName }}</span>
              <span><strong>Status:</strong> {{ previewModal.item.article.status }}</span>
              <span><strong>Category:</strong> {{ previewModal.item.category }}</span>
            </div>

            <div
              v-html="previewModal.item.article.content"
              style="line-height:1.7;font-size:14px;color:var(--ink-2);max-height:380px;overflow-y:auto;padding-right:10px;border-top:1px solid var(--line-1);padding-top:16px;"
            ></div>
          </div>

          <template #footer>
            <div style="display:flex;justify-content:space-between;width:100%;align-items:center;">
              <button class="btn ghost" @click="previewModal.show = false">Close</button>
              <div style="display:flex;gap:8px;">
                <button
                  class="btn ghost text-primary"
                  @click="openEditor(previewModal.item.articleId); previewModal.show = false;"
                >
                  <i class="fa-solid fa-pen-to-square"></i> Open Full Editor
                </button>
                <button
                  class="btn btn-success"
                  :disabled="previewModal.publishing"
                  @click="publishFromModal"
                >
                  <i :class="previewModal.publishing ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-check'"></i>
                  <span>Publish to Website</span>
                </button>
              </div>
            </div>
          </template>
        </Dialog>
      </div>
    </dash-shell>
  `,
  components: { DashShell },
});

// -----------------------------------------------------------------------
// EDITOR DASHBOARD
// -----------------------------------------------------------------------

export const EditorQueue = defineComponent({
  setup() {
    const groups = reactive({ SUBMITTED: [], IN_REVIEW: [], REVISION_REQUIRED: [], APPROVED: [], PUBLISHED: [] });
    const load   = async () => {
      for (const status of Object.keys(groups)) {
        groups[status] = (await api.get(`/api/articles?status=${status}&pageSize=20`)).items;
      }
    };
    onMounted(load);
    const act = async (a, action) => {
      try {
        await api.post(`/api/articles/${a.id}/${action}`);
        notify.success('Editorial Action Completed', `Article moved to ${action.replace(/-/g, ' ')}.`);
        load();
      }
      catch (e) {
        notify.error('Action Failed', e.message);
      }
    };
    return { groups, act, timeAgo };
  },
  template: `
    <dash-shell title="Editorial Queue">
      <div class="queue-group" v-for="(list, status) in groups" :key="status">
        <div class="queue-group-head">
          <span :class="'badge status-'+status">{{ status.replace(/_/g,' ') }}</span>
          <span class="queue-group-count">{{ list.length }}</span>
        </div>
        <div v-if="!list.length" class="muted" style="font-size:var(--text-sm);padding:var(--s3) 0;"><i class="fa-solid fa-check" aria-hidden="true" style="margin-right:5px;color:var(--green);"></i>Nothing here.</div>
        <div class="table-wrap" v-else>
          <table :aria-label="status.replace(/_/g,' ')+' articles'">
            <thead>
              <tr>
                <th>Title</th>
                <th>Reporter</th>
                <th>Updated</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="a in list" :key="a.id">
                <td class="td-title"><router-link :to="'/news/'+a.slug" target="_blank">{{ a.title }}</router-link></td>
                <td class="muted">{{ a.author?.name }}</td>
                <td class="muted" style="white-space:nowrap;font-size:var(--text-xs);">{{ timeAgo(a.updatedAt) }}</td>
                <td>
                  <div class="action-btns">
                    <router-link class="icon-btn" :to="'/reporter/edit/'+a.id" title="Open in editor" aria-label="Edit article">
                      <i class="fa-solid fa-pen" aria-hidden="true"></i>
                    </router-link>
                    <button v-if="status==='SUBMITTED'" class="icon-btn blue" @click="act(a,'review')" title="Start review" aria-label="Start review">
                      <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
                    </button>
                    <button v-if="status==='IN_REVIEW'||status==='SUBMITTED'" class="icon-btn accent" @click="act(a,'request-revision')" title="Request revision" aria-label="Request revision">
                      <i class="fa-solid fa-rotate-left" aria-hidden="true"></i>
                    </button>
                    <button v-if="status==='IN_REVIEW'" class="icon-btn success" @click="act(a,'approve')" title="Approve" aria-label="Approve article">
                      <i class="fa-solid fa-check" aria-hidden="true"></i>
                    </button>
                    <button v-if="status==='APPROVED'||status==='IN_REVIEW'" class="icon-btn success" @click="act(a,'publish')" title="Publish" aria-label="Publish article" style="background:var(--green-bg);color:var(--green);">
                      <i class="fa-solid fa-cloud-arrow-up" aria-hidden="true"></i>
                    </button>
                    <button v-if="status==='PUBLISHED'" class="icon-btn accent" @click="act(a,'unpublish')" title="Unpublish" aria-label="Unpublish article">
                      <i class="fa-solid fa-cloud-arrow-down" aria-hidden="true"></i>
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </dash-shell>
  `,
  components: { DashShell },
});

// -----------------------------------------------------------------------
// REPORTER DASHBOARD
// -----------------------------------------------------------------------

export const ReporterHome = defineComponent({
  setup() {
    const items   = ref([]);
    const loading = ref(true);
    onMounted(async () => {
      try {
        items.value = (await api.get('/api/articles?mine=true&pageSize=50')).items || [];
      } catch {
        items.value = [];
      } finally {
        loading.value = false;
      }
    });
    const submitForReview = async (a) => {
      if (!a || !a.id) return;
      confirmDialog({
        header: 'Submit for Review',
        message: `Submit "${a.title}" to editors for review?`,
        icon: 'pi pi-send',
        acceptLabel: 'Submit Story',
        acceptSeverity: 'primary',
        onAccept: async () => {
          try {
            await api.post(`/api/articles/${a.id}/submit`);
            notify.success('Story Submitted', `"${a.title}" was submitted to editors.`);
            const res = await api.get('/api/articles?mine=true&pageSize=50');
            items.value = res?.items || [];
          } catch (e) {
            notify.error('Submission Failed', e.message || 'Could not submit story for review.');
          }
        },
      });
    };
    const counts = computed(() => {
      const c = { total: items.value.length, published: 0, views: 0, drafts: 0 };
      items.value.forEach(a => {
        if (a.status === 'PUBLISHED') c.published++;
        if (a.status === 'DRAFT') c.drafts++;
        c.views += a.views || 0;
      });
      return c;
    });
    return { items, loading, submitForReview, counts, timeAgo };
  },
  template: `
    <dash-shell title="My Stories">
      <!-- Stats -->
      <div class="stat-grid" style="grid-template-columns:repeat(3,1fr);">
        <div class="stat-card">
          <div class="stat-card-top"><div class="stat-icon brand"><i class="fa-solid fa-pen-to-square" aria-hidden="true"></i></div></div>
          <div class="stat-num">{{ counts.total }}</div>
          <div class="stat-label">Total Stories</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-top"><div class="stat-icon green"><i class="fa-solid fa-circle-check" aria-hidden="true"></i></div></div>
          <div class="stat-num">{{ counts.published }}</div>
          <div class="stat-label">Published</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-top"><div class="stat-icon violet"><i class="fa-solid fa-eye" aria-hidden="true"></i></div></div>
          <div class="stat-num">{{ counts.views.toLocaleString() }}</div>
          <div class="stat-label">Total Views</div>
        </div>
      </div>

      <!-- Action -->
      <div style="margin-bottom:var(--s6);">
        <router-link class="btn accent" to="/reporter/new">
          <i class="fa-solid fa-circle-plus" aria-hidden="true"></i> New Story
        </router-link>
      </div>

      <!-- Stories table -->
      <div v-if="loading" class="state-block">
        <div class="state-icon"><i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i></div>
        <p>Loading your stories&hellip;</p>
      </div>
      <div v-else-if="!items.length" class="state-block">
        <div class="state-icon"><i class="fa-solid fa-pen-to-square" aria-hidden="true"></i></div>
        <h2>No stories yet</h2>
        <p>Create your first story to get started.</p>
        <router-link class="btn accent" to="/reporter/new"><i class="fa-solid fa-plus" aria-hidden="true"></i> Create First Story</router-link>
      </div>
      <div v-else class="table-wrap">
        <table aria-label="My articles">
          <thead>
            <tr>
              <th>Title</th>
              <th>Status</th>
              <th>Views</th>
              <th>Updated</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="a in items" :key="a.id">
              <td class="td-title">{{ a.title }}</td>
              <td><span :class="'badge status-'+a.status">{{ a.status.replace(/_/g,' ') }}</span></td>
              <td class="muted"><i class="fa-regular fa-eye" aria-hidden="true" style="margin-right:3px;"></i>{{ (a.views||0).toLocaleString() }}</td>
              <td class="muted" style="white-space:nowrap;font-size:var(--text-xs);">{{ timeAgo(a.updatedAt) }}</td>
              <td>
                <div class="action-btns">
                  <router-link class="icon-btn" :to="'/reporter/edit/'+a.id" title="Edit story" aria-label="Edit story">
                    <i class="fa-solid fa-pen" aria-hidden="true"></i>
                  </router-link>
                  <button v-if="a.status==='DRAFT'||a.status==='REVISION_REQUIRED'" class="icon-btn blue" @click="submitForReview(a)" title="Submit for review" :aria-label="'Submit '+a.title+' for review'">
                    <i class="fa-solid fa-paper-plane" aria-hidden="true"></i>
                  </button>
                  <router-link v-if="a.status==='PUBLISHED'" class="icon-btn success" :to="'/news/'+a.slug" target="_blank" title="View published article" :aria-label="'View published: '+a.title">
                    <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i>
                  </router-link>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </dash-shell>
  `,
  components: { DashShell },
});

// ARTICLE EDITOR
export const ArticleEditor = defineComponent({
  setup() {
    const route  = useRoute();
    const router = useRouter();
    const isNew  = computed(() => !route.params.id);
    const form   = reactive({
      id: null, title: '', excerpt: '', content: '',
      categoryId: '', featuredImage: '', imageCaption: '',
      tags: '', isBreaking: false, isFeatured: false, status: 'DRAFT',
    });
    const error          = ref('');
    const loading        = ref(false);
    const loadingArticle = ref(!isNew.value);

    onMounted(async () => {
      if (!isNew.value) {
        const articleId = parseInt(route.params.id);
        if (articleId && !isNaN(articleId)) {
          form.id = articleId;
        }

        try {
          // 1. Fetch the article directly by ID (handles articles by any author for staff)
          const res = await api.get(`/api/articles/by-id/${route.params.id}`);
          if (res?.article) {
            const found = res.article;
            Object.assign(form, {
              id: found.id, title: found.title, excerpt: found.excerpt || '',
              content: found.content, categoryId: found.category?.id || '',
              featuredImage: found.featuredImage || '', imageCaption: found.imageCaption || '',
              tags: (found.tags || []).map(t => t.name).join(', '),
              isBreaking: found.isBreaking, isFeatured: found.isFeatured, status: found.status,
            });
          }
        } catch {
          // 2. Fallback: check my articles
          try {
            const mine = (await api.get('/api/articles?mine=true&pageSize=100')).items;
            const found = mine?.find(a => String(a.id) === String(route.params.id));
            if (found) {
              Object.assign(form, {
                id: found.id, title: found.title, excerpt: found.excerpt || '',
                content: found.content, categoryId: found.category?.id || '',
                featuredImage: found.featuredImage || '', imageCaption: found.imageCaption || '',
                tags: (found.tags || []).map(t => t.name).join(', '),
                isBreaking: found.isBreaking, isFeatured: found.isFeatured, status: found.status,
              });
            }
          } catch {}
        }
        loadingArticle.value = false;
      }
    });

    const save = async () => {
      error.value = ''; loading.value = true;
      try {
        const payload = {
          title: form.title, excerpt: form.excerpt, content: form.content,
          categoryId: form.categoryId, featuredImage: form.featuredImage,
          imageCaption: form.imageCaption, isBreaking: form.isBreaking,
          isFeatured: form.isFeatured,
          tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
        };
        if (isNew.value) {
          const { article } = await api.post('/api/articles', payload);
          form.id = article.id;
          form.status = article.status;
          router.push(`/reporter/edit/${article.id}`);
        } else {
          if (!form.id) throw new Error('Cannot update story without a valid ID.');
          await api.put(`/api/articles/${form.id}`, payload);
        }
      } catch (e) { error.value = e.message; }
      finally { loading.value = false; }
    };

    const doAction = async (action) => {
      if (!form.id) {
        error.value = 'Please save the story before performing workflow actions.';
        return;
      }
      loading.value = true;
      try {
        await api.post(`/api/articles/${form.id}/${action}`);
        const dest = store.user.role === 'REPORTER' ? '/reporter' : store.user.role === 'EDITOR' ? '/editor' : '/admin';
        router.push(dest);
      } catch (e) { error.value = e.message; }
      finally { loading.value = false; }
    };

    return {
      isNew, form, error, loading, loadingArticle, save, doAction,
      categories: computed(() => store.categories),
      isStaff: computed(() => store.isStaff()),
      store,
    };
  },
  template: `
    <dash-shell :title="isNew ? 'New Story' : 'Edit Story'">
      <div v-if="loadingArticle" class="state-block">
        <div class="state-icon"><i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i></div>
        <p>Loading story&hellip;</p>
      </div>

      <div v-else class="editor-grid">
        <!-- Main form -->
        <div class="editor-main">
          <div class="form-card">
            <div class="form-card-head">
              <h3><i class="fa-solid fa-pen-to-square" aria-hidden="true" style="margin-right:6px;color:var(--accent);"></i>{{ isNew ? 'Write New Story' : 'Edit Story' }}</h3>
            </div>
            <div class="form-card-body">
              <form @submit.prevent="save">
                <!-- Headline -->
                <div class="field">
                  <label for="ed-title">Headline <span style="color:var(--red);" aria-label="required">*</span></label>
                  <input id="ed-title" v-model="form.title" required placeholder="Enter the article headline\u2026" style="font-size:var(--text-lg);font-family:var(--font-serif);" />
                </div>

                <!-- Excerpt/Dek -->
                <div class="field">
                  <label for="ed-excerpt">Dek / Excerpt</label>
                  <textarea id="ed-excerpt" v-model="form.excerpt" rows="2" placeholder="Brief summary shown in article listings and social previews\u2026"></textarea>
                </div>

                <!-- Body -->
                <div class="field">
                  <label for="ed-content">
                    Body
                    <span style="font-weight:400;color:var(--ink-4);margin-left:6px;">(HTML is sanitized on save)</span>
                    <span style="color:var(--red);" aria-label="required"> *</span>
                  </label>
                  <textarea id="ed-content" v-model="form.content" rows="18" required placeholder="Write your story here. You may use basic HTML tags for formatting."></textarea>
                </div>

                <!-- Two-column metadata -->
                <div class="form-two-col">
                  <div class="field">
                    <label for="ed-cat">Category <span style="color:var(--red);" aria-label="required">*</span></label>
                    <select id="ed-cat" v-model="form.categoryId" required>
                      <option value="" disabled>Select category\u2026</option>
                      <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
                    </select>
                  </div>
                  <div class="field">
                    <label for="ed-tags">Tags <span style="font-weight:400;color:var(--ink-4);">(comma-separated)</span></label>
                    <input id="ed-tags" v-model="form.tags" placeholder="e.g. politics, Buji, water, 2025" />
                  </div>
                </div>

                <!-- Image uploader -->
                <div class="field">
                  <label>Featured Image</label>
                  <image-uploader v-model="form.featuredImage" />
                  <div style="margin-top:var(--s3);">
                    <label for="ed-img-url" style="font-weight:400;color:var(--ink-4);font-size:var(--text-xs);margin-bottom:var(--s1);">Or paste an image URL directly</label>
                    <input id="ed-img-url" v-model="form.featuredImage" placeholder="https://\u2026" style="font-size:var(--text-sm);" />
                  </div>
                </div>

                <div class="field" v-if="form.featuredImage">
                  <label for="ed-cap">Image Caption</label>
                  <input id="ed-cap" v-model="form.imageCaption" placeholder="Describe the image for accessibility and credit" />
                </div>

                <!-- Staff flags -->
                <div v-if="isStaff" class="editor-panel" style="margin-bottom:var(--s5);">
                  <div class="editor-panel-title">Story Flags</div>
                  <div class="editor-panel-body" style="padding:var(--s2) var(--s4);">
                    <label class="toggle-field">
                      <input type="checkbox" v-model="form.isBreaking" />
                      <div>
                        <div class="toggle-field-label"><i class="fa-solid fa-bolt" aria-hidden="true" style="color:var(--red);margin-right:4px;"></i> Breaking News</div>
                        <div class="toggle-field-desc">Shows in the breaking news ticker at the top of the site.</div>
                      </div>
                    </label>
                    <label class="toggle-field">
                      <input type="checkbox" v-model="form.isFeatured" />
                      <div>
                        <div class="toggle-field-label"><i class="fa-solid fa-star" aria-hidden="true" style="color:var(--accent);margin-right:4px;"></i> Featured Story</div>
                        <div class="toggle-field-desc">Shows in the homepage hero section.</div>
                      </div>
                    </label>
                  </div>
                </div>

                <!-- Error -->
                <div v-if="error" class="form-error"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> {{ error }}</div>

                <!-- Actions -->
                <div class="form-actions">
                  <button class="btn" type="submit" :disabled="loading">
                    <i :class="loading ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-floppy-disk'" aria-hidden="true"></i>
                    {{ loading ? 'Saving\u2026' : 'Save Draft' }}
                  </button>
                  <button v-if="!isNew && form.id && (form.status==='DRAFT'||form.status==='REVISION_REQUIRED')" type="button" class="btn ghost" :disabled="loading" @click="doAction('submit')">
                    <i class="fa-solid fa-paper-plane" aria-hidden="true"></i> Submit for Review
                  </button>
                  <button v-if="!isNew && form.id && isStaff && form.status==='IN_REVIEW'" type="button" class="btn ghost" :disabled="loading" @click="doAction('approve')">
                    <i class="fa-solid fa-check" aria-hidden="true"></i> Approve
                  </button>
                  <button v-if="!isNew && form.id && isStaff && (form.status==='APPROVED'||form.status==='IN_REVIEW')" type="button" class="btn accent" :disabled="loading" @click="doAction('publish')">
                    <i class="fa-solid fa-cloud-arrow-up" aria-hidden="true"></i> Publish
                  </button>
                  <button v-if="!isNew && form.id && isStaff && form.status==='PUBLISHED'" type="button" class="btn ghost" :disabled="loading" @click="doAction('unpublish')">
                    <i class="fa-solid fa-cloud-arrow-down" aria-hidden="true"></i> Unpublish
                  </button>
                  <button v-if="!isNew && form.id && isStaff" type="button" class="btn danger" :disabled="loading" @click="doAction('archive')" style="margin-left:auto;">
                    <i class="fa-solid fa-box-archive" aria-hidden="true"></i> Archive
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>

        <!-- Sidebar panels -->
        <div class="editor-sidebar">
          <!-- Status -->
          <div class="editor-panel" v-if="!isNew">
            <div class="editor-panel-title">Status</div>
            <div class="editor-panel-body">
              <div class="status-display">
                <span style="font-size:var(--text-sm);color:var(--ink-3);">Current status</span>
                <span :class="'badge status-'+form.status">{{ form.status.replace(/_/g,' ') }}</span>
              </div>
            </div>
          </div>

          <!-- Image preview -->
          <div class="editor-panel" v-if="form.featuredImage">
            <div class="editor-panel-title">Image Preview</div>
            <div class="editor-panel-body" style="padding:0;">
              <img :src="form.featuredImage" :alt="form.imageCaption||'Featured image'" style="width:100%;display:block;" />
              <div v-if="form.imageCaption" style="padding:var(--s2) var(--s4);font-size:var(--text-xs);color:var(--ink-3);">{{ form.imageCaption }}</div>
            </div>
          </div>

          <!-- Tips -->
          <div class="editor-panel">
            <div class="editor-panel-title">Writing Tips</div>
            <div class="editor-panel-body">
              <ul style="font-size:var(--text-xs);color:var(--ink-3);padding-left:16px;line-height:1.7;">
                <li>Use a clear, specific headline that answers who/what/where.</li>
                <li>Keep the dek to 1&ndash;2 sentences summarising the story.</li>
                <li>Use &lt;h2&gt; tags for section breaks in long articles.</li>
                <li>Use &lt;blockquote&gt; tags for pull quotes.</li>
                <li>Credit image sources in the caption field.</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </dash-shell>
  `,
  components: { DashShell, ImageUploader },
});
