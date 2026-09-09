/**
 * opencode-orchestrator-mcp — local MCP server for the orchestration platform.
 *
 * Tools:
 *  - telemetry_summary : aggregate surveillance stats (rows, by kind, failures, injection flags)
 *  - telemetry_errors  : recent tool failures / error events
 *  - memory_read       : newest notes from the Obsidian memory vault (<VAULT_PATH> -- set via MEMORY_VAULT env; TODO: configure your vault path)
 *  - config_status     : current opencode config + telemetry presence
 *  - run_task          : launch a headless `opencode run` (background agent) and return its pid
 *
 * All logs go to stderr — stdout is reserved for the MCP protocol.
 */
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");

const CONFIG_DIR = path.join(os.homedir(), ".config", "opencode");
const TELEMETRY_DIR = path.join(CONFIG_DIR, "telemetry");
const MEMORY_VAULT = process.env.MEMORY_VAULT || path.join(os.homedir(), "AgentMemory"); // TODO: picks up MEMORY_VAULT env; default ~/AgentMemory -- original author default was D:\Kaam\AgentMemory (<VAULT_PATH>)
const LEARNINGS_DIR = path.join(MEMORY_VAULT, "Learnings");
const OPENCODE_BIN = process.env.OPENCODE_BIN || "opencode";

// Newest-first list of vault learning notes (filenames sort by ISO date prefix).
function readVaultNotes() {
  if (!fs.existsSync(LEARNINGS_DIR)) return [];
  return fs
    .readdirSync(LEARNINGS_DIR)
    .filter((f) => f.endsWith(".md") && !f.startsWith("_"))
    .sort()
    .reverse();
}

function readTelemetry(days) {
  const files = fs.existsSync(TELEMETRY_DIR)
    ? fs.readdirSync(TELEMETRY_DIR).filter((f) => f.startsWith("run-") && f.endsWith(".jsonl")).sort()
    : [];
  const cutoff = Date.now() - days * 86400000;
  const rows = [];
  for (const f of files) {
    const m = f.match(/run-(\d{4}-\d{2}-\d{2})\.jsonl/);
    if (m && new Date(m[1]).getTime() < cutoff) continue;
    const lines = fs.readFileSync(path.join(TELEMETRY_DIR, f), "utf8").split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        rows.push(JSON.parse(line));
      } catch {
        /* skip malformed line */
      }
    }
  }
  return rows;
}

const server = new McpServer({ name: "opencode-orchestrator", version: "0.1.0" });

server.tool(
  "telemetry_summary",
  { days: z.number().int().min(1).max(30).default(1) },
  async ({ days = 1 }) => {
    const rows = readTelemetry(days);
    const byKind = {};
    let failures = 0;
    let injections = 0;
    const toolsUsed = {};
    for (const r of rows) {
      byKind[r.kind] = (byKind[r.kind] || 0) + 1;
      if (r.kind === "tool.after") {
        const t = r.data && r.data.tool;
        if (t) toolsUsed[t] = (toolsUsed[t] || 0) + 1;
        if (r.data && r.data.ok === false) failures++;
        if (r.data && Array.isArray(r.data.injectionFlags) && r.data.injectionFlags.length) injections++;
      }
    }
    const topTools = Object.entries(toolsUsed)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([t, c]) => `${t}: ${c}`)
      .join(", ");
    const text = [
      `Telemetry rows (last ${days}d): ${rows.length}`,
      `By kind: ${JSON.stringify(byKind)}`,
      `Tool failures: ${failures}`,
      `Injection flags: ${injections}`,
      `Top tools: ${topTools || "none"}`,
    ].join("\n");
    return { content: [{ type: "text", text }] };
  },
);

server.tool(
  "telemetry_errors",
  { days: z.number().int().min(1).max(30).default(1), limit: z.number().int().min(1).max(100).default(20) },
  async ({ days = 1, limit = 20 }) => {
    const rows = readTelemetry(days).filter(
      (r) =>
        (r.kind === "tool.after" && r.data && r.data.ok === false) ||
        (r.kind === "event" && /error|failed/i.test(r.data && r.data.type ? r.data.type : "")),
    );
    const out = rows
      .slice(-limit)
      .map((r) => `${r.t} | ${r.kind} | ${JSON.stringify(r.data).slice(0, 300)}`)
      .join("\n");
    return { content: [{ type: "text", text: out || "No errors in range." }] };
  },
);

server.tool(
  "memory_read",
  { lines: z.number().int().min(5).max(500).default(100) },
  async ({ lines = 100 }) => {
    const notes = readVaultNotes();
    if (notes.length === 0) {
      return { content: [{ type: "text", text: `Memory vault empty or missing at ${LEARNINGS_DIR}.` }] };
    }
    // Newest notes first, up to the requested line budget.
    const out = [];
    let used = 0;
    for (const f of notes) {
      const body = fs.readFileSync(path.join(LEARNINGS_DIR, f), "utf8").split("\n");
      if (used + body.length > lines && out.length > 0) {
        out.push(`(${notes.length - notes.indexOf(f)} older notes omitted — raise ?lines to see more)`);
        break;
      }
      out.push(...body);
      used += body.length;
    }
    return { content: [{ type: "text", text: out.join("\n") }] };
  },
);

server.tool("config_status", {}, async () => {
  const cfgPath = path.join(CONFIG_DIR, "opencode.jsonc");
  const cfg = fs.existsSync(cfgPath) ? fs.readFileSync(cfgPath, "utf8") : "(missing)";
  const telemetryFiles = fs.existsSync(TELEMETRY_DIR)
    ? fs.readdirSync(TELEMETRY_DIR).filter((f) => f.startsWith("run-")).length
    : 0;
  const text = [
    `Telemetry files: ${telemetryFiles}`,
    `Memory vault: ${MEMORY_VAULT} (${readVaultNotes().length} learning notes)`,
    `--- opencode.jsonc (first 40 lines) ---`,
    cfg.split("\n").slice(0, 40).join("\n"),
  ].join("\n");
  return { content: [{ type: "text", text }] };
});

server.tool(
  "run_task",
  { agent: z.string().min(1), task: z.string().min(1) },
  async ({ agent, task }) => {
    const child = spawn(OPENCODE_BIN, ["run", "--agent", agent, task], {
      detached: true,
      stdio: "ignore",
      shell: process.platform === "win32",
    });
    child.unref();
    return {
      content: [
        {
          type: "text",
          text: `Launched headless run: opencode run --agent ${agent} (pid ${child.pid}). Output is not captured by the MCP server; check the run in the opencode UI or via /observe.`,
        },
      ],
    };
  },
);

const transport = new StdioServerTransport();
server
  .connect(transport)
  .then(() => console.error("opencode-orchestrator-mcp ready"))
  .catch((e) => {
    console.error("orchestrator-mcp failed to start:", e);
    process.exit(1);
  });