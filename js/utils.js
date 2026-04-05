/**
 * utils.js — Shared utilities: ID generation, EventBus, debounce, coordinate helpers
 */

const Utils = (() => {
  // ===== ID Generation (nanoid-like, 8 chars) =====
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

  function generateId(length = 8) {
    let id = '';
    const bytes = crypto.getRandomValues(new Uint8Array(length));
    for (let i = 0; i < length; i++) {
      id += ALPHABET[bytes[i] % ALPHABET.length];
    }
    return id;
  }

  // Room codes are 6 uppercase alphanumeric for readability
  function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous 0/O, 1/I
    let code = '';
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    for (let i = 0; i < 6; i++) {
      code += chars[bytes[i] % chars.length];
    }
    return code;
  }

  // ===== EventBus (pub/sub) =====
  class EventBus {
    constructor() {
      this._listeners = {};
    }

    on(event, callback) {
      if (!this._listeners[event]) this._listeners[event] = [];
      this._listeners[event].push(callback);
      return () => this.off(event, callback);
    }

    off(event, callback) {
      if (!this._listeners[event]) return;
      this._listeners[event] = this._listeners[event].filter(cb => cb !== callback);
    }

    emit(event, data) {
      if (!this._listeners[event]) return;
      this._listeners[event].forEach(cb => cb(data));
    }
  }

  // Global event bus instance
  const bus = new EventBus();

  // ===== Debounce / Throttle =====
  function debounce(fn, delay) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  function throttle(fn, limit) {
    let inThrottle = false;
    return function (...args) {
      if (!inThrottle) {
        fn.apply(this, args);
        inThrottle = true;
        setTimeout(() => (inThrottle = false), limit);
      }
    };
  }

  // ===== Coordinate Transforms =====
  // Convert screen coordinates to world (canvas) coordinates
  function screenToWorld(screenX, screenY, pan, scale) {
    return {
      x: (screenX - pan.x) / scale,
      y: (screenY - pan.y) / scale,
    };
  }

  // Convert world coordinates to screen coordinates
  function worldToScreen(worldX, worldY, pan, scale) {
    return {
      x: worldX * scale + pan.x,
      y: worldY * scale + pan.y,
    };
  }

  // ===== Toast Notification =====
  function showToast(message, duration = 2800) {
    // Remove any existing toast
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), duration);
  }

  // ===== Deep Clone (for undo/redo snapshots) =====
  function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  // ===== Clamp =====
  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  return {
    generateId,
    generateRoomCode,
    EventBus,
    bus,
    debounce,
    throttle,
    screenToWorld,
    worldToScreen,
    showToast,
    deepClone,
    clamp,
  };
})();
