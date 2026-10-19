import type { StdinData } from './types.js';

export async function readStdin(): Promise<StdinData> {
  if (process.stdin.isTTY) return {};

  const chunks: string[] = [];
  process.stdin.setEncoding('utf8');

  for await (const chunk of process.stdin) {
    chunks.push(chunk as string);
  }

  const raw = chunks.join('');
  if (!raw.trim()) return {};

  try {
    // `null`, a number, a string or an array parse fine but aren't a payload —
    // treat anything that isn't a plain object as "no data".
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as StdinData)
      : {};
  } catch {
    return {};
  }
}
