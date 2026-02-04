export interface StringifyResult {
  text: string;
  truncated: boolean;
}

export function stringifyToolResult(payload: unknown, maxChars = 12000): StringifyResult {
  const safeMax = Math.max(2000, Math.floor(Number(maxChars) || 12000));
  const json = JSON.stringify(payload, null, 2);
  if (json.length <= safeMax) {
    return { text: json, truncated: false };
  }

  const truncatedPayload = {
    success: typeof payload === 'object' && payload !== null && 'success' in (payload as Record<string, unknown>)
      ? (payload as Record<string, unknown>).success
      : true,
    truncated: true,
    max_chars: safeMax,
    preview: json.slice(0, safeMax),
  };

  return { text: JSON.stringify(truncatedPayload, null, 2), truncated: true };
}
