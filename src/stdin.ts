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
    return JSON.parse(raw) as StdinData;
  } catch {
    return {};
  }
}
