import { defineComponent, ref, computed } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { store } from './store.js';
import { api } from './api.js';

// -----------------------------------------------------------------------
// CONSTANTS
// -----------------------------------------------------------------------
const NAV_ITEMS = [
  ['Home', '/'],
  ['Buji', '/category/buji'],
  ['Jigawa', '/category/jigawa'],
  ['Politics & Governance', '/category/politics'],
  ['Business & Development', '/category/business'],
  ['Education & Health', '/category/education'],
  ['Investigations & Opinion', '/category/investigations'],
];

export const ADMIN_NAV = [
  {
    label: 'Newsroom',
    items: [
      { label: 'Overview',      path: '/admin',             icon: 'fa-solid fa-gauge-high' },
      { label: 'AI Newsroom',   path: '/admin/newsroom',    icon: 'fa-solid fa-robot' },
    ],
  },
  {
    label: 'Content',
    items: [
      { label: 'Articles',    path: '/admin/articles',    icon: 'fa-solid fa-newspaper' },
      { label: 'Categories',  path: '/admin/categories',  icon: 'fa-solid fa-tags' },
    ],
  },
  {
    label: 'People',
    items: [
      { label: 'Users',       path: '/admin/users',       icon: 'fa-solid fa-users' },
      { label: 'Comments',    path: '/admin/comments',    icon: 'fa-solid fa-comments' },
    ],
  },
  {
    label: 'Writing',
    items: [
      { label: 'My Stories',  path: '/reporter',          icon: 'fa-solid fa-pen-to-square' },
      { label: 'New Story',   path: '/reporter/new',      icon: 'fa-solid fa-circle-plus' },
    ],
  },
];

export const EDITOR_NAV = [
  {
    label: 'Editorial',
    items: [
      { label: 'Queue',       path: '/editor',            icon: 'fa-solid fa-list-check' },
      { label: 'Comments',    path: '/editor/comments',   icon: 'fa-solid fa-comments' },
    ],
  },
  {
    label: 'Writing',
    items: [
      { label: 'My Stories',  path: '/reporter',          icon: 'fa-solid fa-pen-to-square' },
      { label: 'New Story',   path: '/reporter/new',      icon: 'fa-solid fa-circle-plus' },
    ],
  },
];

export const REPORTER_NAV = [
  {
    label: 'Stories',
    items: [
      { label: 'My Stories',  path: '/reporter',          icon: 'fa-solid fa-pen-to-square' },
      { label: 'New Story',   path: '/reporter/new',      icon: 'fa-solid fa-circle-plus' },
    ],
  },
];

// -----------------------------------------------------------------------
// UTILITIES
// -----------------------------------------------------------------------
export function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
  if (diff < 60)    return 'just now';
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(dateStr).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function readingTime(html) {
  const words = (html || '').replace(/<[^>]*>/g, ' ').trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

// -----------------------------------------------------------------------
// SITE HEADER
// -----------------------------------------------------------------------
export const SiteHeader = defineComponent({
  setup() {
    const q = ref('');
    const menuOpen = ref(false);
    const doSearch = (router) => {
      if (!q.value.trim()) return;
      menuOpen.value = false;
      router.push({ path: '/search', query: { q: q.value.trim() } });
      q.value = '';
    };
    return { q, menuOpen, doSearch, NAV_ITEMS };
  },
  template: `
    <header class="nyt-header">
      <!-- Masthead -->
      <div class="container nyt-masthead">
        <div class="nyt-masthead-rule"></div>
        <router-link to="/" class="nyt-wordmark-link" aria-label="Jigawa Times home">
          <div class="nyt-wordmark">Jigawa <span class="nyt-accent">Times</span></div>
        </router-link>
        <div class="nyt-tagline">ECHOES FROM THE NEW WORLD</div>
        <div class="nyt-masthead-rule"></div>
      </div>

      <!-- Navigation -->
      <nav class="nyt-nav" aria-label="Primary navigation">
        <div class="container nyt-nav-inner">
          <div class="nyt-nav-links" :class="{ 'nyt-nav-open': menuOpen }">
            <div v-if="menuOpen" class="nyt-mobile-nav-head">
              <div class="nyt-wordmark" style="font-size:1.2rem;">Jigawa <span class="nyt-accent">Times</span></div>
              <button @click="menuOpen=false" aria-label="Close navigation" class="close-nav-btn"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
            </div>
            <router-link v-for="[label, path] in NAV_ITEMS" :key="path" :to="path" class="nyt-nav-link" @click="menuOpen=false">
              {{ label }}
            </router-link>
          </div>
          <form class="nyt-search-form" @submit.prevent="doSearch($router)">
            <input type="search" v-model="q" placeholder="Search…" class="nyt-search-input" aria-label="Search Jigawa Times" />
            <button class="nyt-search-btn" type="submit" aria-label="Search"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i></button>
          </form>
          <button class="nyt-nav-toggle" @click="menuOpen=!menuOpen" :aria-expanded="menuOpen" aria-label="Toggle navigation menu">
            <i :class="menuOpen ? 'fa-solid fa-xmark' : 'fa-solid fa-bars'" aria-hidden="true"></i>
          </button>
        </div>
      </nav>
    </header>
  `,
});

// -----------------------------------------------------------------------
// BREAKING NEWS TICKER
// -----------------------------------------------------------------------
export const BreakingTicker = defineComponent({
  props: { items: { type: Array, default: () => [] } },
  template: `
    <div class="nyt-ticker" v-if="items.length" role="marquee" aria-label="Breaking news">
      <div class="container nyt-ticker-inner">
        <span class="nyt-ticker-label"><i class="fa-solid fa-bolt" style="font-size:10px;"></i> BREAKING</span>
        <div class="nyt-ticker-track">
          <div class="nyt-ticker-items">
            <router-link v-for="a in items" :key="'a'+a.id" :to="'/news/'+a.slug"><span class="nyt-ticker-dot">•</span> {{ a.title }}</router-link>
            <router-link v-for="a in items" :key="'b'+a.id" :to="'/news/'+a.slug" aria-hidden="true"><span class="nyt-ticker-dot">•</span> {{ a.title }}</router-link>
          </div>
        </div>
      </div>
    </div>
  `,
});

// -----------------------------------------------------------------------
// ARTICLE CARD (The Athletic Grid Variant)
// -----------------------------------------------------------------------
export const ArticleCard = defineComponent({
  props: { article: Object },
  setup() { return { timeAgo, readingTime }; },
  template: `
    <article class="nyt-story">
      <router-link :to="'/news/'+article.slug" class="nyt-story-media" tabindex="-1">
        <img v-if="article.featuredImage" :src="article.featuredImage" :alt="article.imageCaption||article.title" loading="lazy" />
        <div v-else class="nyt-img-placeholder"><i class="fa-solid fa-newspaper" aria-hidden="true"></i></div>
      </router-link>
      <div class="nyt-story-body">
        <div class="nyt-story-kicker" v-if="article.category?.name">{{ article.category.name }}</div>
        <h3 class="nyt-story-headline"><router-link :to="'/news/'+article.slug">{{ article.title }}</router-link></h3>
        <p class="nyt-story-summary" v-if="article.excerpt">{{ article.excerpt }}</p>
        <div class="nyt-story-byline">
          <span class="nyt-story-author-avatar" v-if="article.author?.name">{{ article.author.name[0] }}</span>
          <span class="nyt-author-name" v-if="article.author?.name">{{ article.author.name }}</span>
          <span class="nyt-byline-sep">&bull;</span>
          <span class="nyt-time-text">{{ timeAgo(article.publishedAt) }}</span>
        </div>
      </div>
    </article>
  `,
});

// -----------------------------------------------------------------------
// ARTICLE LIST ROW (The Athletic Numbered/Ranked Variant)
// -----------------------------------------------------------------------
export const ArticleListRow = defineComponent({
  props: { article: Object, rank: Number },
  setup() { return { timeAgo, readingTime }; },
  template: `
    <div class="nyt-ranked-item">
      <div v-if="rank" class="nyt-rank-num" aria-hidden="true">{{ rank }}</div>
      <img v-if="article.featuredImage" class="nyt-ranked-img" :src="article.featuredImage" :alt="article.title" loading="lazy" />
      <div class="nyt-ranked-body">
        <div class="nyt-ranked-kicker" v-if="article.category?.name">{{ article.category.name }}</div>
        <h3 class="nyt-ranked-headline"><router-link :to="'/news/'+article.slug">{{ article.title }}</router-link></h3>
        <div class="nyt-ranked-byline">
          <span v-if="article.author?.name">{{ article.author.name }}</span>
          <span v-if="article.author?.name">&bull;</span>
          <span>{{ timeAgo(article.publishedAt) }}</span>
        </div>
      </div>
    </div>
  `,
});

// -----------------------------------------------------------------------
// PAGINATION
// -----------------------------------------------------------------------
export const Pagination = defineComponent({
  props: { page: Number, totalPages: Number },
  emits: ['change'],
  template: `
    <div class="pagination" v-if="totalPages > 1" role="navigation" aria-label="Pagination">
      <button class="btn ghost sm" :disabled="page <= 1" @click="$emit('change', page-1)" aria-label="Previous page">
        <i class="fa-solid fa-chevron-left" aria-hidden="true"></i> Prev
      </button>
      <span class="pagination-info">Page {{ page }} of {{ totalPages }}</span>
      <button class="btn ghost sm" :disabled="page >= totalPages" @click="$emit('change', page+1)" aria-label="Next page">
        Next <i class="fa-solid fa-chevron-right" aria-hidden="true"></i>
      </button>
    </div>
  `,
});

// -----------------------------------------------------------------------
// NEWSLETTER BOX (The Athletic Dark Subscription Box)
// -----------------------------------------------------------------------
export const NewsletterBox = defineComponent({
  setup() {
    const email = ref('');
    const state = ref('idle');
    const submit = async () => {
      if (state.value === 'loading') return;
      state.value = 'loading';
      try {
        await api.post('/api/newsletter', { email: email.value });
        state.value = 'done';
        email.value = '';
      } catch {
        state.value = 'error';
      }
    };
    return { email, state, submit };
  },
  template: `
    <div class="nyt-newsletter">
      <div class="nyt-newsletter-inner">
        <i class="fa-solid fa-envelope-open-text nyt-newsletter-icon" aria-hidden="true"></i>
        <div class="nyt-newsletter-text">
          <h4>The Jigawa Times Briefing</h4>
          <p>Investigative stories and daily intelligence delivered to your inbox.</p>
        </div>
        <form class="nyt-newsletter-form" @submit.prevent="submit" v-if="state !== 'done'">
          <input type="email" v-model="email" required placeholder="Your email address" aria-label="Email address for newsletter" />
          <button class="btn accent sm" type="submit" :disabled="state==='loading'">
            <i :class="state==='loading' ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-arrow-right'" aria-hidden="true"></i>
            {{ state==='loading' ? 'Subscribing…' : 'Subscribe' }}
          </button>
        </form>
        <p v-else class="nyt-newsletter-success"><i class="fa-solid fa-circle-check" aria-hidden="true"></i> You're subscribed. Thank you.</p>
      </div>
      <p v-if="state==='error'" class="nyt-newsletter-error"><i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i> Something went wrong. Please try again.</p>
    </div>
  `,
});

// -----------------------------------------------------------------------
// SHARE BUTTONS
// -----------------------------------------------------------------------
export const ShareButtons = defineComponent({
  props: { title: String },
  setup(props) {
    const url = computed(() => window.location.href);
    const copied = ref(false);
    const copy = async () => {
      await navigator.clipboard.writeText(url.value);
      copied.value = true;
      setTimeout(() => (copied.value = false), 2000);
    };
    return { url, copy, copied };
  },
  template: `
    <div class="share-row" aria-label="Share this article">
      <span class="share-label">Share Story</span>
      <a class="share-btn whatsapp" :href="'https://wa.me/?text='+encodeURIComponent(title+' '+url)" target="_blank" rel="noopener noreferrer" aria-label="Share on WhatsApp">
        <i class="fa-brands fa-whatsapp" aria-hidden="true"></i> WhatsApp
      </a>
      <a class="share-btn facebook" :href="'https://www.facebook.com/sharer/sharer.php?u='+encodeURIComponent(url)" target="_blank" rel="noopener noreferrer" aria-label="Share on Facebook">
        <i class="fa-brands fa-facebook-f" aria-hidden="true"></i> Facebook
      </a>
      <a class="share-btn twitter" :href="'https://x.com/intent/tweet?text='+encodeURIComponent(title)+'&url='+encodeURIComponent(url)" target="_blank" rel="noopener noreferrer" aria-label="Share on X (Twitter)">
        <i class="fa-brands fa-x-twitter" aria-hidden="true"></i> X
      </a>
      <button type="button" class="share-btn" @click="copy" :aria-label="copied ? 'Link copied' : 'Copy link'">
        <i :class="copied ? 'fa-solid fa-check' : 'fa-regular fa-copy'" aria-hidden="true"></i>
        {{ copied ? 'Copied!' : 'Copy link' }}
      </button>
    </div>
  `,
});

// -----------------------------------------------------------------------
// COMMENTS BLOCK
// -----------------------------------------------------------------------
export const CommentsBlock = defineComponent({
  props: { slug: String, articleId: Number },
  setup(props) {
    const comments = ref([]);
    const form = ref({ name: '', email: '', content: '' });
    const state = ref('idle');
    const load = async () => {
      try { comments.value = (await api.get(`/api/articles/${props.slug}/comments`)).items || []; } catch { comments.value = []; }
    };
    load();
    const submit = async () => {
      state.value = 'loading';
      try {
        await api.post('/api/comments', { articleId: props.articleId, ...form.value });
        state.value = 'done';
        form.value = { name: '', email: '', content: '' };
      } catch { state.value = 'error'; }
    };
    return { comments, form, state, submit };
  },
  template: `
    <section aria-label="Comments" class="comments-section">
      <div class="comment-form-title">
        <i class="fa-solid fa-comments" aria-hidden="true" style="margin-right:8px;color:var(--accent);"></i>
        Discussion &amp; Responses ({{ comments.length }})
      </div>
      <div v-if="comments.length" class="comments-list">
        <div class="comment" v-for="c in comments" :key="c.id">
          <div class="comment-who-row">
            <span class="comment-avatar">{{ c.name?.[0]?.toUpperCase() }}</span>
            <div>
              <div class="comment-who">{{ c.name }}</div>
              <div class="comment-when">{{ new Date(c.createdAt).toLocaleDateString('en-NG',{day:'numeric',month:'short',year:'numeric'}) }}</div>
            </div>
          </div>
          <p class="comment-body">{{ c.content }}</p>
        </div>
      </div>
      <p v-else class="muted" style="font-size:var(--text-sm);padding:var(--s4) 0;"><i class="fa-regular fa-comment" style="margin-right:6px;" aria-hidden="true"></i> No responses yet. Be the first to join the conversation.</p>

      <div class="comment-form-wrap" v-if="state !== 'done'">
        <h4 style="font-size:var(--text-base);font-family:var(--font-sans);font-weight:700;margin-bottom:var(--s4);">Leave a Response</h4>
        <form @submit.prevent="submit">
          <div class="form-two-col" style="gap:var(--s3);">
            <div class="field"><label for="c-name">Your Name</label><input id="c-name" v-model="form.name" required autocomplete="name" placeholder="Full name" /></div>
            <div class="field"><label for="c-email">Your Email <span style="font-weight:400;color:var(--ink-4);">(kept private)</span></label><input id="c-email" type="email" v-model="form.email" required autocomplete="email" placeholder="email@example.com" /></div>
          </div>
          <div class="field"><label for="c-body">Comment</label><textarea id="c-body" v-model="form.content" rows="4" required maxlength="2000" placeholder="Share your perspective on this report…"></textarea></div>
          <div v-if="state==='error'" class="form-error"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> Could not post your comment. Please try again.</div>
          <button class="btn accent" type="submit" :disabled="state==='loading'">
            <i :class="state==='loading' ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-paper-plane'" aria-hidden="true"></i>
            {{ state==='loading' ? 'Posting…' : 'Submit Response' }}
          </button>
        </form>
      </div>
      <p v-else style="font-size:var(--text-sm);color:var(--green);padding:var(--s4);background:var(--green-bg);border-radius:var(--radius);border:1px solid var(--green-border);">
        <i class="fa-solid fa-circle-check" aria-hidden="true"></i> Thank you — your response has been submitted for editorial moderation.
      </p>
    </section>
  `,
});

// -----------------------------------------------------------------------
// IMAGE UPLOADER (Fixed Cloudinary CORS endpoint)
// -----------------------------------------------------------------------
export const ImageUploader = defineComponent({
  props: { modelValue: String },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    const uploading = ref(false);
    const error = ref('');
    const progress = ref(0);

    const onFile = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      error.value = '';
      uploading.value = true;
      progress.value = 0;
      try {
        const sig = await api.post('/api/uploads/sign');
        const fd = new FormData();
        fd.append('file', file);
        fd.append('api_key', sig.apiKey);
        fd.append('timestamp', sig.timestamp);
        fd.append('signature', sig.signature);
        fd.append('folder', sig.folder);
        const resourceType = file.type.startsWith('video/') ? 'video' : 'image';
        const url = await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          // Use /image/upload or /video/upload to avoid 301 preflight CORS redirects
          xhr.open('POST', `https://api.cloudinary.com/v1_1/${sig.cloudName}/${resourceType}/upload`);
          xhr.upload.onprogress = (evt) => { if (evt.lengthComputable) progress.value = Math.round((evt.loaded / evt.total) * 100); };
          xhr.onload = () => {
            try {
              const data = JSON.parse(xhr.responseText);
              if (xhr.status >= 200 && xhr.status < 300) resolve(data.secure_url);
              else reject(new Error(data.error?.message || 'Upload failed.'));
            } catch { reject(new Error('Upload failed.')); }
          };
          xhr.onerror = () => reject(new Error('Upload failed. Check connection or CORS settings.'));
          xhr.send(fd);
        });
        emit('update:modelValue', url);
      } catch (err) {
        error.value = err.message;
      } finally {
        uploading.value = false;
      }
    };

    return { uploading, error, progress, onFile };
  },
  template: `
    <div>
      <label class="uploader-zone" style="display:block;border:2px dashed var(--line-2);border-radius:var(--radius);padding:var(--s5);text-align:center;cursor:pointer;background:var(--bg-3);transition:border-color var(--t);">
        <input type="file" accept="image/*,video/*" @change="onFile" :disabled="uploading" style="display:none;" />
        <i class="fa-solid fa-cloud-arrow-up" aria-hidden="true" style="font-size:1.8rem;color:var(--ink-4);margin-bottom:var(--s2);display:block;"></i>
        <span style="font-size:var(--text-sm);color:var(--ink-3);">{{ uploading ? ('Uploading… '+progress+'%') : 'Click to upload feature image or video' }}</span>
      </label>
      <div v-if="uploading" style="margin-top:var(--s2);background:var(--bg-3);border-radius:var(--radius-full);height:6px;overflow:hidden;">
        <div :style="'height:100%;background:var(--accent);width:'+progress+'%;transition:width 0.2s;'"></div>
      </div>
      <div v-if="error" class="form-error" style="margin-top:var(--s2);">
        <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> {{ error }}
      </div>
    </div>
  `,
});

// -----------------------------------------------------------------------
// DASHBOARD SIDEBAR
// -----------------------------------------------------------------------
export const DashSidebar = defineComponent({
  emits: ['close'],
  setup(props, { emit }) {
    const route = useRoute();
    const router = useRouter();

    const navGroups = computed(() => {
      const role = store.user?.role;
      if (role === 'ADMIN') return ADMIN_NAV;
      if (role === 'EDITOR') return EDITOR_NAV;
      return REPORTER_NAV;
    });

    // Manual active check: exact for most links, prefix for /reporter and /editor
    const prefixPaths = ['/reporter', '/editor'];
    const isActive = (path) => {
      if (route.path === path) return true;
      if (prefixPaths.some(p => path === p) && route.path.startsWith(path + '/')) return true;
      return false;
    };

    const handleLogout = async () => {
      await store.logout();
      router.push('/login');
    };

    return { navGroups, isActive, store, handleLogout, emit };
  },
  template: `
    <aside class="dash-sidebar" aria-label="Dashboard navigation">
      <!-- Logo -->
      <div class="dash-sidebar-logo">
        <router-link to="/" class="sidebar-brand" @click="$emit('close')" aria-label="Jigawa Times public site">
          <div class="sidebar-brand-icon" aria-hidden="true">JT</div>
          <div class="sidebar-brand-text">
            JIGAWA TIMES
            <span>Newsroom</span>
          </div>
        </router-link>
      </div>

      <!-- Navigation groups -->
      <nav class="dash-sidebar-nav" aria-label="Newsroom sections">
        <div v-for="group in navGroups" :key="group.label" class="dash-nav-group">
          <div class="dash-nav-label" aria-hidden="true">{{ group.label }}</div>
          <router-link
            v-for="item in group.items"
            :key="item.path"
            :to="item.path"
            class="dash-nav-item"
            :class="{ 'nav-active': isActive(item.path) }"
            active-class=""
            exact-active-class=""
            @click="$emit('close')"
          >
            <i :class="item.icon" aria-hidden="true"></i>
            <span>{{ item.label }}</span>
          </router-link>
        </div>
      </nav>

      <!-- User footer -->
      <div class="sidebar-footer" v-if="store.user">
        <div class="sidebar-user-avatar" aria-hidden="true">{{ store.user.name?.[0]?.toUpperCase() }}</div>
        <div class="sidebar-user-info">
          <div class="sidebar-user-name">{{ store.user.name }}</div>
          <div class="sidebar-user-role">{{ store.user.role }}</div>
        </div>
        <button class="sidebar-logout-btn" @click="handleLogout" title="Sign out" aria-label="Sign out">
          <i class="fa-solid fa-arrow-right-from-bracket" aria-hidden="true"></i>
        </button>
      </div>
    </aside>
  `,
});

// -----------------------------------------------------------------------
// DASHBOARD TOPBAR
// -----------------------------------------------------------------------
export const DashTopbar = defineComponent({
  props: { title: String },
  emits: ['toggle'],
  setup(props, { emit }) {
    const router = useRouter();
    const userMenuOpen = ref(false);

    const handleLogout = async () => {
      userMenuOpen.value = false;
      await store.logout();
      router.push('/login');
    };

    // Close dropdown when clicking outside
    const onDocClick = (e) => {
      if (!e.target.closest('.topbar-user')) userMenuOpen.value = false;
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('click', onDocClick);
    }

    return { store, userMenuOpen, handleLogout, emit };
  },
  template: `
    <header class="dash-topbar" role="banner">
      <div class="topbar-left">
        <button class="topbar-hamburger" @click="$emit('toggle')" aria-label="Toggle sidebar navigation">
          <i class="fa-solid fa-bars" aria-hidden="true"></i>
        </button>
        <nav class="topbar-breadcrumb" aria-label="Breadcrumb">
          <a href="/" class="breadcrumb-home" title="Public site" aria-label="View public site">
            <i class="fa-solid fa-house" aria-hidden="true"></i>
          </a>
          <span class="breadcrumb-sep" aria-hidden="true">/</span>
          <span class="breadcrumb-current" aria-current="page">{{ title }}</span>
        </nav>
      </div>

      <div class="topbar-right">
        <a href="/" class="topbar-action" target="_blank" rel="noopener" title="View public site" aria-label="Open public site in new tab">
          <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i>
        </a>

        <div class="topbar-user" @click.stop="userMenuOpen = !userMenuOpen" role="button" :aria-expanded="userMenuOpen" aria-haspopup="menu" aria-label="User menu" v-if="store.user">
          <div class="user-avatar" aria-hidden="true">{{ store.user.name?.[0]?.toUpperCase() }}</div>
          <div class="user-meta">
            <div class="user-name-text">{{ store.user.name }}</div>
            <div :class="'user-role-badge role-' + store.user.role">{{ store.user.role }}</div>
          </div>
          <i class="fa-solid fa-chevron-down" aria-hidden="true" style="font-size:10px;"></i>

          <div class="user-dropdown" v-if="userMenuOpen" role="menu">
            <a href="/" class="dropdown-item" target="_blank" rel="noopener" role="menuitem">
              <i class="fa-solid fa-globe" aria-hidden="true"></i> Public Site
            </a>
            <div class="dropdown-sep" role="separator"></div>
            <button class="dropdown-item" @click="handleLogout" role="menuitem">
              <i class="fa-solid fa-arrow-right-from-bracket" aria-hidden="true"></i> Sign Out
            </button>
          </div>
        </div>
      </div>
    </header>
  `,
});

// -----------------------------------------------------------------------
// SITE FOOTER
// -----------------------------------------------------------------------
export const SiteFooter = defineComponent({
  setup() {
    const dashLink = computed(() => {
      if (!store.user) return '/login';
      if (store.user.role === 'REPORTER') return '/reporter';
      if (store.user.role === 'EDITOR') return '/editor';
      return '/admin';
    });
    const logout = async (router) => {
      await store.logout();
      router.push('/');
    };
    return { store, dashLink, logout };
  },
  template: `
    <footer class="nyt-footer" aria-label="Site footer">
      <div class="container nyt-footer-inner">
        <div class="nyt-footer-brand">
          <router-link to="/" class="nyt-footer-wordmark" aria-label="Jigawa Times home">Jigawa <span class="nyt-accent">Times</span></router-link>
          <span class="nyt-footer-bullet" aria-hidden="true">&bull;</span>
          <span class="nyt-footer-tagline">ECHOES FROM THE NEW WORLD</span>
        </div>
        <nav class="nyt-footer-links" aria-label="Footer navigation">
          <router-link to="/category/buji">Buji</router-link>
          <router-link to="/category/jigawa">Jigawa</router-link>
          <router-link to="/category/politics">Politics</router-link>
          <router-link to="/category/investigations">Investigations</router-link>
          <router-link to="/about">About</router-link>
          <router-link to="/editorial-policy">Editorial Policy</router-link>
          <router-link to="/contact">Contact</router-link>
          <router-link to="/privacy">Privacy</router-link>
          <span class="nyt-footer-pipe" aria-hidden="true">|</span>
          <template v-if="!store.user">
            <router-link to="/login" class="nyt-footer-login"><i class="fa-solid fa-user-lock" aria-hidden="true"></i> Newsroom Login</router-link>
          </template>
          <template v-else>
            <router-link :to="dashLink" class="nyt-footer-login"><i class="fa-solid fa-gauge-high" aria-hidden="true"></i> {{ store.user.name }}</router-link>
            <button @click="logout($router)" class="nyt-footer-logout"><i class="fa-solid fa-arrow-right-from-bracket" aria-hidden="true"></i> Sign out</button>
          </template>
        </nav>
      </div>
    </footer>
  `,
});
