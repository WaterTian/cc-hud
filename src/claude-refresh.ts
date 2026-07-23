// Detached cache refresher — spawned by claude.ts on stale/missing cache.
// Runs outside the statusline tick, so it can afford a relaxed budget:
// Keychain read + native fetch + curl fallback, then write ~/.cache/cc-hud/.
import { refreshClaudePlan } from './claude.js';

setTimeout(() => process.exit(0), 8000).unref();

refreshClaudePlan().then(
  () => process.exit(0),
  () => process.exit(0),
);
