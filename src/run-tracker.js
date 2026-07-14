/**
 * Generation run tracker (browser) — the client-side counterpart of the
 * Node surfaces' JSONL run logs (src/node/run-log.js). Every generation
 * request in any tab registers a run with a sequential id and advances
 * through granular statuses; the always-visible sidebar renders the list
 * live. Runs are persisted to localStorage so history survives reloads
 * (in-flight runs from a previous page load are marked interrupted).
 *
 * Module store + useSyncExternalStore, no context needed — generation code
 * anywhere (App, CompareLab, TilesetStudio, image-service stage callbacks)
 * can call startRun()/update() without prop drilling.
 */

const STORAGE_KEY = "pixegen_runs_v1";
const MAX_RUNS = 100;

/**
 * Status vocabulary, in rough lifecycle order. `active` statuses render a
 * spinner; terminal ones don't change again.
 */
export const RUN_STATUSES = {
    initiated: { label: "initiated", color: "gray", active: true },
    generating: { label: "generating", color: "blue", active: true },
    decoding: { label: "decoding", color: "cyan", active: true },
    processing: { label: "processing", color: "purple", active: true },
    saving: { label: "saving", color: "orange", active: true },
    completed: { label: "complete", color: "green", active: false },
    error: { label: "error", color: "red", active: false },
    interrupted: { label: "interrupted", color: "yellow", active: false },
};

function load() {
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
        if (!saved || !Array.isArray(saved.runs)) {
            return { runs: [], counter: 0 };
        }
        // Anything still "active" from a previous page load can never
        // finish — its promise died with that page.
        const runs = saved.runs.map((run) =>
            RUN_STATUSES[run.status]?.active
                ? { ...run, status: "interrupted", endedAt: run.startedAt }
                : run,
        );
        return { runs, counter: saved.counter || 0 };
    } catch {
        return { runs: [], counter: 0 };
    }
}

let state = load();
const listeners = new Set();

function persist() {
    try {
        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({ runs: state.runs.slice(0, MAX_RUNS), counter: state.counter }),
        );
    } catch {
        /* quota/private mode — tracking still works in-memory */
    }
}

function emit() {
    persist();
    listeners.forEach((fn) => fn());
}

export function subscribeRuns(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

export function getRunsSnapshot() {
    return state.runs;
}

function patchRun(id, patch) {
    state = {
        ...state,
        runs: state.runs.map((run) => (run.id === id ? { ...run, ...patch } : run)),
    };
    emit();
}

/**
 * Register a new generation run.
 *
 * @param {object} meta
 * @param {string} meta.prompt - The user's raw prompt
 * @param {string} meta.model - "provider:model"
 * @param {string} meta.type - "single" | "sheet" | "tileset" | "compare-a" | "compare-b"
 * @param {string} [meta.tab] - Which tab started it (for display)
 * @param {object} [meta.settings] - Palette/size/pipeline snapshot for the summary
 * @returns {{ id, update(status, detail?), complete(detail?), fail(error, detail?) }}
 */
export function startRun(meta) {
    const id = ++state.counter;
    const now = Date.now();
    const run = {
        id,
        status: "initiated",
        events: [{ status: "initiated", ts: now }],
        startedAt: now,
        endedAt: null,
        error: null,
        url: "",
        ...meta,
    };
    state = { ...state, runs: [run, ...state.runs].slice(0, MAX_RUNS) };
    emit();

    const handle = {
        id,
        /** Advance the status; `detail` is a short human string ("frames 1-4/8"). */
        update(status, detail) {
            const current = state.runs.find((r) => r.id === id);
            if (!current || !RUN_STATUSES[current.status]?.active) return;
            patchRun(id, {
                status,
                statusDetail: detail || "",
                events: [...current.events, { status, ts: Date.now(), detail }],
            });
        },
        /** Attach the provider request URL once known (for the summary view). */
        setUrl(url) {
            patchRun(id, { url });
        },
        complete(detail) {
            const current = state.runs.find((r) => r.id === id);
            if (!current || !RUN_STATUSES[current.status]?.active) return;
            patchRun(id, {
                status: "completed",
                statusDetail: detail || "",
                endedAt: Date.now(),
                events: [...current.events, { status: "completed", ts: Date.now(), detail }],
            });
        },
        fail(error, detail) {
            const current = state.runs.find((r) => r.id === id);
            if (!current || !RUN_STATUSES[current.status]?.active) return;
            patchRun(id, {
                status: "error",
                statusDetail: detail || "",
                endedAt: Date.now(),
                error: {
                    message: error?.message || String(error),
                    ...(error?.detail ? { detail: error.detail } : {}),
                },
                events: [...current.events, { status: "error", ts: Date.now(), detail }],
            });
        },
    };
    return handle;
}

export function clearRuns() {
    // Keep active runs — clearing history shouldn't orphan live tracking.
    state = {
        ...state,
        runs: state.runs.filter((run) => RUN_STATUSES[run.status]?.active),
    };
    emit();
}
