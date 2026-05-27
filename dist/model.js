export function shortModelName(displayName, id) {
    if (id) {
        const cm = id.match(/claude-(\w+)-(\d+)-(\d+)(?:-\d+)?(?:\[(\w+)\])?/);
        if (cm) {
            const family = `${cm[1][0].toUpperCase()}${cm[1].slice(1)}`;
            return {
                name: `${family} ${cm[2]}.${cm[3]}`,
                variant: cm[4] ? cm[4].toUpperCase() : null,
            };
        }
        const dm = id.match(/^deepseek-(v\d+(?:-\w+))$/);
        if (dm) {
            const v = dm[1].replace(/^v/, 'V').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            return { name: `DeepSeek ${v}`, variant: null };
        }
    }
    if (displayName) {
        const stripped = displayName.replace(/\s*\(.*?\)\s*/g, '').trim();
        if (stripped)
            return { name: stripped, variant: null };
    }
    return { name: 'Claude', variant: null };
}
