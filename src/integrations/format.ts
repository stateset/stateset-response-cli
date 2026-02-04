export function formatMoney(amount: unknown): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return String(amount);
  return n.toFixed(2);
}
