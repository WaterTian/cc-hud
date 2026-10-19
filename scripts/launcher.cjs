#!/usr/bin/env node
// Stable-path indirection for ~/.claude/settings.json statusLine. Written by
// /cc-hud:setup to ~/.claude/bin/cc-hud-launcher.cjs; resolves the currently
// installed cc-hud on each tick so plugin upgrades don't require re-running
// setup. Never blocks Claude Code: a failure prints one short hint (or
// nothing), never an error.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const SPAWN_TIMEOUT_MS = 3000;

// Claude Code's config dir: CLAUDE_CONFIG_DIR when set, else ~/.claude
function defaultConfigDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

// Resolve the newest marketplace-installed cc-hud's dist/index.js, or null
// (e.g. a from-source checkout wired directly into statusLine is not listed).
function findCcHudEntry(configDir) {
  const cfg = configDir || defaultConfigDir();
  try {
    const pluginsFile = path.join(cfg, 'plugins', 'installed_plugins.json');
    const data = JSON.parse(fs.readFileSync(pluginsFile, 'utf8'));
    const entries = (data && data.plugins) || {};

    const candidates = [];
    for (const [key, arr] of Object.entries(entries)) {
      if (!key.startsWith('cc-hud@')) continue;
      if (!Array.isArray(arr)) continue;
      for (const entry of arr) {
        if (entry && entry.installPath) candidates.push(entry);
      }
    }
    candidates.sort((a, b) => {
      const ta = a.lastUpdated ? Date.parse(a.lastUpdated) || 0 : 0;
      const tb = b.lastUpdated ? Date.parse(b.lastUpdated) || 0 : 0;
      return tb - ta;
    });
    for (const entry of candidates) {
      const distEntry = path.join(entry.installPath, 'dist', 'index.js');
      if (fs.existsSync(distEntry)) return distEntry;
    }
  } catch {}
  return null;
}

function readStdinSync() {
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

const NOT_FOUND = '[cc-hud] plugin not found — run /cc-hud:setup';

function main() {
  const entry = findCcHudEntry();
  if (!entry) {
    // A visible hint beats a silently blank bar
    process.stdout.write(NOT_FOUND + '\n');
    return;
  }
  const raw = readStdinSync();
  try {
    const res = spawnSync(process.execPath, [entry], {
      input: raw,
      encoding: 'utf8',
      windowsHide: true,
      timeout: SPAWN_TIMEOUT_MS,
      killSignal: 'SIGKILL',
    });
    if (res && typeof res.stdout === 'string') process.stdout.write(res.stdout);
  } catch {}
}

module.exports = { findCcHudEntry, defaultConfigDir, NOT_FOUND };

if (require.main === module) {
  process.on('uncaughtException', () => {});
  process.on('unhandledRejection', () => {});
  main();
}
