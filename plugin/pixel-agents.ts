/**
 * Pixel Agents bridge plugin — makes opencode sessions appear as characters
 * in a locally-running Pixel Agents server (pixel-art office dashboard).
 *
 * Speaks the Claude Code hook JSON dialect that Pixel Agents consumes:
 * POSTs fire-and-forget payloads to http://127.0.0.1:<port>/api/hooks/claude
 * for every live server listed in ~/.pixel-agents/servers/*.json (fallback:
 * ~/.pixel-agents/server.json). The "claude" path segment is the provider id
 * the server resolves — correct even though these events come from opencode.
 *
 * Events emitted:
 *  - SessionStart      lazily on first activity of a session (spawns character),
 *                      plus one per `task` spawn under a SYNTHETIC session id
 *  - PreToolUse        tool.execute.before (mapped tool_name drives animation),
 *                      plus a confirmation ping right after each synthetic
 *                      SessionStart so the subagent character appears instantly
 *  - PostToolUse       tool.execute.after
 *  - Stop              session idle bus event; also forwarded for synthetic
 *                      subagents that go idle while their bracket is open
 *  - PermissionRequest permission asked bus event
 *  - SessionEnd        session deleted / error bus event; also emitted under a
 *                      spawn's synthetic id (reason "exit") when its task ends
 *
 * Subagents: every `task` spawn mints a synthetic session id
 * `<parent>::<type>::<callID-or-t<timestamp><n>>` and drives a DEDICATED pixel
 * person through the ordinary lifecycle above (characters are keyed purely by
 * session_id server-side). SubagentStart/SubagentStop are deliberately NOT
 * sent: the standalone server dispatches those cases through `provider.team`,
 * which is undefined outside team mode, so the payloads are silently dropped —
 * and even in team mode a separate teammate requires a Claude Code
 * "Agent" + run_in_background spawn shape opencode bridging cannot produce.
 * Child sessions seen within SPAWN_WINDOW_MS bind — during TOOL ACTIVITY ONLY,
 * never on lifecycle bus events — to the newest OPEN spawn's synthetic id,
 * verified against opencode parent-lineage hints when exposed (recency is the
 * fallback), so their activity animates that character; child Stop/SessionEnd
 * stay swallowed so the lead owns lifecycle, except idle Stops echoed to the
 * synthetic agent itself.
 *
 * Delivery never throws: 2s timeout per POST, every failure swallowed, and the
 * discovery cache is invalidated on ECONNREFUSED so a restarted server is
 * picked up on the next event.
 *
 * Debug: set PIXEL_AGENTS_BRIDGE_DEBUG=1 to append lines to
 * ~/.config/opencode/telemetry/pixel-bridge.log
 */
import type { Plugin } from "@opencode-ai/plugin"
import { appendFileSync, mkdirSync, readdirSync, readFileSync } from "node:fs"
import { request as httpRequest } from "node:http"
import { homedir } from "node:os"
import { join } from "node:path"

const TELEMETRY_DIR = join(homedir(), ".config", "opencode", "telemetry")
const DEBUG = !!process.env.PIXEL_AGENTS_BRIDGE_DEBUG
try {
  mkdirSync(TELEMETRY_DIR, { recursive: true })
} catch {
  /* telemetry dir creation is best-effort */
}

function debug(line: string): void {
  if (!DEBUG) return
  try {
    appendFileSync(join(TELEMETRY_DIR, "pixel-bridge.log"), `${new Date().toISOString()} ${line}\n`)
  } catch {
    /* never break the session for debug logs */
  }
}

// ---------------------------------------------------------------------------
// Pixel Agents server discovery (~/.pixel-agents/servers/*.json)
// ---------------------------------------------------------------------------

type ServerEntry = { port: number; pid: number; token: string }

const SERVERS_DIR = join(homedir(), ".pixel-agents", "servers")
const LEGACY_SERVER_FILE = join(homedir(), ".pixel-agents", "server.json")

let cachedServers: ServerEntry[] | null = null

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function readServerEntry(file: string): ServerEntry | null {
  try {
    const raw = JSON.parse(readFileSync(file, "utf8"))
    if (
      raw &&
      typeof raw.port === "number" &&
      typeof raw.pid === "number" &&
      typeof raw.token === "string" &&
      pidAlive(raw.pid)
    ) {
      return { port: raw.port, pid: raw.pid, token: raw.token }
    }
  } catch {
    /* unreadable / malformed entry */
  }
  return null
}

function discoverServers(): ServerEntry[] {
  const found: ServerEntry[] = []
  try {
    for (const name of readdirSync(SERVERS_DIR)) {
      if (!name.endsWith(".json")) continue
      const entry = readServerEntry(join(SERVERS_DIR, name))
      if (entry) found.push(entry)
    }
  } catch {
    /* registry dir missing/unreadable — try legacy fallback below */
  }
  if (found.length === 0) {
    const legacy = readServerEntry(LEGACY_SERVER_FILE)
    if (legacy) found.push(legacy)
  }
  return found
}

/**
 * Cached lookup. Empty scans are deliberately NOT cached so a Pixel Agents
 * server started after this session begins is discovered on the next event.
 */
function servers(): ServerEntry[] {
  try {
    if (cachedServers) return cachedServers
    const found = discoverServers()
    if (found.length > 0) {
      cachedServers = found
      debug(`discovered ${found.length} pixel-agents server(s)`)
    }
    return found
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Fire-and-forget delivery (Claude Code hook dialect)
// ---------------------------------------------------------------------------

const HOOK_PATH = "/api/hooks/claude"
const TIMEOUT_MS = 2000

function postHook(entry: ServerEntry, payload: Record<string, unknown>): void {
  try {
    const body = Buffer.from(JSON.stringify(payload), "utf8")
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port: entry.port,
        path: HOOK_PATH,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${entry.token}`,
          "Content-Length": body.length,
        },
        timeout: TIMEOUT_MS,
      },
      (res) => {
        res.on("error", () => {})
        res.resume() // drain the response so the socket is freed
      },
    )
    req.on("timeout", () => req.destroy())
    req.on("error", (err: NodeJS.ErrnoException) => {
      if (err?.code === "ECONNREFUSED") cachedServers = null // server restarted → re-scan
      debug(`POST :${entry.port}${HOOK_PATH} failed: ${err?.message ?? err}`)
    })
    req.end(body)
  } catch {
    /* delivery must never throw into the session */
  }
}

function broadcast(payload: Record<string, unknown>, label: string): void {
  try {
    const list = servers()
    if (list.length === 0) return
    debug(`${label} -> ports ${list.map((s) => s.port).join(", ")}`)
    for (const entry of list) postHook(entry, payload)
  } catch {
    /* best-effort */
  }
}

// ---------------------------------------------------------------------------
// Session tracking + payload emitters
// ---------------------------------------------------------------------------

const MAX_TRACKED_SESSIONS = 500
const startedSessions = new Set<string>()
let bridgeCwd = process.cwd()

function trackSession(sessionID: string): void {
  try {
    while (startedSessions.size >= MAX_TRACKED_SESSIONS) {
      const oldest = startedSessions.values().next().value
      if (oldest === undefined) break
      startedSessions.delete(oldest) // insertion order ⇒ drops the oldest
    }
    startedSessions.add(sessionID)
  } catch {
    /* best-effort */
  }
}

function looksLikeID(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 200
}

/** Lazy SessionStart — the server parks unknown sessions until activity. */
function ensureSessionStarted(sessionID: string): void {
  if (startedSessions.has(sessionID)) return
  trackSession(sessionID)
  broadcast(
    { hook_event_name: "SessionStart", session_id: sessionID, cwd: bridgeCwd, source: "startup" },
    `SessionStart ${sessionID}`,
  )
}

function endSession(sessionID: string): void {
  try {
    // Repeat/unknown ids (duplicate deleted+error events, etc.) have nothing
    // live to end — skip the rebroadcast instead of re-confirming the session.
    if (!startedSessions.delete(sessionID)) return
  } catch {
    /* best-effort */
  }
  broadcast({ hook_event_name: "SessionEnd", session_id: sessionID, reason: "exit" }, `SessionEnd ${sessionID}`)
}

// ---------------------------------------------------------------------------
// Task-spawn tracking (one dedicated pixel person per `task` spawn)
// ---------------------------------------------------------------------------

const SPAWN_WINDOW_MS = 60_000
const TRACK_TTL_MS = 30 * 60_000
const MAX_TRACKED_ENTRIES = 500

type SpawnInfo = { type: string; ts: number; syntheticId: string; spawnerId: string }

let syntheticSpawnCounter = 0 // disambiguates same-millisecond spawns without a callID

/** Prefixed callID map keys — hostile callIDs can't collide with synthetic ids. */
function cidKey(callID: string): string {
  return `cid:${callID}`
}

/** callID (or the synthetic id itself when no callID arrived) -> open spawn. */
const taskSpawnsByCallID = new Map<string, SpawnInfo & { parentSessionId: string }>()
/** parentSessionId -> latest spawn from that parent (correlation anchor). */
const lastSpawnByParent = new Map<string, SpawnInfo>()
/** childSessionId -> session (usually a synthetic subagent id) it was correlated to. */
const childBindings = new Map<string, { parentId: string; ts: number }>()

/** Strip everything that could break JSON payloads or filesystem paths. */
function sanitizeToken(value: string): string {
  return value.replace(/[^A-Za-z0-9._~-]/g, "-")
}

/**
 * One stable synthetic session id per spawn ⇒ one character server-side.
 * Format: `<parent>::<type>::<callID | t<timestamp36><counter36>>` — JSON- and
 * path-safe, ≤200 chars, and stable for the lifetime of the bracket so every
 * event for this subagent can address the same character.
 */
function makeSyntheticId(parentSessionId: string, type: string, callID: unknown): string {
  const suffix = looksLikeID(callID)
    ? sanitizeToken(callID.slice(-48))
    : `t${Date.now().toString(36)}${(++syntheticSpawnCounter).toString(36)}`
  const raw = `${parentSessionId}::${sanitizeToken(type)}::${suffix}`
  return raw.slice(-200) // cap length keeping the TAIL — unique suffix survives
}

/** Synthetic ids carry "::" separators; sanitizeToken forbids ":" inside tokens. */
function isSyntheticId(value: unknown): boolean {
  return typeof value === "string" && value.includes("::")
}

/** Open spawn owning this synthetic id, if any (bracket still unclosed). */
function findOpenSpawn(syntheticId: string): SpawnInfo & { parentSessionId: string } | null {
  try {
    for (const spawn of taskSpawnsByCallID.values()) {
      if (spawn.syntheticId === syntheticId) return spawn
    }
  } catch {
    /* best-effort */
  }
  return null
}

function capMapSize<V>(map: Map<string, V>): void {
  try {
    while (map.size > MAX_TRACKED_ENTRIES) {
      const oldest = map.keys().next().value
      if (oldest === undefined) break
      map.delete(oldest) // insertion order ⇒ drops the oldest
    }
  } catch {
    /* hygiene is best-effort */
  }
}

/** Drop entries older than TRACK_TTL_MS and enforce caps (startedSessions hygiene). */
function pruneTracking(): void {
  try {
    const now = Date.now()
    for (const [callID, spawn] of taskSpawnsByCallID) {
      if (now - spawn.ts > TRACK_TTL_MS) {
        taskSpawnsByCallID.delete(callID)
        // Expired bracket never closed cleanly ⇒ despawn its pixel person,
        // otherwise the character lingers as a zombie forever.
        endSession(spawn.syntheticId)
      }
    }
    for (const [parent, spawn] of lastSpawnByParent) {
      if (now - spawn.ts > TRACK_TTL_MS) lastSpawnByParent.delete(parent)
    }
    for (const [child, binding] of childBindings) {
      const expired = now - binding.ts > TRACK_TTL_MS
      // A binding aimed at a despawned synthetic person is dead weight.
      const orphaned = isSyntheticId(binding.parentId) && !findOpenSpawn(binding.parentId)
      if (expired || orphaned) childBindings.delete(child)
    }
    capMapSize(taskSpawnsByCallID)
    capMapSize(lastSpawnByParent)
    capMapSize(childBindings)
  } catch {
    /* hygiene is best-effort */
  }
}

/** Most recent `task` spawn within the correlation window, across both indexes. */
function recentSpawn(): { syntheticId: string; spawnerId: string; parentSessionId: string; type: string } | null {
  try {
    const cutoff = Date.now() - SPAWN_WINDOW_MS
    let best: { syntheticId: string; spawnerId: string; parentSessionId: string; type: string; ts: number } | null =
      null
    for (const [parentSessionId, spawn] of lastSpawnByParent) {
      if (spawn.ts >= cutoff && (!best || spawn.ts > best.ts)) {
        best = {
          syntheticId: spawn.syntheticId,
          spawnerId: spawn.spawnerId,
          parentSessionId,
          type: spawn.type,
          ts: spawn.ts,
        }
      }
    }
    for (const spawn of taskSpawnsByCallID.values()) {
      if (spawn.ts >= cutoff && (!best || spawn.ts > best.ts)) {
        best = {
          syntheticId: spawn.syntheticId,
          spawnerId: spawn.spawnerId,
          parentSessionId: spawn.parentSessionId,
          type: spawn.type,
          ts: spawn.ts,
        }
      }
    }
    return best ?
        {
          syntheticId: best.syntheticId,
          spawnerId: best.spawnerId,
          parentSessionId: best.parentSessionId,
          type: best.type,
        }
      : null
  } catch {
    return null
  }
}

/** True when some spawn bracket is open within the correlation window. */
function openSpawnNear(): boolean {
  const spawn = recentSpawn()
  return !!(spawn && findOpenSpawn(spawn.syntheticId))
}

/**
 * Map an incoming opencode session to the pixel-agents session its activity
 * should be emitted under. Already-bound children always resolve toward their
 * spawn's SYNTHETIC id; AUTO-BINDING an unknown session happens ONLY when
 * `allowBind` is set — i.e. from the tool-activity handlers, never from
 * lifecycle bus events — so a brand-new unrelated session (fresh chat, etc.)
 * can never be hijacked onto a foreign character. When opencode exposes a
 * parent hint it must match the spawn's spawner/parent; without any hint the
 * recency heuristic stands (tool activity only). Bindings target OPEN spawns
 * exclusively — a bracket that already closed leaves the newcomer unbound.
 */
function resolveSession(sessionID: string, allowBind = false, parentHint?: string | null): string {
  try {
    let current = sessionID
    for (let hops = 0; hops < 8; hops++) {
      const binding = childBindings.get(current)
      if (!binding) break
      current = binding.parentId // nested task agents resolve toward the lead's chain
    }
    if (current !== sessionID) return current
    if (allowBind && !startedSessions.has(sessionID)) {
      const spawn = recentSpawn()
      if (
        spawn &&
        spawn.parentSessionId !== sessionID &&
        findOpenSpawn(spawn.syntheticId) && // never bind to an already-despawned person
        // Lineage check: with a hint exposed it must plausibly own this spawn;
        // spawnerId covers nested tasks (the recorded parent is then synthetic).
        (parentHint == null || parentHint === spawn.spawnerId || parentHint === spawn.parentSessionId)
      ) {
        childBindings.set(sessionID, { parentId: spawn.syntheticId, ts: Date.now() })
        capMapSize(childBindings)
        debug(`child ${sessionID} bound to subagent ${spawn.syntheticId} as type ${spawn.type}`)
        return spawn.syntheticId
      }
    }
  } catch {
    /* fall through to identity */
  }
  return sessionID
}

/**
 * `task` tool starting on a session: register the spawn and raise its OWN
 * pixel person under a synthetic session id (SessionStart parks it pending;
 * the immediate PreToolUse "Task" ping confirms + activates it without
 * waiting for the child's first tool call). `spawnerId` is the RAW session id
 * that executed the tool — kept for lineage checks on nested spawns whose
 * recorded parent is itself synthetic.
 */
function recordTaskSpawn(parentSessionId: string, spawnerId: string, callID: unknown, args: any): void {
  try {
    pruneTracking()
    const rawType = typeof args?.subagent_type === "string" ? args.subagent_type.trim() : ""
    const type = rawType.length > 0 ? rawType : "general"
    const description = typeof args?.description === "string" ? args.description : ""
    const ts = Date.now()
    const syntheticId = makeSyntheticId(parentSessionId, type, callID)
    // No callID ⇒ self-key by the synthetic id so every open spawn stays closable.
    const key = looksLikeID(callID) ? cidKey(callID) : syntheticId
    taskSpawnsByCallID.set(key, { parentSessionId, type, ts, syntheticId, spawnerId })
    lastSpawnByParent.set(parentSessionId, { type, ts, syntheticId, spawnerId })
    capMapSize(taskSpawnsByCallID)
    capMapSize(lastSpawnByParent)
    debug(
      `task spawn detected: type=${type} parent=${parentSessionId} callID=${
        looksLikeID(callID) ? callID : "none"
      } synthetic=${syntheticId}`,
    )
    // The lead character must exist server-side before its subagent joins.
    ensureSessionStarted(parentSessionId)
    ensureSessionStarted(syntheticId) // SessionStart → character appears (pending)
    broadcast(
      {
        hook_event_name: "PreToolUse",
        session_id: syntheticId,
        tool_name: "Task",
        tool_input: { description },
      },
      `PreToolUse spawn-ping ${syntheticId}`,
    )
  } catch {
    /* best-effort */
  }
}

/**
 * `task` tool finished on a session: despawn THAT spawn's pixel person via
 * SessionEnd under its synthetic id and unbind any children routed at it.
 */
function completeTaskSpawn(parentSessionId: string, callID: unknown): void {
  try {
    let closed: SpawnInfo & { parentSessionId: string } | null = null
    if (looksLikeID(callID)) {
      // String-shaped id: close ONLY its own bracket. An unknown id here is a
      // retried/duplicate after-event — early-return below rather than risk
      // despawning an innocent concurrent sibling via degraded matching.
      const key = cidKey(callID)
      closed = taskSpawnsByCallID.get(key) ?? null
      if (closed) taskSpawnsByCallID.delete(key)
    } else {
      // Degenerate shape (absent/garbage callID): prefer closing the bracket
      // this parent's correlation anchor points at (its latest spawn), then
      // fall back to its only open bracket when unambiguous. Concurrent
      // ambiguous brackets stay open until TTL prune despawns them.
      const anchorSpawn = lastSpawnByParent.get(parentSessionId)
      const open: Array<[string, SpawnInfo & { parentSessionId: string }]> = []
      for (const entry of taskSpawnsByCallID) {
        if (entry[1].parentSessionId === parentSessionId) open.push(entry)
      }
      const target =
        (anchorSpawn && open.find(([, spawn]) => spawn.syntheticId === anchorSpawn.syntheticId)) ||
        (open.length === 1 ? open[0] : undefined)
      if (target) {
        closed = target[1]
        taskSpawnsByCallID.delete(target[0])
      }
    }
    if (!closed) return
    debug(
      `task ended: parent=${parentSessionId} callID=${
        looksLikeID(callID) ? callID : "none"
      } synthetic=${closed.syntheticId}`,
    )
    // Drop the correlation anchor when it points at the spawn just closed,
    // so late-arriving children cannot bind to a despawned character.
    const anchor = lastSpawnByParent.get(parentSessionId)
    if (anchor && anchor.syntheticId === closed.syntheticId) lastSpawnByParent.delete(parentSessionId)
    // Unbind children routed at this subagent; their next event re-resolves.
    for (const [child, binding] of childBindings) {
      if (binding.parentId === closed.syntheticId) childBindings.delete(child)
    }
    endSession(closed.syntheticId) // SessionEnd reason:"exit" → despawn
  } catch {
    /* best-effort */
  }
}

// ---------------------------------------------------------------------------
// Tool name mapping (drives the right animation server-side)
// ---------------------------------------------------------------------------

const TOOL_NAME_MAP: Record<string, string> = {
  read: "Read",
  grep: "Grep",
  glob: "Glob",
  bash: "Bash",
  edit: "Edit",
  write: "Write",
  webfetch: "WebFetch",
  task: "Task",
}

function claudeToolName(tool: unknown): string {
  if (typeof tool !== "string" || tool.length === 0) return "unknown"
  return TOOL_NAME_MAP[tool.toLowerCase()] ?? tool
}

function claudeToolInput(tool: unknown, args: unknown): Record<string, unknown> {
  if (args && typeof args === "object" && !Array.isArray(args)) {
    return args as Record<string, unknown>
  }
  // Degraded/absent args: still give Bash a command so status text renders.
  if (claudeToolName(tool) === "Bash") return { command: String(args ?? "") }
  return {}
}

// ---------------------------------------------------------------------------
// Bus-event duck typing (shapes vary across opencode versions)
// ---------------------------------------------------------------------------

/** Pull the first property that plausibly holds a session id. Never assumes. */
function extractSessionID(properties: any): string | null {
  try {
    if (!properties || typeof properties !== "object") return null
    const candidates = [
      properties.sessionID,
      properties.sessionId,
      properties.session_id,
      properties.info?.sessionID,
      properties.info?.sessionId,
      properties.info?.id,
      properties.id,
    ]
    for (const candidate of candidates) {
      if (looksLikeID(candidate)) return candidate
    }
  } catch {
    /* fall through */
  }
  return null
}

/** Best-effort parent-session hint, when opencode exposes lineage at all. */
function extractParentID(source: any): string | null {
  try {
    if (!source || typeof source !== "object") return null
    const candidates = [
      source.parentID,
      source.parentId,
      source.parent_id,
      source.info?.parentID,
      source.info?.parentId,
      source.info?.parent_id,
    ]
    for (const candidate of candidates) {
      if (looksLikeID(candidate)) return candidate
    }
  } catch {
    /* fall through */
  }
  return null
}

export default (async (init?: any) => {
  try {
    bridgeCwd =
      (typeof init?.directory === "string" && init.directory) ||
      (typeof init?.worktree === "string" && init.worktree) ||
      process.cwd()
  } catch {
    /* keep process.cwd() */
  }
  return {
    "tool.execute.before": async (input: any, output: any) => {
      try {
        const rawSessionID = input?.sessionID
        if (!looksLikeID(rawSessionID)) return
        // Resolve BEFORE any emission so a child session never starts its own
        // character; bound children emit under their resolved session (the
        // lead, or the synthetic subagent person they were correlated to).
        // Tool activity is the ONLY path allowed to auto-bind unknown sessions.
        const sessionID = resolveSession(rawSessionID, true, extractParentID(input))
        if (typeof input.tool === "string" && input.tool.toLowerCase() === "task") {
          recordTaskSpawn(sessionID, rawSessionID, input?.callID, output?.args)
        }
        ensureSessionStarted(sessionID)
        const toolName = claudeToolName(input?.tool)
        broadcast(
          {
            hook_event_name: "PreToolUse",
            session_id: sessionID,
            tool_name: toolName,
            tool_input: claudeToolInput(input?.tool, output?.args),
          },
          `PreToolUse ${toolName} ${sessionID}`,
        )
      } catch {
        /* best-effort */
      }
    },

    "tool.execute.after": async (input: any, _output: any) => {
      try {
        const rawSessionID = input?.sessionID
        if (!looksLikeID(rawSessionID)) return
        const sessionID = resolveSession(rawSessionID, true, extractParentID(input))
        if (typeof input.tool === "string" && input.tool.toLowerCase() === "task") {
          completeTaskSpawn(sessionID, input?.callID)
        }
        ensureSessionStarted(sessionID)
        broadcast({ hook_event_name: "PostToolUse", session_id: sessionID }, `PostToolUse ${sessionID}`)
      } catch {
        /* best-effort */
      }
    },

    event: async (input: any) => {
      try {
        // Shape varies across versions: the event itself or wrapped in { event }.
        const evt = input?.event && input.event.type ? input.event : input
        const type: string = evt?.type ?? ""
        if (typeof type !== "string" || type.length === 0) return
        const props = evt?.properties
        const rawSessionID = extractSessionID(props)
        // Lifecycle bus events NEVER auto-bind — only existing chains resolve.
        const sessionID = rawSessionID ? resolveSession(rawSessionID) : null
        const isChild = !!(rawSessionID && sessionID !== rawSessionID)

        if (type.includes("idle")) {
          // Never-started sessions have nothing to sit down; echoing their
          // Stop would confirm-and-spawn a phantom character server-side.
          if (sessionID && startedSessions.has(sessionID)) {
            if (!isChild) {
              broadcast({ hook_event_name: "Stop", session_id: sessionID }, `Stop ${sessionID}`)
            } else if (findOpenSpawn(sessionID)) {
              // …but a live synthetic subagent idling between tool batches
              // sits down itself (bracket close later despawns it).
              broadcast(
                { hook_event_name: "Stop", session_id: sessionID },
                `Stop idle subagent ${sessionID}`,
              )
            }
          }
          return
        }
        if (type.includes("deleted") || type.includes("removed")) {
          if (rawSessionID) {
            if (isChild) childBindings.delete(rawSessionID) // reclaim memory; lead keeps living
            else endSession(rawSessionID)
          }
          return
        }
        if (type.includes("error")) {
          if (rawSessionID) {
            if (isChild) childBindings.delete(rawSessionID)
            else endSession(rawSessionID)
          }
          return
        }
        if (type.toLowerCase().includes("permission")) {
          // Ask-shaped permission events → PermissionRequest; replies are noise.
          if (/ask|request|updated|pending/i.test(type) && !/replied|respond|answer/i.test(type)) {
            if (sessionID) {
              ensureSessionStarted(sessionID)
              broadcast(
                { hook_event_name: "PermissionRequest", session_id: sessionID },
                `PermissionRequest ${sessionID}`,
              )
            }
          }
          return
        }
        if (type.includes("created") && sessionID) {
          // Bound children resolve to their spawn's synthetic id → no
          // SessionStart of their own. Untracked sessions start eagerly only
          // when NO spawn bracket is open nearby; otherwise they may be an
          // inbound subagent child — defer to first TOOL activity so lineage-
          // aware binding can claim them (bus events never self-claim).
          if (!openSpawnNear()) ensureSessionStarted(sessionID)
        }
      } catch {
        /* best-effort */
      }
    },
  }
}) satisfies Plugin
