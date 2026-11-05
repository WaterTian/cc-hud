#!/usr/bin/env node
// npm `cc-hud` entry. No arguments: the Claude Code statusline renderer
// (stdin JSON → one line, see index.ts). With arguments: one-time Codex CLI
// configuration commands. Typed in a terminal with nothing on stdin it prints
// help instead of a meaningless bare line.
import { readFileSync } from 'node:fs';
const HELP = `cc-hud — Claude Code statusline / Codex CLI native footer

  cc-hud                      Render Claude Code statusline JSON from stdin (one line)
  cc-hud setup codex          Save the compact native footer preset
  cc-hud check codex          Exit 0 when the preset is active, 1 otherwise
  cc-hud restore codex        Put back the footer saved by setup
  cc-hud theme codex          Apply the optional CC-HUD theme (also colors syntax)
  cc-hud restore-theme codex  Put back the theme settings saved by theme
  cc-hud --version
`;
const COMMANDS = {
    setup: () => import('./codex.js').then(m => m.codexCommand('setup')),
    check: () => import('./codex.js').then(m => m.codexCommand('check')),
    restore: () => import('./codex.js').then(m => m.codexCommand('restore')),
    theme: () => import('./codex-theme.js').then(m => m.codexTheme(false)),
    'restore-theme': () => import('./codex-theme.js').then(m => m.codexTheme(true)),
};
const [action, target, ...rest] = process.argv.slice(2);
if (action === undefined) {
    if (process.stdin.isTTY)
        process.stdout.write(HELP);
    else
        await import('./index.js');
}
else if (target === undefined && (action === '--help' || action === '-h')) {
    process.stdout.write(HELP);
}
else if (target === undefined && (action === '--version' || action === '-v')) {
    const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    process.stdout.write(`${version}\n`);
}
else if (target === 'codex' && rest.length === 0 && Object.hasOwn(COMMANDS, action)) {
    try {
        await COMMANDS[action]();
    }
    catch (error) {
        process.stderr.write(`cc-hud: ${error instanceof Error ? error.message : 'Codex configuration failed.'}\n`);
        process.exitCode = 1;
    }
}
else {
    process.stderr.write('Usage: cc-hud [setup|check|restore|theme|restore-theme] codex (or --help)\n');
    process.exitCode = 1;
}
