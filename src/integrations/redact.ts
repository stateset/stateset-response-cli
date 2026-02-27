const PII_KEY_RE =
  /(email|phone|address|customer_email|customer_phone|customer_name|first_name|last_name|ssn|social_security|date_of_birth|dob|birth_date|credit_card|card_number|cvv|cvc|password|passwd|secret|api_key|apikey|access_token|ip_address|tax_id|national_id|passport|driver_license|bank_account|routing_number)/i;

const PII_VALUE_PATTERNS: RegExp[] = [
  /\b\d{3}-\d{2}-\d{4}\b/, // SSN: 123-45-6789
  /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/, // Credit card: 4111 1111 1111 1111
  /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/, // IPv4: 192.168.1.1
];

function containsPiiValue(value: string): boolean {
  return PII_VALUE_PATTERNS.some((p) => p.test(value));
}

export function redactPii(value: unknown): unknown {
  if (typeof value === 'string') {
    return containsPiiValue(value) ? '[redacted]' : value;
  }
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
