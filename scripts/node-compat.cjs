const crypto = require('node:crypto');

if (typeof crypto.getRandomValues !== 'function' && crypto.webcrypto?.getRandomValues) {
  crypto.getRandomValues = crypto.webcrypto.getRandomValues.bind(crypto.webcrypto);
}

if (typeof globalThis.crypto?.getRandomValues !== 'function' && crypto.webcrypto) {
  globalThis.crypto = crypto.webcrypto;
}

if (typeof globalThis.structuredClone !== 'function') {
  globalThis.structuredClone = (value) => JSON.parse(JSON.stringify(value));
}

if (typeof globalThis.Headers !== 'function') {
  class HeadersPolyfill {
    constructor(init = undefined) {
      this.map = new Map();

      if (!init) return;

      if (Array.isArray(init)) {
        for (const [name, value] of init) {
          this.append(name, value);
        }
        return;
      }

      if (typeof init.entries === 'function') {
        for (const [name, value] of init.entries()) {
          this.append(name, value);
        }
        return;
      }

      for (const [name, value] of Object.entries(init)) {
        this.append(name, value);
      }
    }

    normalizeName(name) {
      return String(name).toLowerCase();
    }

    append(name, value) {
      const key = this.normalizeName(name);
      const next = String(value);
      const prev = this.map.get(key);
      this.map.set(key, prev ? `${prev}, ${next}` : next);
    }

    set(name, value) {
      this.map.set(this.normalizeName(name), String(value));
    }

    get(name) {
      const value = this.map.get(this.normalizeName(name));
      return value === undefined ? null : value;
    }

    has(name) {
      return this.map.has(this.normalizeName(name));
    }

    delete(name) {
      this.map.delete(this.normalizeName(name));
    }

    forEach(callback, thisArg = undefined) {
      for (const [name, value] of this.map.entries()) {
        callback.call(thisArg, value, name, this);
      }
    }

    entries() {
      return this.map.entries();
    }

    keys() {
      return this.map.keys();
    }

    values() {
      return this.map.values();
    }

    [Symbol.iterator]() {
      return this.entries();
    }
  }

  globalThis.Headers = HeadersPolyfill;
}

if (
  typeof AbortSignal !== 'undefined' &&
  typeof AbortSignal.prototype.throwIfAborted !== 'function'
) {
  AbortSignal.prototype.throwIfAborted = function throwIfAborted() {
    if (!this.aborted) {
      return;
    }
    const reason = this.reason ?? new Error('This operation was aborted.');
    throw reason instanceof Error ? reason : new Error(String(reason));
  };
}
