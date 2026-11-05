#!/usr/bin/env node
// npm entry: no arguments keeps the existing Claude stdin renderer.
const args = process.argv.slice(2);
if (args.length === 0) {
  await import('./index.js');
} else if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
  process.stdout.write('cc-hud: Claude statusline / Codex native footer\n\ncc-hud setup codex          Save the compact native footer\ncc-hud check codex          Check the saved footer\ncc-hud restore codex        Restore the previous footer\ncc-hud theme codex          Apply the optional CC-HUD theme\ncc-hud restore-theme codex  Restore the previous theme settings\n\nNo arguments: render Claude statusline JSON from stdin.\n');
} else if (args.length === 2 && args[1] === 'codex' && ['theme', 'restore-theme'].includes(args[0])) {
  try {
    const { codexTheme } = await import('./codex-theme.js');
    await codexTheme(args[0] === 'restore-theme');
  } catch (error) {
    process.stderr.write(`cc-hud: ${error instanceof Error ? error.message : 'Codex theme configuration failed.'}\n`);
    process.exitCode = 1;
  }
} else if (args.length === 2 && args[1] === 'codex' && ['setup', 'check', 'restore'].includes(args[0])) {
  try {
    const { codexCommand } = await import('./codex.js');
    await codexCommand(args[0] as 'setup' | 'check' | 'restore');
  } catch (error) {
    process.stderr.write(`cc-hud: ${error instanceof Error ? error.message : 'Codex configuration failed.'}\n`);
    process.exitCode = 1;
  }
} else {
  process.stderr.write('Usage: cc-hud [setup|check|restore|theme|restore-theme] codex (or --help)\n');
  process.exitCode = 1;
}
