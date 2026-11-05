const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
// "v4-pro" → "V4 Pro", "5.2-air" → "5.2 Air"
const titleCase = (s) => s.split('-').map(capitalize).join(' ');
const variantOf = (v) => (v ? v.toUpperCase() : null);
function tryParse(raw) {
    // claude-<family>-<major>[-<minor>][-<yyyymmdd>][[variant]]
    // The minor is at most 3 digits so a dated single-version id
    // (claude-sonnet-4-20250514) doesn't read its snapshot date as "4.20250514".
    const cm = raw.match(/claude-([a-z]+)-(\d+)(?:-(\d{1,3})(?!\d))?(?:-\d{4,})?(?:\[(\w+)\])?/i);
    if (cm) {
        const family = capitalize(cm[1]);
        return {
            name: cm[3] ? `${family} ${cm[2]}.${cm[3]}` : `${family} ${cm[2]}`,
            variant: variantOf(cm[4]),
        };
    }
    // deepseek-v4 / deepseek-v4-pro / deepseek-chat / deepseek-reasoner
    const dm = raw.match(/^deepseek-(v\d+(?:-\w+)?|chat|reasoner)(?:\[(\w+)\])?$/i);
    if (dm) {
        return { name: `DeepSeek ${titleCase(dm[1])}`, variant: variantOf(dm[2]) };
    }
    const glm = raw.match(/^(glm|chatglm)[-_]([\w.]+(?:-\w+)?)(?:\[(\w+)\])?$/i);
    if (glm) {
        const prefix = glm[1].toLowerCase() === 'chatglm' ? 'ChatGLM' : 'GLM';
        return { name: `${prefix} ${titleCase(glm[2])}`, variant: variantOf(glm[3]) };
    }
    const mm = raw.match(/^(MiniMax|abab)(?:-([\w][\w.-]*))?(?:\[(\w+)\])?$/);
    if (mm) {
        const family = mm[1] === 'abab' ? 'ABAB' : 'MiniMax';
        const name = mm[2] ? `${family} ${titleCase(mm[2])}` : family;
        return { name, variant: variantOf(mm[3]) };
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
