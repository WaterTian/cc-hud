function tryParse(raw) {
    // claude-<family>-<major>[-<minor>][-<yyyymmdd>][[variant]]
    // The minor is at most 3 digits so a dated single-version id
    // (claude-sonnet-4-20250514) doesn't read its snapshot date as "4.20250514".
    const cm = raw.match(/claude-([a-z]+)-(\d+)(?:-(\d{1,3})(?!\d))?(?:-\d{4,})?(?:\[(\w+)\])?/i);
    if (cm) {
        const family = `${cm[1][0].toUpperCase()}${cm[1].slice(1)}`;
        return {
            name: cm[3] ? `${family} ${cm[2]}.${cm[3]}` : `${family} ${cm[2]}`,
            variant: cm[4] ? cm[4].toUpperCase() : null,
        };
    }
    // deepseek-v4 / deepseek-v4-pro / deepseek-chat / deepseek-reasoner
    const dm = raw.match(/^deepseek-(v\d+(?:-\w+)?|chat|reasoner)(?:\[(\w+)\])?$/i);
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
        const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
        const name = sub ? `${family} ${sub.split('-').map(capitalize).join(' ')}` : family;
        return { name, variant: mm[3] ? mm[3].toUpperCase() : null };
    }
    return null;
}
export function shortModelName(displayName, id) {
    // Try id first (carries accurate [1m] variant suffix)
    if (id) {
        const r = tryParse(id);
        if (r)
            return r;
    }
    if (displayName) {
        // Some backends (e.g. GLM) only send display_name — try regex on it too
        const r = tryParse(displayName);
        if (r)
            return r;
        // Plain fallback: strip parenthesized text
        const stripped = displayName.replace(/\s*\(.*?\)\s*/g, '').trim();
        if (stripped)
            return { name: stripped, variant: null };
    }
    return { name: 'Claude', variant: null };
}
