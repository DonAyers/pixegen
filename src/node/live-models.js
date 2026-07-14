/**
 * Live Pollinations model catalog for the Node surfaces (CLI/MCP) —
 * fetch + disk cache around core/model-registry.js's merge logic.
 *
 * Split into a sync read path and an async refresh path on purpose:
 * generation must never block on (or fail because of) a catalog fetch, so
 * `getPollinationsCatalog()` reads the cache synchronously and falls back
 * to the static list, while `refreshLiveModels()` (run by
 * `pixegen models --live`) does the network call and rewrites the cache.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, dirname } from "node:path";

import { mergeModelCatalog } from "../core/model-registry.js";

export const MODELS_ENDPOINT = "https://gen.pollinations.ai/image/models";

/** Cache freshness window (§7 suggests ~an hour). */
export const CACHE_TTL_MS = 60 * 60 * 1000;

export function modelsCachePath() {
    if (process.env.PIXEGEN_MODELS_CACHE_PATH) {
        return process.env.PIXEGEN_MODELS_CACHE_PATH;
    }
    const cacheHome =
        process.env.XDG_CACHE_HOME ||
        (homedir() ? join(homedir(), ".cache") : tmpdir());
    return join(cacheHome, "pixegen", "pollinations-models.json");
}

/**
 * Read cached live entries. Returns null when the cache is missing or
 * unreadable; expired-but-present entries are still returned (stale beats
 * static — the static list goes stale far faster than an hour).
 * @returns {{ entries: Array, fetchedAt: number, fresh: boolean }|null}
 */
export function readCachedLiveModels() {
    try {
        const parsed = JSON.parse(readFileSync(modelsCachePath(), "utf8"));
        if (!Array.isArray(parsed.entries)) return null;
        return {
            entries: parsed.entries,
            fetchedAt: parsed.fetchedAt || 0,
            fresh: Date.now() - (parsed.fetchedAt || 0) < CACHE_TTL_MS,
        };
    } catch {
        return null;
    }
}

/**
 * Fetch the live model list and rewrite the cache.
 * @returns {Promise<Array>} the live entries
 */
export async function refreshLiveModels({ timeoutMs = 30000 } = {}) {
    const headers = {};
    if (process.env.POLLINATIONS_API_KEY) {
        headers.Authorization = `Bearer ${process.env.POLLINATIONS_API_KEY}`;
    }
    const response = await fetch(MODELS_ENDPOINT, {
        headers,
        signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
        throw new Error(
            `GET /image/models failed: ${response.status} ${response.statusText}`,
        );
    }
    const entries = await response.json();
    if (!Array.isArray(entries)) {
        throw new Error("GET /image/models returned a non-array response");
    }

    const path = modelsCachePath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
        path,
        JSON.stringify({ fetchedAt: Date.now(), entries }, null, 2),
    );
    return entries;
}

/**
 * The merged Pollinations catalog: cached live data when available
 * (stale included), static fallback otherwise. Sync and network-free.
 * @returns {{ models: Array, source: "live"|"static", fetchedAt: number|null }}
 */
export function getPollinationsCatalog() {
    const cached = readCachedLiveModels();
    const merged = mergeModelCatalog(cached ? cached.entries : null);
    return { ...merged, fetchedAt: cached ? cached.fetchedAt : null };
}
