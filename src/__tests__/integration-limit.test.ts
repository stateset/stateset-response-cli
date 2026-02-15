import { describe, it, expect } from 'vitest';
import { createLimiter } from '../integrations/limit.js';

const deferred = () => {
  let resolve!: (v: unknown) => void, reject!: (e: unknown) => void;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('createLimiter', () => {
  it('concurrency 1: tasks execute sequentially', async () => {
    const limiter = createLimiter(1);
    const order: number[] = [];
    const d1 = deferred(),
      d2 = deferred();

    const p1 = limiter(() => {
      order.push(1);
      return d1.promise;
    });
    limiter(() => {
      order.push(2);
      return d2.promise;
    });

    expect(order).toEqual([1]); // only first task started
    d1.resolve('a');
    await p1;
    await tick();
    expect(order).toEqual([1, 2]); // second starts after first resolves
    d2.resolve('b');
  });

  it('concurrency 3: up to 3 concurrent, rest queued', async () => {
    const limiter = createLimiter(3);
    const started: number[] = [];
    const defs = Array.from({ length: 5 }, () => deferred());

    const ps = defs.map((d, i) =>
      limiter(() => {
        started.push(i);
        return d.promise;
      }),
    );

    expect(started).toEqual([0, 1, 2]); // only 3 started
    defs[0].resolve('r0');
    await ps[0];
    await tick();
    expect(started).toEqual([0, 1, 2, 3]); // 4th starts
    defs[1].resolve('r1');
    await ps[1];
    await tick();
    expect(started).toEqual([0, 1, 2, 3, 4]); // 5th starts
    defs.slice(2).forEach((d, i) => d.resolve(`r${i + 2}`));
    await Promise.all(ps);
  });

  it('rejected promises do not block the queue', async () => {
    const limiter = createLimiter(1);
    const d1 = deferred(),
      d2 = deferred();

    const p1 = limiter(() => d1.promise);
    const p2 = limiter(() => d2.promise);

    d1.reject(new Error('fail'));
    await expect(p1).rejects.toThrow('fail');
    await tick();
    d2.resolve('ok');
    await expect(p2).resolves.toBe('ok');
  });

  it('returns results correctly', async () => {
    const limiter = createLimiter(2);
    const r1 = limiter(() => Promise.resolve(42));
    const r2 = limiter(() => Promise.resolve('hello'));
    expect(await r1).toBe(42);
    expect(await r2).toBe('hello');
  });

  it('drains the queue fully', async () => {
    const limiter = createLimiter(10);
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => limiter(() => Promise.resolve(i))),
    );
    expect(results).toEqual(Array.from({ length: 20 }, (_, i) => i));
  });
});
