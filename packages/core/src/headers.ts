import type { OutgoingHttpHeaders } from 'node:http';

export function normalizeHeaders(headers: OutgoingHttpHeaders): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      result[key] = value.join(', ');
    } else {
      result[key] = String(value);
    }
  }
  return result;
}
