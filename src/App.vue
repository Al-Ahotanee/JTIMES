<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { useToast } from 'primevue/usetoast';
import { useConfirm } from 'primevue/useconfirm';
import { store } from './store.js';
import { api } from './api.js';
import { initNotify } from './notifications.js';
import { SiteHeader, SiteFooter, BreakingTicker } from './components.js';

const route = useRoute();
const breaking = ref([]);

// Initialize enterprise PrimeVue services
const toast = useToast();
const confirm = useConfirm();
initNotify(toast, confirm);

// Detect dashboard routes to suppress public site chrome
const isDash = computed(() => /^\/(admin|editor|reporter)/.test(route?.path ?? ''));

onMounted(async () => {
  await store.init();
  try { breaking.value = (await api.get('/api/articles?breaking=true&pageSize=6')).items; } catch { breaking.value = []; }
});
</script>

<template>
  <!-- Global Enterprise ConfirmDialog -->
  <ConfirmDialog />

  <!-- Global Enterprise Toast Notifications with Rich Actions -->
  <Toast position="top-right">
    <template #message="slotProps">
      <div style="display:flex;align-items:flex-start;gap:12px;width:100%;">
        <i
          :class="[
            slotProps.message.icon || (
              slotProps.message.severity === 'success' ? 'pi pi-check-circle' :
              slotProps.message.severity === 'error' ? 'pi pi-times-circle' :
              slotProps.message.severity === 'warn' ? 'pi pi-exclamation-triangle' : 'pi pi-info-circle'
            )
          ]"
          style="font-size:1.4rem;flex-shrink:0;margin-top:2px;"
        ></i>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;font-size:0.92rem;margin-bottom:2px;">{{ slotProps.message.summary }}</div>
          <div style="font-size:0.83rem;line-height:1.45;opacity:0.9;">{{ slotProps.message.detail }}</div>
          <div v-if="slotProps.message.link" style="margin-top:8px;">
            <a
              :href="slotProps.message.link.url"
              target="_blank"
              style="display:inline-flex;align-items:center;gap:5px;font-size:0.82rem;font-weight:700;color:var(--green);text-decoration:underline;background:rgba(34,197,94,0.12);padding:3px 8px;border-radius:4px;"
            >
              <span>{{ slotProps.message.link.text || 'View Article on Site' }}</span>
              <i class="pi pi-arrow-up-right" style="font-size:0.75rem;"></i>
            </a>
          </div>
        </div>
      </div>
    </template>
  </Toast>

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

