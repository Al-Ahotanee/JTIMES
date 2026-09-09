<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { store } from './store.js';
import { api } from './api.js';
import { SiteHeader, SiteFooter, BreakingTicker } from './components.js';

const route = useRoute();
const breaking = ref([]);

// Detect dashboard routes to suppress public site chrome
const isDash = computed(() => /^\/(admin|editor|reporter)/.test(route?.path ?? ''));

onMounted(async () => {
  await store.init();
  try { breaking.value = (await api.get('/api/articles?breaking=true&pageSize=6')).items; } catch { breaking.value = []; }
});
</script>

<template>
  <template v-if="!isDash">
    <site-header></site-header>
    <breaking-ticker :items="breaking"></breaking-ticker>
  </template>
  <main :class="isDash ? 'dash-app' : 'public-app'">
    <router-view v-if="store.authChecked" />
    <div v-else class="app-loading">
      <div class="app-loading-inner">
        <div class="app-loading-logo">JT</div>
        <p>Loading Jigawa Times&hellip;</p>
      </div>
    </div>
  </main>
  <site-footer v-if="!isDash"></site-footer>
</template>
