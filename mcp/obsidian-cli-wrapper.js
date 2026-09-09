/**
 * obsidian-cli wrapper — console-safe proxy for the Obsidian desktop CLI.
 *
 * Why: this machine's Obsidian installer (1.9.12) predates the official CLI
 * redirector, so the bare Obsidian.exe prints bootstrap log lines ("Loading
 * updated app package", "Your Obsidian installer is out of date") into stdout.
 * The opencode-obsidian plugin parses tool stdout strictly (JSON.parse for
 * search/property), so those lines break it. This wrapper spawns the exe,
 * strips known noise lines, and forwards clean stdout/stderr + exit code.
 *
 * Requires the Obsidian app to be RUNNING (official CLI requirement).
 */
const { spawnSync } = require("child_process");

const EXE = process.env.OBSIDIAN_EXE || "D:\\Install\\Obsidian\\Obsidian.exe"; // TODO: set OBSIDIAN_EXE env var to your Obsidian.exe path (<OBSIDIAN_EXE>). Fallback kept as example only.
const NOISE = [
  /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\s+Loading updated app package/,
  /^Your Obsidian installer is out of date/,
];

const args = process.argv.slice(2);
if (args.length === 0) {
  process.stderr.write("usage: obsidian-cli <obsidian-command> [args]\n");
  process.exit(2);
}

const res = spawnSync(EXE, args, { encoding: "utf8", timeout: 20000, windowsHide: true });

if (res.error) {
  process.stderr.write(`wrapper error: ${res.error.message}\n`);
  process.exit(1);
}

const clean = (res.stdout || "")
  .split("\n")
  .filter((l) => !NOISE.some((r) => r.test(l.trim())))
  .join("\n");

process.stdout.write(clean);
if (res.stderr) process.stderr.write(res.stderr);
process.exit(res.status ?? 0);
