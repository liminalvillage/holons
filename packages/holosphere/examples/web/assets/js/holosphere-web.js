/**
 * HoloSphere Web Adapter
 * Browser-compatible utilities for HoloSphere examples
 */

// Note: In production, you would bundle HoloSphere with browserify/webpack
// For these examples, we'll simulate the API

class HoloSphereDemo {
  constructor(appName, projectName, color) {
    this.appName = appName;
    this.projectName = projectName;
    this.color = color;
    this.storage = new Map();
    this.subscribers = new Map();
    this.federations = new Map();
    console.log(`[${appName}] Initialized for ${projectName}`);
  }

  // Simulate data storage with localStorage
  async put(holon, lens, data, password = null, options = {}) {
    const key = `${this.appName}:${holon}:${lens}:${data.id || Date.now()}`;
    const item = {
      ...data,
      _holon: holon,
      _lens: lens,
      _timestamp: Date.now(),
      _app: this.appName
    };

    // Store in memory
    this.storage.set(key, item);

    // Store in localStorage for persistence
    try {
      localStorage.setItem(key, JSON.stringify(item));
    } catch (e) {
      console.warn('localStorage unavailable', e);
    }

    // Notify subscribers
    this.notifySubscribers(holon, lens, item);

    // Simulate federation
    await this.propagateToFederated(holon, lens, item);

    console.log(`[${this.appName}] PUT ${holon}/${lens}:`, data);
    return item;
  }

  async get(holon, lens, id, password = null) {
    const key = `${this.appName}:${holon}:${lens}:${id}`;
    let item = this.storage.get(key);

    if (!item) {
      try {
        const stored = localStorage.getItem(key);
        if (stored) {
          item = JSON.parse(stored);
          this.storage.set(key, item);
        }
      } catch (e) {
        console.warn('localStorage read failed', e);
      }
    }

    console.log(`[${this.appName}] GET ${holon}/${lens}/${id}:`, item);
    return item;
  }

  async getAll(holon, lens, password = null) {
    const prefix = `${this.appName}:${holon}:${lens}:`;
    const items = [];

    // Check memory
    for (const [key, value] of this.storage.entries()) {
      if (key.startsWith(prefix)) {
        items.push(value);
      }
    }

    // Check localStorage
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(prefix)) {
          const stored = localStorage.getItem(key);
          if (stored) {
            const item = JSON.parse(stored);
            if (!this.storage.has(key)) {
              items.push(item);
              this.storage.set(key, item);
            }
          }
        }
      }
    } catch (e) {
      console.warn('localStorage scan failed', e);
    }

    console.log(`[${this.appName}] GET ALL ${holon}/${lens}: ${items.length} items`);
    return items;
  }

  async delete(holon, lens, id) {
    const key = `${this.appName}:${holon}:${lens}:${id}`;
    this.storage.delete(key);

    try {
      localStorage.removeItem(key);
    } catch (e) {
      console.warn('localStorage delete failed', e);
    }

    console.log(`[${this.appName}] DELETE ${holon}/${lens}/${id}`);
  }

  async subscribe(holon, lens, callback, password = null) {
    const subKey = `${holon}:${lens}`;
    if (!this.subscribers.has(subKey)) {
      this.subscribers.set(subKey, []);
    }
    this.subscribers.get(subKey).push(callback);
    console.log(`[${this.appName}] SUBSCRIBED to ${holon}/${lens}`);
    return () => this.unsubscribe(holon, lens, callback);
  }

  unsubscribe(holon, lens, callback) {
    const subKey = `${holon}:${lens}`;
    const subs = this.subscribers.get(subKey);
    if (subs) {
      const index = subs.indexOf(callback);
      if (index > -1) {
        subs.splice(index, 1);
      }
    }
  }

  notifySubscribers(holon, lens, data) {
    const subKey = `${holon}:${lens}`;
    const subs = this.subscribers.get(subKey);
    if (subs) {
      subs.forEach(callback => {
        try {
          callback(data);
        } catch (e) {
          console.error('Subscriber error:', e);
        }
      });
    }
  }

  async federate(space1, space2, options = {}) {
    if (!this.federations.has(space1)) {
      this.federations.set(space1, new Set());
    }
    this.federations.get(space1).add(space2);
    console.log(`[${this.appName}] FEDERATED ${space1} -> ${space2}`);
  }

  async propagateToFederated(holon, lens, data) {
    const federated = this.federations.get(holon);
    if (federated) {
      for (const targetHolon of federated) {
        console.log(`[${this.appName}] PROPAGATING ${holon}/${lens} -> ${targetHolon}`);
      }
    }
  }

  async getFederated(holon, lens, options = {}) {
    const items = await this.getAll(holon, lens);
    const federated = this.federations.get(holon);

    if (federated) {
      for (const targetHolon of federated) {
        const federatedItems = await this.getAll(targetHolon, lens);
        items.push(...federatedItems);
      }
    }

    return items;
  }

  async close() {
    console.log(`[${this.appName}] Closed`);
  }
}

// Utility functions
function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return date.toLocaleDateString();
}

function createStatusBadge(status) {
  const badges = {
    active: 'badge-success',
    pending: 'badge-warning',
    completed: 'badge-success',
    available: 'badge-success',
    booked: 'badge-warning',
    closed: 'badge-info'
  };

  const badge = document.createElement('span');
  badge.className = `badge ${badges[status] || 'badge-info'}`;
  badge.textContent = status;
  return badge;
}

function showNotification(message, type = 'success') {
  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 1rem 1.5rem;
    background: ${type === 'success' ? '#10b981' : '#ef4444'};
    color: white;
    border-radius: 0.5rem;
    box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1);
    z-index: 1000;
    animation: slideIn 0.3s ease-out;
  `;
  notification.textContent = message;

  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideIn {
      from {
        transform: translateX(100%);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }
  `;
  document.head.appendChild(style);

  document.body.appendChild(notification);

  setTimeout(() => {
    notification.style.animation = 'slideIn 0.3s ease-out reverse';
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

function renderJSON(data) {
  return `<pre style="background: #1f2937; color: #f3f4f6; padding: 1rem; border-radius: 0.5rem; overflow-x: auto;"><code>${JSON.stringify(data, null, 2)}</code></pre>`;
}

// Export for use in examples
if (typeof window !== 'undefined') {
  window.HoloSphereDemo = HoloSphereDemo;
  window.formatTimestamp = formatTimestamp;
  window.createStatusBadge = createStatusBadge;
  window.showNotification = showNotification;
  window.renderJSON = renderJSON;
}
