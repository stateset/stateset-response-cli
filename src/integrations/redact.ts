const PII_KEY_RE = /(email|phone|address|customer_email|customer_phone|customer_name|first_name|last_name)/i;

export function redactPii(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactPii);
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (PII_KEY_RE.test(k)) {
        out[k] = '[redacted]';
      } else {
        out[k] = redactPii(v);
      }
    }
    return out;
  }
  return value;
}
