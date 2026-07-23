// Prefer `id` over `display_name`: only id carries the `[1m]` variant suffix
// for extended-context mode (display_name surfaces it as free text "(1M context)").
export interface ModelName {
  name: string;
  variant: string | null;
}

function tryParse(raw: string): ModelName | null {
  const cm = raw.match(/claude-(\w+)-(\d+)-(\d+)(?:-\d+)?(?:\[(\w+)\])?/);
  if (cm) {
    const family = `${cm[1][0].toUpperCase()}${cm[1].slice(1)}`;
    return {
      name: `${family} ${cm[2]}.${cm[3]}`,
      variant: cm[4] ? cm[4].toUpperCase() : null,
    };
  }
  // Single-version ids (claude-fable-5) — no minor number to dot-join
  const cs = raw.match(/^claude-(\w+)-(\d+)(?:\[(\w+)\])?$/);
  if (cs) {
    const family = `${cs[1][0].toUpperCase()}${cs[1].slice(1)}`;
    return {
      name: `${family} ${cs[2]}`,
      variant: cs[3] ? cs[3].toUpperCase() : null,
    };
  }

  const dm = raw.match(/^deepseek-(v\d+(?:-\w+))(?:\[(\w+)\])?$/);
  if (dm) {
    const v = dm[1].replace(/^v/, 'V').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return { name: `DeepSeek ${v}`, variant: dm[2] ? dm[2].toUpperCase() : null };
  }

  const glm = raw.match(/^(glm|chatglm)[-_]([\w.]+(?:-\w+)?)(?:\[(\w+)\])?$/i);
  if (glm) {
    const prefix = glm[1].toLowerCase() === 'chatglm' ? 'ChatGLM' : 'GLM';
    const model = glm[2].split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
    return { name: `${prefix} ${model}`, variant: glm[3] ? glm[3].toUpperCase() : null };
  }

  const mm = raw.match(/^(MiniMax|abab)(?:-([\w][\w.-]*))?(?:\[(\w+)\])?$/);
  if (mm) {
    const family = mm[1] === 'abab' ? 'ABAB' : 'MiniMax';
    const sub = mm[2];
    const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
    const name = sub ? `${family} ${sub.split('-').map(capitalize).join(' ')}` : family;
    return { name, variant: mm[3] ? mm[3].toUpperCase() : null };
  }

  return null;
}

export function shortModelName(displayName?: string, id?: string): ModelName {
  // Try id first (carries accurate [1m] variant suffix)
  if (id) {
    const r = tryParse(id);
    if (r) return r;
  }
  if (displayName) {
    // Some backends (e.g. GLM) only send display_name — try regex on it too
    const r = tryParse(displayName);
    if (r) return r;
    // Plain fallback: strip parenthesized text
    const stripped = displayName.replace(/\s*\(.*?\)\s*/g, '').trim();
    if (stripped) return { name: stripped, variant: null };
  }
  return { name: 'Claude', variant: null };
}
