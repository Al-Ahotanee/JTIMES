import { createRouter, createWebHistory } from 'vue-router';
import { store } from './store.js';
import * as P from './pages.js';

const routes = [
  { path: '/', component: P.Home },
  { path: '/news/:slug', component: P.ArticlePage },
  { path: '/category/:slug', component: P.CategoryPage },
  { path: '/search', component: P.SearchPage },
  { path: '/author/:id', component: P.AuthorPage },
  { path: '/about', component: P.AboutPage },
  { path: '/contact', component: P.ContactPage },
  { path: '/editorial-policy', component: P.EditorialPolicyPage },
  { path: '/privacy', component: P.PrivacyPage },
  { path: '/terms', component: P.TermsPage },
  { path: '/login', component: P.LoginPage },

  { path: '/admin', component: P.AdminOverview, meta: { roles: ['ADMIN'] } },
  { path: '/admin/articles', component: P.AdminArticles, meta: { roles: ['ADMIN'] } },
  { path: '/admin/users', component: P.AdminUsers, meta: { roles: ['ADMIN'] } },
  { path: '/admin/categories', component: P.AdminCategories, meta: { roles: ['ADMIN'] } },
  { path: '/admin/comments', component: P.AdminComments, meta: { roles: ['ADMIN'] } },

  { path: '/editor', component: P.EditorQueue, meta: { roles: ['ADMIN', 'EDITOR'] } },
  { path: '/editor/comments', component: P.AdminComments, meta: { roles: ['ADMIN', 'EDITOR'] } },

  { path: '/reporter', component: P.ReporterHome, meta: { roles: ['ADMIN', 'EDITOR', 'REPORTER'] } },
  { path: '/reporter/new', component: P.ArticleEditor, meta: { roles: ['ADMIN', 'EDITOR', 'REPORTER'] } },
  { path: '/reporter/edit/:id', component: P.ArticleEditor, meta: { roles: ['ADMIN', 'EDITOR', 'REPORTER'] } },

  { path: '/:pathMatch(.*)*', component: P.NotFound },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior() { return { top: 0 }; },
});

// Route protection: unauthenticated users are redirected to /login for any
// role-gated route; authenticated users lacking the role see a 403 state.
// This is a UX convenience only — the server enforces the real authorization
// on every API call regardless of what the client believes.
router.beforeEach(async (to) => {
  if (!to.meta?.roles) return true;
  if (!store.authChecked) await store.fetchMe();
  if (!store.user) return { path: '/login', query: { redirect: to.fullPath } };
  if (!to.meta.roles.includes(store.user.role)) return { path: '/', query: { forbidden: '1' } };
  return true;
});
