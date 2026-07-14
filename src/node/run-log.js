/**
 * Structured run logging — one JSONL file per day under logs/, one line per
 * event, one runId per generation run. Shared by the CLI, the MCP server,
 * and the dev server's proxy/eval middleware, so any failure (browser or
 * headless) leaves an examinable record with the exact request parameters,
 * per-request timings/statuses, and error details.
 *
 *   logs/pixegen-2026-07-14.jsonl   ← default location (gitignored)
 *
 * Env: PIXEGEN_LOG_DIR overrides the directory; PIXEGEN_LOG=0 disables
 * file logging entirely (events still flow to any onEvent callback).
 *
 * Line shape: { ts, run, surface, event, ...data } — `event` is a short
 * type ("start", "request", "response", "validation", "error", "end"),
 * everything else is event-specific detail. Keep values JSON-safe.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

let warnedUnwritable = false;

export function logDir() {
    return resolve(process.env.PIXEGEN_LOG_DIR || "./logs");
}

export function logFilePath(date = new Date()) {
    const day = date.toISOString().slice(0, 10);
    return join(logDir(), `pixegen-${day}.jsonl`);
}

function loggingEnabled() {
    return process.env.PIXEGEN_LOG !== "0";
}

export function newRunId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Serialize an Error (or anything thrown) into JSON-safe detail. */
export function errorDetail(err) {
    if (err instanceof Error) {
        return {
            message: err.message,
            name: err.name,
            stack: err.stack?.split("\n").slice(0, 6).join("\n"),
            ...(err.cause ? { cause: String(err.cause) } : {}),
        };
    }
    return { message: String(err) };
}

/**
 * Append one event line. Safe to call unconditionally: logging failures
 * (unwritable dir, read-only fs) never break the run they're describing.
 */
export function logEvent(entry) {
    if (!loggingEnabled()) return;
    try {
        mkdirSync(logDir(), { recursive: true });
        appendFileSync(
            logFilePath(),
            `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`,
        );
    } catch (err) {
        if (!warnedUnwritable) {
            warnedUnwritable = true;
            process.stderr.write(
                `[pixegen] run-log disabled (cannot write ${logDir()}): ${err.message}\n`,
            );
        }
    }
}

/**
 * Start a run: returns a logger bound to a fresh runId.
 *
 * @param {string} surface - "cli" | "mcp" | "dev-proxy" | "eval"
 * @param {object} [meta] - Run-level detail (command, prompt, settings…)
 * @returns {{ id: string, event(type, data?), error(err, data?), end(data?) }}
 */
export function startRun(surface, meta = {}) {
    const id = newRunId();
    const startedAt = Date.now();
    logEvent({ run: id, surface, event: "start", ...meta });
    return {
        id,
        event(type, data = {}) {
            logEvent({ run: id, surface, event: type, ...data });
        },
        error(err, data = {}) {
            logEvent({
                run: id,
                surface,
                event: "error",
                ...data,
                error: errorDetail(err),
            });
        },
        end(data = {}) {
            logEvent({
                run: id,
                surface,
                event: "end",
                durationMs: Date.now() - startedAt,
                ...data,
            });
        },
    };
}

/** A no-op logger with the same shape, for callers that opt out. */
export const NULL_RUN_LOG = {
    id: "",
    event() {},
    error() {},
    end() {},
};
