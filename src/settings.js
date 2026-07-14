/**
 * Global app settings (browser) — tiny module store, persisted to
 * localStorage, subscribable via useSyncExternalStore. Edited in the
 * sidebar's Settings view.
 *
 * - `freeTier` — when true, generation requests ask the dev proxy NOT to
 *   attach the server-side POLLINATIONS_API_KEY, so they ride the
 *   anonymous free tier (slower/queued, costs no pollen); a 401/402/429
 *   is retried once with the key. Off (default) = keyed, paid priority.
 * - `parallelBatches` — multi-request sheets/tile grids fire their batch
 *   requests concurrently instead of one after another. Big wall-clock
 *   win, especially when the provider queue is congested.
 * - `failoverEnabled` + `failoverSeconds` — abort a Pollinations request
 *   that exceeds the threshold and retry it on the next fast free model
 *   (latency beats model choice when the queue is jammed). Off by default
 *   because it can silently substitute the model you picked — the run
 *   tracker records when it happens.
 */

const STORAGE_KEY = "pixegen_settings_v1";

const DEFAULTS = {
    freeTier: false,
    parallelBatches: true,
    failoverEnabled: false,
    failoverSeconds: 90,
};

function load() {
    try {
        return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") };
    } catch {
        return { ...DEFAULTS };
    }
}

let settings = load();
const listeners = new Set();

function persist() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
        /* private mode etc. — setting just won't stick */
    }
}

export function getSettings() {
    return settings;
}

export function setSetting(key, value) {
    settings = { ...settings, [key]: value };
    persist();
    listeners.forEach((fn) => fn());
}

export function subscribeSettings(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

/** Whether generation requests should try the free tier first. */
export function useFreeTier() {
    return settings.freeTier;
}
