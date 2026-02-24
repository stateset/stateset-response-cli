import { webcrypto } from 'node:crypto';

const globalRef = globalThis as any;

if (typeof globalRef.crypto?.getRandomValues !== 'function' && webcrypto) {
  globalRef.crypto = webcrypto;
}

if (typeof globalRef.structuredClone !== 'function') {
  globalRef.structuredClone = (value: unknown) => JSON.parse(JSON.stringify(value));
}

if (typeof globalRef.Headers !== 'function') {
  class HeadersPolyfill {
    private map = new Map<string, string>();

    constructor(init?: unknown) {
      if (!init) return;

      if (Array.isArray(init)) {
        for (const entry of init) {
          if (!Array.isArray(entry) || entry.length < 2) continue;
          this.append(entry[0], entry[1]);
        }
        return;
      }

      if (
        typeof init === 'object' &&
        init &&
        typeof (init as { entries?: unknown }).entries === 'function'
      ) {
        for (const [name, value] of (
          init as { entries: () => Iterable<[unknown, unknown]> }
        ).entries()) {
          this.append(name, value);
        }
        return;
      }

      if (typeof init === 'object' && init) {
        for (const [name, value] of Object.entries(init as Record<string, unknown>)) {
          this.append(name, value);
        }
      }
    }

    private normalizeName(name: unknown): string {
      return String(name).toLowerCase();
    }

    append(name: unknown, value: unknown): void {
      const key = this.normalizeName(name);
      const next = String(value);
      const prev = this.map.get(key);
      this.map.set(key, prev ? `${prev}, ${next}` : next);
    }

    set(name: unknown, value: unknown): void {
      this.map.set(this.normalizeName(name), String(value));
    }

    get(name: unknown): string | null {
      const value = this.map.get(this.normalizeName(name));
      return value === undefined ? null : value;
    }

    has(name: unknown): boolean {
      return this.map.has(this.normalizeName(name));
    }

    delete(name: unknown): void {
      this.map.delete(this.normalizeName(name));
    }

    forEach(
      callback: (value: string, key: string, parent: HeadersPolyfill) => void,
      thisArg?: unknown,
    ): void {
      for (const [key, value] of this.map.entries()) {
        callback.call(thisArg, value, key, this);
      }
    }

    entries(): IterableIterator<[string, string]> {
      return this.map.entries();
    }

    keys(): IterableIterator<string> {
      return this.map.keys();
    }

    values(): IterableIterator<string> {
      return this.map.values();
    }

    [Symbol.iterator](): IterableIterator<[string, string]> {
      return this.entries();
    }
  }

  globalRef.Headers = HeadersPolyfill;
}

if (
  typeof globalRef.AbortSignal !== 'undefined' &&
  typeof globalRef.AbortSignal.prototype.throwIfAborted !== 'function'
) {
  globalRef.AbortSignal.prototype.throwIfAborted = function throwIfAborted() {
    if (!this.aborted) {
      return;
    }
    const reason = this.reason ?? new Error('This operation was aborted.');
    throw reason instanceof Error ? reason : new Error(String(reason));
  };
}
