/**
 * Enterprise Notification & Confirmation Service
 * Powered by PrimeVue Toast and PrimeVue ConfirmDialog
 */

let toastInstance = null;
let confirmInstance = null;
const pendingQueue = [];

/**
 * Initializes the global PrimeVue instances from App.vue
 */
export function initNotify(toast, confirm) {
  toastInstance = toast;
  confirmInstance = confirm;

  // Flush any notifications queued before mount
  while (pendingQueue.length > 0) {
    const item = pendingQueue.shift();
    if (toastInstance) {
      toastInstance.add(item);
    }
  }
}

/**
 * Enterprise Toast Notification API
 */
export const notify = {
  /**
   * Show a success notification
   * @param {string} summary - Header title
   * @param {string} detail - Description
   * @param {string} [linkUrl] - Optional action link URL
   * @param {string} [linkText] - Optional action link text
   * @param {number} [life=5000] - Duration in ms
   */
  success(summary, detail, linkUrl = null, linkText = 'View Article on Site', life = 5000) {
    const msg = {
      severity: 'success',
      summary: summary || 'Operation Successful',
      detail: detail || '',
      life,
      icon: 'pi pi-check-circle',
    };
    if (linkUrl) {
      msg.link = { url: linkUrl, text: linkText };
    }
    this._send(msg);
  },

  /**
   * Show an error notification
   * @param {string} summary - Header title
   * @param {string} detail - Description or error message
   * @param {number} [life=6000] - Duration in ms
   */
  error(summary, detail, life = 6000) {
    this._send({
      severity: 'error',
      summary: summary || 'Error',
      detail: detail || 'An unexpected error occurred.',
      life,
      icon: 'pi pi-times-circle',
    });
  },

  /**
   * Show a warning notification
   * @param {string} summary - Header title
   * @param {string} detail - Description
   * @param {number} [life=5000] - Duration in ms
   */
  warn(summary, detail, life = 5000) {
    this._send({
      severity: 'warn',
      summary: summary || 'Warning',
      detail: detail || '',
      life,
      icon: 'pi pi-exclamation-triangle',
    });
  },

  /**
   * Show an informational notification
   * @param {string} summary - Header title
   * @param {string} detail - Description
   * @param {number} [life=4000] - Duration in ms
   */
  info(summary, detail, life = 4000) {
    this._send({
      severity: 'info',
      summary: summary || 'Information',
      detail: detail || '',
      life,
      icon: 'pi pi-info-circle',
    });
  },

  _send(msg) {
    if (toastInstance) {
      toastInstance.add(msg);
    } else {
      pendingQueue.push(msg);
    }
  },
};

/**
 * Enterprise Confirmation Dialog API
 * Replaces native window.confirm() with PrimeVue ConfirmDialog
 *
 * @param {Object} options
 * @param {string} options.header - Dialog title
 * @param {string} options.message - Confirmation body
 * @param {string} [options.icon='pi pi-exclamation-triangle'] - PrimeIcon
 * @param {string} [options.acceptLabel='Confirm'] - Text on confirmation button
 * @param {string} [options.rejectLabel='Cancel'] - Text on cancel button
 * @param {string} [options.acceptSeverity='primary'] - Button variant ('success' | 'danger' | 'primary' | 'warn')
 * @param {Function} options.onAccept - Async/sync callback on accept
 * @param {Function} [options.onReject] - Optional callback on reject
 */
export function confirmDialog({
  header = 'Confirm Action',
  message,
  icon = 'pi pi-exclamation-triangle',
  acceptLabel = 'Confirm',
  rejectLabel = 'Cancel',
  acceptSeverity = 'primary',
  onAccept,
  onReject,
}) {
  if (!confirmInstance) {
    // Fallback if called before mount
    if (window.confirm(`${header}\n\n${message}`)) {
      if (onAccept) onAccept();
    } else {
      if (onReject) onReject();
    }
    return;
  }

  confirmInstance.require({
    header,
    message,
    icon,
    acceptProps: {
      label: acceptLabel,
      severity: acceptSeverity,
    },
    rejectProps: {
      label: rejectLabel,
      severity: 'secondary',
      outlined: true,
    },
    accept: async () => {
      if (onAccept) {
        try {
          await onAccept();
        } catch (err) {
          notify.error('Action Failed', err.message);
        }
      }
    },
    reject: () => {
      if (onReject) onReject();
    },
  });
}
