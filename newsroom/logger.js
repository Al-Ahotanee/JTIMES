// newsroom/logger.js
// Centralized logger that writes to stdout (Render console)
// and retains the most recent log messages in an in-memory ring buffer
// for the admin dashboard log viewer.

'use strict';

const MAX_LOGS = 200;
const logBuffer = [];

function formatMessage(prefix, level, args) {
  const timestamp = new Date().toISOString();
  const text = args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
  return `[${timestamp}] [NEWSROOM] [${level.toUpperCase()}] ${text}`;
}

function pushLog(entry) {
  logBuffer.push(entry);
  if (logBuffer.length > MAX_LOGS) {
    logBuffer.shift();
  }
}

const logger = {
  info(...args) {
    const formatted = formatMessage('NEWSROOM', 'INFO', args);
    console.log(formatted);
    pushLog({ time: new Date().toISOString(), level: 'info', message: args.join(' ') });
  },

  warn(...args) {
    const formatted = formatMessage('NEWSROOM', 'WARN', args);
    console.warn(formatted);
    pushLog({ time: new Date().toISOString(), level: 'warn', message: args.join(' ') });
  },

  error(...args) {
    const formatted = formatMessage('NEWSROOM', 'ERROR', args);
    console.error(formatted);
    pushLog({ time: new Date().toISOString(), level: 'error', message: args.join(' ') });
  },

  getRecentLogs() {
    return [...logBuffer];
  },
};

module.exports = logger;
