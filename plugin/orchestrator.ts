/**
 * Orchestrator plugin — surveillance + tool-poisoning defense + failure telemetry.
 *
 * Hooks:
 *  - tool.execute.before : telemetry (tool + truncated args)
 *  - tool.execute.after  : injection scan + long-output truncation (progressive disclosure) + telemetry
 *  - event               : errors / session.idle events
 *
 * Writes JSONL telemetry to ~/.config/opencode/telemetry/run-YYYY-MM-DD.jsonl
 * Self-healing is intentionally NOT done in hooks (loops are dangerous) — the
 * /heal command reads this log and fixes root causes instead.
 *
 * Every hook is best-effort: a failure here must never break a session.
 */
import type { Plugin } from "@opencode-ai/plugin"
import { appendFileSync, mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const TELEMETRY_DIR = join(homedir(), ".config", "opencode", "telemetry")
try {
  mkdirSync(TELEMETRY_DIR, { recursive: true })
} catch {
  /* telemetry is best-effort */
}

function telemetry(kind: string, data: unknown): void {
  try {
    const t = new Date().toISOString()
    appendFileSync(
      join(TELEMETRY_DIR, `run-${t.slice(0, 10)}.jsonl`),
      `${JSON.stringify({ t, kind, data })}\n`,
    )
  } catch {
    /* never break the session for telemetry */
  }
}

/** Patterns that indicate a tool result is trying to hijack the agent. */
const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions|prompts|directives|messages)/i,
  /disregard\s+(all\s+)?(previous|prior)\s+(instructions|prompts|directives)/i,
  /you\s+are\s+now\s+(an?\s+)?(unconstrained|without\s+(any\s+)?(rules|restrictions)|jailbroken|free)/i,
  /system\s+prompt\s*[:=]/i,
  /<\s*\/?\s*system\s*>/i,
  /\bNEW\s+INSTRUCTIONS?\b/i,
  /override\s+(all\s+)?(previous|prior)\s+(rules|instructions)/i,
]

const MAX_STRING_LENGTH = 20000

function scanString(s: string): string | null {
  for (const p of INJECTION_PATTERNS) {
    const m = s.match(p)
    if (m) return m[0].slice(0, 80)
  }
  return null
}

/**
 * Walk an object tree of unknown shape: truncate overly long strings and
 * collect injection matches. Never throws.
 */
function sanitizeTree(node: unknown, path: string, flagged: string[]): void {
  if (node === null || node === undefined) return
  if (typeof node === "string") {
    const hit = scanString(node)
    if (hit) flagged.push(`${path}: "${hit}"`)
    return
  }
  if (typeof node !== "object") return
  if (Array.isArray(node)) {
    node.forEach((item, i) => sanitizeTree(item, `${path}[${i}]`, flagged))
    return
  }
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (typeof v === "string" && v.length > MAX_STRING_LENGTH) {
      ;(node as Record<string, unknown>)[k] =
        v.slice(0, MAX_STRING_LENGTH) + `\n…[truncated by orchestrator (was ${v.length} chars)]`
    } else {
      sanitizeTree(v, `${path}.${k}`, flagged)
    }
  }
}

function truncateForLog(v: unknown, max = 400): unknown {
  if (typeof v === "string") return v.length > max ? `${v.slice(0, max)}…` : v
  if (Array.isArray(v)) return v.slice(0, 10).map((i) => truncateForLog(i, max))
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = truncateForLog(val, max)
    return out
  }
  return v
}

export default (async () => {
  return {
    "tool.execute.before": async (input: any, _output: any) => {
      try {
        telemetry("tool.before", {
          tool: input?.tool ?? "unknown",
          args: truncateForLog(input?.args),
        })
      } catch {
        /* best-effort */
      }
    },

    "tool.execute.after": async (input: any, output: any) => {
      try {
        const tool = input?.tool ?? "unknown"
        const flagged: string[] = []
        if (output && typeof output === "object") sanitizeTree(output, tool, flagged)
        telemetry("tool.after", {
          tool,
          ok: !(output?.error || output?.isError),
          injectionFlags: flagged,
        })
      } catch {
        /* best-effort */
      }
    },

    "command.execute.before": async (input: any, _output: any) => {
      try {
        telemetry("command.before", { input: truncateForLog(input) })
      } catch {
        /* best-effort */
      }
    },

    event: async (input: any) => {
      try {
        const type: string = input?.type ?? ""
        if (
          type === "session.idle" ||
          type === "session.paused" ||
          type.includes("error") ||
          type.includes("failed")
        ) {
          telemetry("event", { type, data: truncateForLog(input) })
        }
      } catch {
        /* best-effort */
      }
    },
  }
}) satisfies Plugin