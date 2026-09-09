import { reactive } from 'vue';
import { api } from './api.js';

export const store = reactive({
  user: null,
  authChecked: false,
  categories: [],
  settings: {},

  async init() {
    await Promise.all([this.fetchMe(), this.fetchCategories(), this.fetchSettings()]);
  },
  async fetchMe() {
    try {
      const { user } = await api.get('/api/auth/me');
      this.user = user;
    } catch {
      this.user = null;
    } finally {
      this.authChecked = true;
    }
  },
  async fetchCategories() {
    try { this.categories = (await api.get('/api/categories')).items; } catch { this.categories = []; }
  },
  async fetchSettings() {
    try { this.settings = (await api.get('/api/settings')).items; } catch { this.settings = {}; }
  },
  async login(email, password) {
    const { user } = await api.post('/api/auth/login', { email, password });
    this.user = user;
    return user;
  },
  async logout() {
    await api.post('/api/auth/logout');
    this.user = null;
  },
  isStaff() {
    return this.user && (this.user.role === 'ADMIN' || this.user.role === 'EDITOR');
  },
});
