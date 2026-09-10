import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router.js';

// PrimeVue enterprise UI suite
import PrimeVue from 'primevue/config';
import Aura from '@primevue/themes/aura';
import ToastService from 'primevue/toastservice';
import ConfirmationService from 'primevue/confirmationservice';
import DialogService from 'primevue/dialogservice';

// Global PrimeVue components
import Toast from 'primevue/toast';
import ConfirmDialog from 'primevue/confirmdialog';
import Dialog from 'primevue/dialog';
import Message from 'primevue/message';
import Button from 'primevue/button';
import Tag from 'primevue/tag';

import 'primeicons/primeicons.css';
import './styles.css';

const app = createApp(App);

app.use(router);
app.use(PrimeVue, {
  theme: {
    preset: Aura,
    options: {
      darkModeSelector: '.dark-mode',
      cssLayer: false,
    },
  },
});
app.use(ToastService);
app.use(ConfirmationService);
app.use(DialogService);

// Register components with standard and prefixed tags
app.component('Toast', Toast);
app.component('p-toast', Toast);
app.component('ConfirmDialog', ConfirmDialog);
app.component('p-confirm-dialog', ConfirmDialog);
app.component('Dialog', Dialog);
app.component('p-dialog', Dialog);
app.component('Message', Message);
app.component('p-message', Message);
app.component('Button', Button);
app.component('p-button', Button);
app.component('Tag', Tag);
app.component('p-tag', Tag);

app.mount('#app');

