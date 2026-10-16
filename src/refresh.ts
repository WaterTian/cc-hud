// Detached cache refresher — spawned by cache.ts on a stale/missing cache:
//   node refresh.js <kind>
// Runs outside the statusline tick, so it can afford a relaxed budget:
// Keychain read + native fetch + curl fallback, then write ~/.cache/cc-hud/.
import { refreshClaudePlan } from './claude.js';
import type { RefreshKind } from './cache.js';

setTimeout(() => process.exit(0), 8000).unref();

const jobs: Record<RefreshKind, () => Promise<void>> = {
  claude: refreshClaudePlan,
};

const job = jobs[process.argv[2] as RefreshKind];
(job ? job() : Promise.resolve()).then(
  () => process.exit(0),
  () => process.exit(0),
);
