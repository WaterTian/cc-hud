export async function readStdin() {
    if (process.stdin.isTTY)
        return {};
    const chunks = [];
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) {
        chunks.push(chunk);
    }
    const raw = chunks.join('');
    if (!raw.trim())
        return {};
    try {
        // `null`, a number, a string or an array parse fine but aren't a payload —
        // treat anything that isn't a plain object as "no data".
        const parsed = JSON.parse(raw);
        return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed
            : {};
    }
    catch {
        return {};
    }
}
