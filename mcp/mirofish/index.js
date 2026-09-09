/**
 * opencode-mirofish-mcp — local MCP server that proxies the MiroFish prediction
 * engine REST API as typed tools for opencode agents.
 *
 * Tools (server name "mirofish", so tools appear as `mirofish_*`):
 *  - health / list_projects / get_project               : projects & health
 *  - ontology_generate / build_graph / task_status      : ontology + graph build
 *  - create_simulation / prepare / prepare_status       : simulation setup
 *  - simulation_start / simulation_status / stop        : run lifecycle
 *  - generate_report / report_status / get_report / chat: reporting
 *  - list_simulations / timeline / agent_stats / check  : support/read helpers
 *
 * The server is a dumb, stateless HTTP proxy to
 * http://localhost:5001 (overridable via MIROFISH_BASE_URL). It NEVER starts
 * the backend — MiroFish lifecycle is owned by an opencode command, and a down
 * backend surfaces as an ERROR result so the agent can run `/mirofish start`.
 *
 * All logs go to stderr — stdout is reserved for the MCP protocol.
 */
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os"); // portable homedir for default paths (see TODOs below)

const BASE_URL = (process.env.MIROFISH_BASE_URL || "http://localhost:5001").replace(/\/+$/, "");
const DEFAULT_TIMEOUT = 30_000; // 30s default
const LONG_TIMEOUT = 180_000; // 180s for ontology_generate & simulation_start
const ERROR_LEN_CAP = 500;

// ---------------------------------------------------------------------------
// Lazy backend auto-start.
//
// The MiroFish Flask backend normally must be started manually (`/mirofish
// backend`). Instead, this MCP server ENSURES the backend is running whenever a
// mirofish_* tool is called: it probes /health, and if the backend is down it
// spawns it detached (works even after this MCP process exits) and waits until
// it answers. `_backendUp` caches the resolved state so we don't re-probe or
// re-spawn on every call.
//
// Lifecycle: the child is detached and unref'd, so it survives the MCP server
// being shut down by opencode. It is not killed on exit.
// ---------------------------------------------------------------------------

// TODO: set MIROFISH_BACKEND_DIR / MIROFISH_BACKEND_LOG env vars (see .env.example).
// Defaults are portable (~/MiroFish/backend). Original author defaults were
// D:\MiroFish\backend and D:\MiroFish\backend\logs\backend.log (<MIROFISH_DIR>).
const BACKEND_DIR = process.env.MIROFISH_BACKEND_DIR || path.join(os.homedir(), "MiroFish", "backend");
const BACKEND_LOG = process.env.MIROFISH_BACKEND_LOG || path.join(os.homedir(), "MiroFish", "backend", "logs", "backend.log");
const { spawn } = require("node:child_process");
const BACKEND_START_TIMEOUT_MS = 45_000; // worst case for venv + torch import to boot

let _backendUp = null; // null = not checked yet, Promise<bool> = in flight / resolved

function probeHealth(timeoutMs = 4000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(BASE_URL + "/health", { signal: controller.signal })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => clearTimeout(timer));
}

/** Locate a `uv` executable on PATH (fallback to common install dirs). */
function findUv() {
  const candidates = ["uv", "uv.exe"];
  for (const c of candidates) {
    try {
      const r = require("node:child_process").spawnSync(c, ["--version"], {
        encoding: "utf8",
        windowsHide: true,
      });
      if (r.status === 0) return c;
    } catch {
      /* try next */
    }
  }
  // TODO: add your own uv fallback paths here if uv is not on PATH.
  // Original author fallbacks (<HOME> based) were kept as portable examples:
  const common = [
    path.join(os.homedir(), ".local", "bin", "uv"),
    path.join(os.homedir(), ".local", "bin", "uv.exe"),
  ];
  for (const p of common) {
    try {
      const r = require("fs").existsSync(p) ? p : null;
      if (r) return r;
    } catch {
      /* ignore */
    }
  }
  return null;
}

/** Spawn the Flask backend fully detached, logging to BACKEND_LOG. */
function spawnBackend() {
  const dir = require("node:path");
  const logDir = dir.dirname(BACKEND_LOG);
  try {
    require("fs").mkdirSync(logDir, { recursive: true });
  } catch {
    /* ignore */
  }
  const uv = findUv() || "uv";
  // Spawn `uv run python run.py` directly with cwd set to the backend dir and
  // stdout/stderr redirected to a log file via file descriptors. The child is
  // detached + unref'd so it survives after the MCP server exits. Using cwd +
  // fd redirect (instead of `cmd /c cd ... &&`) proved reliable for this
  // backend (torch import needs a few seconds to boot).
  let logFd = -1;
  try {
    logFd = require("fs").openSync(BACKEND_LOG, "a");
  } catch {
    /* fall back to ignore */
  }
  const stdio = logFd >= 0 ? ["ignore", logFd, logFd] : "ignore";
  const child = spawn(uv, ["run", "python", "run.py"], {
    cwd: BACKEND_DIR,
    detached: true,
    windowsHide: true,
    stdio,
  });
  if (logFd >= 0) require("fs").closeSync(logFd);
  child.unref(); // let the backend outlive this MCP process
  return child;
}

/** Ensure the backend is up (spawning it on demand). Returns true when ready. */
async function ensureBackend() {
  if (_backendUp) return _backendUp;
  if (await probeHealth()) {
    _backendUp = true;
    return true;
  }
  spawnBackend();
  const deadline = Date.now() + BACKEND_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    if (await probeHealth()) {
      _backendUp = true;
      return true;
    }
  }
  _backendUp = false;
  throw new Error(
    `MiroFish backend did not come up within ${Math.round(BACKEND_START_TIMEOUT_MS / 1000)}s ` +
      `after auto-start. Check ${BACKEND_LOG}.`
  );
}

/** Forget the cached state so the next call can retry auto-start. */
function dropBackendState() {
  _backendUp = null;
}

/**
 * Strip an error/message down to a safe, compact string (< ERROR_LEN_CAP chars).
 */
function safeErr(msg) {
  return String(msg || "unknown error").replace(/\s+/g, " ").trim().slice(0, ERROR_LEN_CAP);
}

/**
 * Core HTTP proxy helper. Returns the trimmed JSON `data` payload on success,
 * or throws/returns an ERROR text fragment on failure. callers map the result
 * into MCP `{ content: [{ type: "text", text }] }`.
 *
 * @returns {{data: any, raw: string, status: number}}
 */
async function request(method, urlPath, { query, json, form, timeoutMs } = {}) {
  const target = BASE_URL + urlPath;
  const headers = {};
  let body = undefined;

  if (json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(json);
  } else if (form !== undefined) {
    body = form; // FormData carries its own multipart Content-Type
  }

  if (query) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
    }
    const s = qs.toString();
    if (s) target += (target.includes("?") ? "&" : "?") + s;
  }

  // On-demand backend startup: ensure the Flask service is up before serving.
  await ensureBackend();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || DEFAULT_TIMEOUT);

  let resp;
  try {
    resp = await fetch(target, {
      method,
      headers,
      body,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    // If the backend died mid-session, forget the cached state so the next
    // call tries to (re)start it.
    dropBackendState();
    throw new Error(
      `ERROR: could not reach MiroFish at ${BASE_URL} — ${safeErr(
        err.code === "ABORT_ERR" ? `request timed out after ${(timeoutMs || DEFAULT_TIMEOUT) / 1000}s` : err.message
      )}. The backend was auto-started; if it stays down check ${BACKEND_LOG}.`
    );
  }
  clearTimeout(timer);

  let parsed = null;
  try {
    parsed = await resp.json();
  } catch {
    parsed = null;
  }

  if (!resp.ok) {
    const errBody = parsed && (parsed.error || parsed.message);
    const msg = `ERROR (HTTP ${resp.status}): ${safeErr(errBody || resp.statusText)}`;
    if (resp.status === 409) {
      throw new Error(`${msg} — this usually means the simulation/report is not in a terminal state yet.`);
    }
    throw new Error(msg);
  }

  // Response envelope is { success, data, ... }. Surface the `data` payload.
  const data = parsed && typeof parsed === "object" && "data" in parsed ? parsed.data : parsed;
  return { data, status: resp.status };
}

/**
 * Compact a value into a short, tool-friendly JSON text. Large lists are
 * reduced to counts + a small sample of identifier fields; bulk bodies
 * (ontology, report content, chat) are trimmed. Never echo raw dumps.
 */
function compact(data) {
  if (data === undefined || data === null) return JSON.stringify(data);

  if (Array.isArray(data)) {
    if (data.length <= 20) return JSON.stringify(data.map((x) => compact(x)));
    return JSON.stringify({
      count: data.length,
      sample: data.slice(0, 5).map((x) => compact(x)),
      note: `${data.length} items — truncated to 5 in sample`,
    });
  }

  if (typeof data === "object") {
    const out = {};
    for (const [k, v] of Object.entries(data)) {
      // Large nested text bodies collapse to a length summary/preview.
      if (typeof v === "string" && v.length > 400) {
        out[k] = { length: v.length, preview: v.slice(0, 200) + "…" };
      } else if (Array.isArray(v) && v.length > 20) {
        out[k] = compact(v);
      } else {
        out[k] = v;
      }
    }
    return JSON.stringify(out);
  }

  return JSON.stringify(data);
}

/** Wrap a tool result in the standard MCP single-text content shape. */
function text(str) {
  return { content: [{ type: "text", text: str }] };
}

const server = new McpServer({ name: "mirofish", version: "0.1.0" });

// ============================================================ CORE

server.tool(
  "health",
  {},
  async () => {
    try {
      const { data } = await request("GET", "/health");
      return text(compact(data));
    } catch (err) {
      return text(String(err.message || err));
    }
  },
);

server.tool(
  "list_projects",
  { limit: z.number().int().min(1).max(500).optional().describe("Max projects to return (default 50)") },
  async ({ limit }) => {
    try {
      const { data } = await request("GET", "/api/graph/project/list", { query: { limit } });
      return text(compact(data));
    } catch (err) {
      return text(String(err.message || err));
    }
  },
);

server.tool(
  "get_project",
  { project_id: z.string().min(1).describe("The project id, e.g. proj_xxxx") },
  async ({ project_id }) => {
    try {
      const { data } = await request("GET", `/api/graph/project/${encodeURIComponent(project_id)}`);
      return text(compact(data));
    } catch (err) {
      return text(String(err.message || err));
    }
  },
);

server.tool(
  "ontology_generate",
  {
    simulation_requirement: z.string().min(1).describe("Required. The simulation requirement / goal text used to derive the ontology"),
    project_name: z.string().optional().describe("Optional project name (defaults to 'Unnamed Project')"),
    additional_context: z.string().optional().describe("Optional extra context for ontology generation"),
    files: z.array(z.string()).optional().describe("Optional local file paths to attach as multipart uploads (PDF/MD/TXT)"),
  },
  async ({ simulation_requirement, project_name, additional_context, files }) => {
    try {
      const form = new FormData();
      form.append("simulation_requirement", simulation_requirement);
      if (project_name) form.append("project_name", project_name);
      if (additional_context) form.append("additional_context", additional_context);
      if (files && files.length) {
        for (const f of files) {
          const abs = path.resolve(f);
          if (!fs.existsSync(abs)) {
            return text(`ERROR: file not found: ${abs}`);
          }
          const buf = fs.readFileSync(abs);
          const blob = new Blob([buf]);
          form.append("files", blob, path.basename(abs));
        }
      }
      const { data } = await request("POST", "/api/graph/ontology/generate", {
        form,
        timeoutMs: LONG_TIMEOUT,
      });
      return text(compact(data));
    } catch (err) {
      return text(String(err.message || err));
    }
  },
);

server.tool(
  "build_graph",
  {
    project_id: z.string().min(1).describe("Required. Project id from ontology_generate"),
    graph_name: z.string().optional().describe("Optional graph name"),
    chunk_size: z.number().int().positive().optional().describe("Chunk size (default 500)"),
    chunk_overlap: z.number().int().min(0).optional().describe("Chunk overlap (default 50)"),
    force: z.boolean().optional().describe("Force rebuild (default false)"),
  },
  async ({ project_id, graph_name, chunk_size, chunk_overlap, force }) => {
    try {
      const { data } = await request("POST", "/api/graph/build", {
        json: { project_id, graph_name, chunk_size, chunk_overlap, force },
      });
      return text(compact(data));
    } catch (err) {
      return text(String(err.message || err));
    }
  },
);

server.tool(
  "task_status",
  { task_id: z.string().min(1).describe("The task id, e.g. task_xxxx") },
  async ({ task_id }) => {
    try {
      const { data } = await request("GET", `/api/graph/task/${encodeURIComponent(task_id)}`);
      return text(compact(data));
    } catch (err) {
      return text(String(err.message || err));
    }
  },
);

server.tool(
  "create_simulation",
  {
    project_id: z.string().min(1).describe("Required. Project id"),
    graph_id: z.string().optional().describe("Optional graph id; falls back to the project's graph"),
    enable_twitter: z.boolean().optional().describe("Enable Twitter platform (default true)"),
    enable_reddit: z.boolean().optional().describe("Enable Reddit platform (default true)"),
  },
  async ({ project_id, graph_id, enable_twitter, enable_reddit }) => {
    try {
      const { data } = await request("POST", "/api/simulation/create", {
        json: { project_id, graph_id, enable_twitter, enable_reddit },
      });
      return text(compact(data));
    } catch (err) {
      return text(String(err.message || err));
    }
  },
);

server.tool(
  "prepare_simulation",
  {
    simulation_id: z.string().min(1).describe("Required. Simulation id"),
    entity_types: z.array(z.string()).optional().describe("Optional entity type filter"),
    use_llm_for_profiles: z.boolean().optional().describe("Use LLM to generate profiles (default true)"),
    parallel_profile_count: z.number().int().positive().optional().describe("Parallel profile count (default 5)"),
    force_regenerate: z.boolean().optional().describe("Force regeneration (default false)"),
  },
  async ({ simulation_id, entity_types, use_llm_for_profiles, parallel_profile_count, force_regenerate }) => {
    try {
      const { data } = await request("POST", "/api/simulation/prepare", {
        json: { simulation_id, entity_types, use_llm_for_profiles, parallel_profile_count, force_regenerate },
      });
      return text(compact(data));
    } catch (err) {
      return text(String(err.message || err));
    }
  },
);

server.tool(
  "prepare_status",
  {
    task_id: z.string().optional().describe("Optional task id from prepare_simulation"),
    simulation_id: z.string().optional().describe("Optional simulation id to check existing prep"),
  },
  async ({ task_id, simulation_id }) => {
    try {
      const { data } = await request("POST", "/api/simulation/prepare/status", {
        json: { task_id, simulation_id },
      });
      return text(compact(data));
    } catch (err) {
      return text(String(err.message || err));
    }
  },
);

server.tool(
  "simulation_start",
  {
    simulation_id: z.string().min(1).describe("Required. Simulation id"),
    platform: z.enum(["twitter", "reddit", "parallel"]).optional().describe("Platform (default parallel)"),
    max_rounds: z.number().int().positive().optional().describe("Max rounds to cap a long simulation"),
    enable_graph_memory_update: z.boolean().optional().describe("Update Zep graph memory (default false)"),
  },
  async ({ simulation_id, platform, max_rounds, enable_graph_memory_update }) => {
    try {
      const { data } = await request("POST", "/api/simulation/start", {
        json: { simulation_id, platform, max_rounds, enable_graph_memory_update },
        timeoutMs: LONG_TIMEOUT,
      });
      return text(compact(data));
    } catch (err) {
      return text(String(err.message || err));
    }
  },
);

server.tool(
  "simulation_status",
  { simulation_id: z.string().min(1).describe("Required. Simulation id") },
  async ({ simulation_id }) => {
    try {
      const { data } = await request(
        "GET",
        `/api/simulation/${encodeURIComponent(simulation_id)}/run-status`,
      );
      return text(compact(data));
    } catch (err) {
      return text(String(err.message || err));
    }
  },
);

server.tool(
  "generate_report",
  { simulation_id: z.string().min(1).describe("Required. Simulation id (must be in a terminal state)"), force_regenerate: z.boolean().optional().describe("Force regeneration (default false)") },
  async ({ simulation_id, force_regenerate }) => {
    try {
      const { data } = await request("POST", "/api/report/generate", {
        json: { simulation_id, force_regenerate },
      });
      return text(compact(data));
    } catch (err) {
      return text(String(err.message || err));
    }
  },
);

server.tool(
  "report_status",
  { task_id: z.string().optional().describe("Optional task id from generate_report"), simulation_id: z.string().optional().describe("Optional simulation id") },
  async ({ task_id, simulation_id }) => {
    try {
      const { data } = await request("POST", "/api/report/generate/status", {
        json: { task_id, simulation_id },
      });
      return text(compact(data));
    } catch (err) {
      return text(String(err.message || err));
    }
  },
);

server.tool(
  "get_report",
  { report_id: z.string().min(1).describe("Required. Report id"), include_body: z.boolean().optional().describe("Include a body preview (default false)") },
  async ({ report_id, include_body }) => {
    try {
      const { data } = await request("GET", `/api/report/${encodeURIComponent(report_id)}`, {
        query: { include_body },
      });
      return text(compact(data));
    } catch (err) {
      return text(String(err.message || err));
    }
  },
);

server.tool(
  "report_chat",
  {
    simulation_id: z.string().min(1).describe("Required. Simulation id"),
    message: z.string().min(1).describe("Required. Question for the report agent"),
    chat_history: z.array(z.object({ role: z.string(), content: z.string() })).optional().describe("Optional prior conversation history"),
  },
  async ({ simulation_id, message, chat_history }) => {
    try {
      const { data } = await request("POST", "/api/report/chat", {
        json: { simulation_id, message, chat_history },
        timeoutMs: LONG_TIMEOUT,
      });
      return text(compact(data));
    } catch (err) {
      return text(String(err.message || err));
    }
  },
);

// ============================================================ SUPPORT

server.tool(
  "simulation_stop",
  { simulation_id: z.string().min(1).describe("Required. Simulation id") },
  async ({ simulation_id }) => {
    try {
      const { data } = await request("POST", "/api/simulation/stop", {
        json: { simulation_id },
      });
      return text(compact(data));
    } catch (err) {
      return text(String(err.message || err));
    }
  },
);

server.tool(
  "list_simulations",
  { limit: z.number().int().min(1).max(500).optional().describe("Max simulations to return") },
  async ({ limit }) => {
    try {
      const { data } = await request("GET", "/api/simulation/list", { query: { limit } });
      return text(compact(data));
    } catch (err) {
      return text(String(err.message || err));
    }
  },
);

server.tool(
  "simulation_timeline",
  { simulation_id: z.string().min(1).describe("Required. Simulation id"), limit: z.number().int().min(1).max(1000).optional().describe("Max rounds to return (default 50)") },
  async ({ simulation_id, limit }) => {
    try {
      const { data } = await request(
        "GET",
        `/api/simulation/${encodeURIComponent(simulation_id)}/timeline`,
        { query: { limit } },
      );
      return text(compact(data));
    } catch (err) {
      return text(String(err.message || err));
    }
  },
);

server.tool(
  "simulation_agent_stats",
  { simulation_id: z.string().min(1).describe("Required. Simulation id") },
  async ({ simulation_id }) => {
    try {
      const { data } = await request(
        "GET",
        `/api/simulation/${encodeURIComponent(simulation_id)}/agent-stats`,
      );
      return text(compact(data));
    } catch (err) {
      return text(String(err.message || err));
    }
  },
);

server.tool(
  "report_check",
  { simulation_id: z.string().min(1).describe("Required. Simulation id") },
  async ({ simulation_id }) => {
    try {
      const { data } = await request("GET", `/api/report/check/${encodeURIComponent(simulation_id)}`);
      return text(compact(data));
    } catch (err) {
      return text(String(err.message || err));
    }
  },
);

const transport = new StdioServerTransport();
server
  .connect(transport)
  .then(() => console.error("opencode-mirofish-mcp ready"))
  .catch((e) => {
    console.error("mirofish-mcp failed to start:", e);
    process.exit(1);
  });
