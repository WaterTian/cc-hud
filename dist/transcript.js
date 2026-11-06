// Transcript tail reader — last 64 KB of the session JSONL → running
// subagents and the latest main-chain reasoning effort. Any read / parse
// failure → EMPTY.
//
// Subagents come from two sources, merged by tool_use id:
//   • sidecar — Claude Code launches Agent calls asynchronously: the
//     tool_result arrives at once ("async_launched") and the run is tracked in
//     <transcript dir>/<session>/subagents/agent-<id>.meta.json, written at
//     launch and rewritten with `finished: true` at the end. This is the
//     authoritative source and is independent of the 64 KB window.
//   • transcript — an Agent tool_use without any tool_result (older builds
//     that ran agents synchronously).
import { open, readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
const EMPTY = { agents: [], effort: null };
const TAIL_BYTES = 64 * 1024; // 64 KB — agent entries & the latest effort are near the end
// An unfinished meta whose agent transcript has not grown for this long is a
// leftover from a killed session, not a running agent.
export const AGENT_HEARTBEAT_MS = 15 * 60 * 1000;
const str = (v) => (typeof v === 'string' && v ? v : undefined);
async function readTail(filePath) {
    const info = await stat(filePath);
    if (!info.isFile() || info.size === 0)
        return '';
    const fd = await open(filePath, 'r');
    try {
        const start = Math.max(0, info.size - TAIL_BYTES);
        // Read one byte before the window (when there is one): if it is '\n' the
        // window begins on a line boundary and its first line is complete.
        const from = start > 0 ? start - 1 : 0;
        const len = info.size - from;
        const buf = Buffer.alloc(len);
        let got = 0;
        // A single read may come back short — keep going until the window is full
        while (got < len) {
            const { bytesRead } = await fd.read(buf, got, len - got, from + got);
            if (bytesRead === 0)
                break;
            got += bytesRead;
        }
        const data = buf.subarray(0, got);
        if (start === 0)
            return data.toString('utf8');
        const text = data.subarray(1).toString('utf8');
        if (data[0] === 0x0a)
            return text;
        // Window starts mid-line: drop that partial first line
        const nl = text.indexOf('\n');
        return nl >= 0 ? text.slice(nl + 1) : '';
    }
    finally {
        await fd.close();
    }
}
// Sidecar scan: every agent-*.meta.json without `finished: true` whose
// transcript (or, failing that, the meta file) was touched recently.
async function sidecarAgents(transcriptPath) {
    const dir = join(transcriptPath.replace(/\.jsonl$/i, ''), 'subagents');
    let names;
    try {
        names = (await readdir(dir)).filter(n => n.endsWith('.meta.json')).sort();
    }
    catch {
        return [];
    }
    const now = Date.now();
    const found = await Promise.all(names.map(async (name) => {
        try {
            const metaPath = join(dir, name);
            const meta = JSON.parse(await readFile(metaPath, 'utf8'));
            if (meta.finished === true)
                return null;
            const beat = await stat(metaPath.replace(/\.meta\.json$/, '.jsonl')).catch(() => stat(metaPath));
            if (now - beat.mtimeMs > AGENT_HEARTBEAT_MS)
                return null;
            return {
                id: str(meta.toolUseId) ?? name,
                type: str(meta.agentType) ?? 'general-purpose',
                model: str(meta.model),
                description: str(meta.description),
                status: 'running',
            };
        }
        catch {
            return null;
        }
    }));
    return found.filter((a) => a !== null);
}
// Single tail read → active subagents + current thinking depth.
export async function parseTranscript(transcriptPath) {
    if (!transcriptPath)
        return EMPTY;
    const sidecar = sidecarAgents(transcriptPath);
    let text;
    try {
        text = await readTail(transcriptPath);
    }
    catch {
        text = '';
    }
    const agents = new Map();
    const settled = new Set(); // tool_use ids with a tool_result (sync completion or async launch)
    let effort = null; // last (= most recent) main-chain assistant effort wins
    for (const line of text.split('\n')) {
        // Fast pre-filter: skip lines that carry neither agent data nor an effort field
        const maybeAgent = line.includes('"Agent"') || line.includes('"tool_result"');
        const maybeEffort = line.includes('"effort"');
        if (!maybeAgent && !maybeEffort)
            continue;
        let entry;
        try {
            entry = JSON.parse(line);
        }
        catch {
            continue;
        }
        // Thinking depth = the effort of the newest main-chain assistant turn.
        // Ignore sidechain (subagent) turns — they carry their own effort.
        if (entry.type === 'assistant' && entry.isSidechain !== true && typeof entry.effort === 'string') {
            effort = entry.effort;
        }
        const blocks = entry.message?.content;
        if (!Array.isArray(blocks))
            continue;
        for (const block of blocks) {
            if (block.type === 'tool_use' && block.name === 'Agent' && block.id) {
                const input = block.input ?? {};
                agents.set(block.id, {
                    id: block.id,
                    type: input.subagent_type ?? 'general-purpose',
                    model: input.model,
                    description: input.description,
                    status: 'running',
                });
            }
            // Either a real completion or the immediate "async_launched" receipt —
            // in both cases the transcript no longer knows whether the agent runs;
            // the sidecar does.
            if (block.type === 'tool_result' && block.tool_use_id)
                settled.add(block.tool_use_id);
        }
    }
    for (const id of settled)
        agents.delete(id);
    for (const a of await sidecar)
        agents.set(a.id, a);
    return { agents: [...agents.values()], effort };
}
