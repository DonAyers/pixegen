/**
 * Findings persistence (Node) — reads/writes the eval knowledge base at
 * eval/findings.json in the repo, so verdicts survive across sessions and
 * are versioned with the code. Override the path with PIXEGEN_FINDINGS_PATH
 * (tests use this to avoid touching the repo's real history).
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { emptyFindings } from "../core/eval-findings.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export function findingsPath() {
    return (
        process.env.PIXEGEN_FINDINGS_PATH ||
        resolve(REPO_ROOT, "eval/findings.json")
    );
}

/** Load the knowledge base (empty structure if the file doesn't exist yet). */
export function loadFindings() {
    try {
        const parsed = JSON.parse(readFileSync(findingsPath(), "utf8"));
        return { ...emptyFindings(), ...parsed };
    } catch (err) {
        if (err.code === "ENOENT") return emptyFindings();
        throw new Error(
            `Could not parse ${findingsPath()}: ${err.message} — fix or delete it.`,
        );
    }
}

/** Persist the knowledge base (pretty-printed for reviewable diffs). */
export function saveFindings(findings) {
    const path = findingsPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(findings, null, 2) + "\n");
    return path;
}
