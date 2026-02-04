export type Limiter<T> = (fn: () => Promise<T>) => Promise<T>;

export function createLimiter(concurrency: number): Limiter<unknown> {
  let active = 0;
  const queue: Array<{ fn: () => Promise<unknown>; resolve: (value: unknown) => void; reject: (err: unknown) => void }> = [];

  const next = () => {
    if (active >= concurrency) return;
    const item = queue.shift();
    if (!item) return;
    active++;
    item
      .fn()
      .then(item.resolve, item.reject)
      .finally(() => {
        active--;
        next();
      });
  };

  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      next();
    });
}
