// Prefer `id` over `display_name`: only id carries the `[1m]` variant suffix
// for extended-context mode (display_name surfaces it as free text "(1M context)").
export interface ModelName {
  name: string;
  variant: string | null;
}

export function shortModelName(displayName?: string, id?: string): ModelName {
  if (id) {
    const m = id.match(/claude-(\w+)-(\d+)-(\d+)(?:-\d+)?(?:\[(\w+)\])?/);
    if (m) {
      const family = `${m[1][0].toUpperCase()}${m[1].slice(1)}`;
      return {
        name: `${family} ${m[2]}.${m[3]}`,
        variant: m[4] ? m[4].toUpperCase() : null,
      };
    }
  }
  if (displayName) {
    const stripped = displayName.replace(/\s*\(.*?\)\s*/g, '').trim();
    if (stripped) return { name: stripped, variant: null };
  }
  return { name: 'Claude', variant: null };
}
