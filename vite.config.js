import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { loadFindings, saveFindings } from "./src/node/eval-store.js";
import { recordJudgedTrial } from "./src/core/eval-findings.js";
import { logEvent, errorDetail, newRunId, logFilePath } from "./src/node/run-log.js";
import * as openaiAdapter from "./src/node/providers/openai.js";

/**
 * Dev-only OpenAI BYOK lane: POST /api/openai/generate with a JSON body,
 * answered with PNG bytes. The dev server holds OPENAI_API_KEY and calls
 * the OpenAI Images API via the same Node adapter the CLI/MCP use — the
 * key never reaches the client (the PROVIDERS.md guardrail). Requests are
 * billed to the user's OpenAI account.
 */
const openaiEndpointPlugin = {
    name: "pixegen-openai-endpoint",
    configureServer(server) {
        server.middlewares.use("/api/openai/generate", (req, res) => {
            if (req.method !== "POST") {
                res.statusCode = 405;
                res.end();
                return;
            }
            let body = "";
            req.on("data", (chunk) => (body += chunk));
            req.on("end", async () => {
                const run = { id: newRunId(), startedAt: Date.now() };
                try {
                    const args = JSON.parse(body);
                    logEvent({
                        run: run.id,
                        surface: "dev-openai",
                        event: "request",
                        model: args.model,
                        width: args.width,
                        height: args.height,
                        prompt: String(args.prompt || "").slice(0, 300),
                    });
                    const { buffer } = await openaiAdapter.generateImage({
                        prompt: args.prompt,
                        modelId: args.model,
                        width: args.width,
                        height: args.height,
                        transparent: args.transparent,
                        negativePrompt: args.negativePrompt || "",
                        quality: args.quality,
                    });
                    logEvent({
                        run: run.id,
                        surface: "dev-openai",
                        event: "response",
                        status: 200,
                        durationMs: Date.now() - run.startedAt,
                        bytes: buffer.length,
                    });
                    res.setHeader("content-type", "image/png");
                    res.end(buffer);
                } catch (err) {
                    logEvent({
                        run: run.id,
                        surface: "dev-openai",
                        event: "error",
                        durationMs: Date.now() - run.startedAt,
                        error: errorDetail(err),
                    });
                    res.statusCode = /OPENAI_API_KEY/.test(err.message) ? 503 : 502;
                    res.setHeader("content-type", "application/json");
                    res.end(
                        JSON.stringify({
                            success: false,
                            error: {
                                code: "openai_error",
                                message: err.message,
                                debugLog: logFilePath(),
                                run: run.id,
                            },
                        }),
                    );
                }
            });
        });
    },
};

/**
 * Proxy config for one Pollinations route prefix, with the three things the
 * bare proxy lacked (each learned from a real failure):
 *   - an error handler — without one, upstream/socket failures close the
 *     connection with no response and the browser reports the useless
 *     ERR_EMPTY_RESPONSE / "Failed to fetch";
 *   - 10-minute timeouts — live generations regularly exceed the old 120s;
 *   - structured JSONL logging (logs/pixegen-<date>.jsonl, shared format
 *     with the CLI/MCP) of every request: model/size/seed/prompt in,
 *     status/duration out, plus the upstream body on error statuses.
 */
function pollinationsProxy(env, prefix) {
    return {
        target: "https://gen.pollinations.ai",
        changeOrigin: true,
        rewrite: (path) => path.replace(new RegExp(`^${prefix}`), "/image"),
        proxyTimeout: 600000,
        timeout: 600000,
        configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq, req) => {
                // The browser's "use free tier" toggle adds pixegen_free=1:
                // skip the key and strip the marker before forwarding, so
                // the request rides the anonymous tier.
                const freeTier = /[?&]pixegen_free=1/.test(req.url || "");
                if (freeTier) {
                    proxyReq.path = proxyReq.path
                        .replace(/\?pixegen_free=1&/, "?")
                        .replace(/[?&]pixegen_free=1/, "");
                } else {
                    const apiKey = env.POLLINATIONS_API_KEY || "";
                    if (apiKey) {
                        proxyReq.setHeader("Authorization", `Bearer ${apiKey}`);
                    }
                }
                req._pixegenRun = {
                    id: newRunId(),
                    startedAt: Date.now(),
                    freeTier,
                };
                try {
                    const u = new URL(req.url, "http://localhost");
                    logEvent({
                        run: req._pixegenRun.id,
                        surface: "dev-proxy",
                        event: "request",
                        route: prefix,
                        model: u.searchParams.get("model"),
                        width: u.searchParams.get("width"),
                        height: u.searchParams.get("height"),
                        seed: u.searchParams.get("seed"),
                        transparent: u.searchParams.get("transparent"),
                        prompt: decodeURIComponent(
                            u.pathname.split("/").pop() || "",
                        ).slice(0, 300),
                        freeTier,
                        hasKey: Boolean(env.POLLINATIONS_API_KEY),
                    });
                } catch {
                    /* logging must never break the request */
                }
            });
            proxy.on("proxyRes", (proxyRes, req) => {
                const meta = req._pixegenRun || {};
                const entry = {
                    run: meta.id,
                    surface: "dev-proxy",
                    event: "response",
                    status: proxyRes.statusCode,
                    contentType: proxyRes.headers["content-type"],
                    durationMs: Date.now() - (meta.startedAt || Date.now()),
                };
                if (proxyRes.statusCode >= 400) {
                    // Capture the upstream error body for the log; the
                    // response still streams to the browser untouched.
                    let body = "";
                    proxyRes.on("data", (chunk) => {
                        if (body.length < 2048) body += chunk;
                    });
                    proxyRes.on("end", () =>
                        logEvent({ ...entry, upstreamBody: body.slice(0, 2048) }),
                    );
                } else {
                    logEvent(entry);
                }
            });
            proxy.on("error", (err, req, res) => {
                const meta = req._pixegenRun || {};
                logEvent({
                    run: meta.id,
                    surface: "dev-proxy",
                    event: "error",
                    durationMs: Date.now() - (meta.startedAt || Date.now()),
                    error: errorDetail(err),
                });
                // Always answer with a real JSON error — an empty-response
                // hangup is undebuggable from the browser side.
                if (res && typeof res.writeHead === "function" && !res.headersSent) {
                    res.writeHead(502, { "content-type": "application/json" });
                }
                if (res && typeof res.end === "function") {
                    res.end(
                        JSON.stringify({
                            success: false,
                            error: {
                                code: "proxy_error",
                                message: `Dev proxy could not complete the Pollinations request: ${err.message}`,
                                debugLog: logFilePath(),
                                run: meta.id,
                            },
                        }),
                    );
                }
            });
        },
    };
}

/**
 * Dev-only endpoints for the eval knowledge base (eval/findings.json):
 *   GET  /api/eval/findings — current ideals + trial history
 *   POST /api/eval/record   — record a judged UI trial (A/B tab winner
 *                             buttons); winner's settings become the
 *                             target's ideal
 * The browser can't write repo files, so the dev server does it — this is
 * a dev tool; the production build has no recording path.
 */
const evalEndpointPlugin = {
    name: "pixegen-eval-endpoint",
    configureServer(server) {
        server.middlewares.use("/api/eval/findings", (req, res) => {
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify(loadFindings()));
        });
        server.middlewares.use("/api/eval/record", (req, res) => {
            if (req.method !== "POST") {
                res.statusCode = 405;
                res.end();
                return;
            }
            let body = "";
            req.on("data", (chunk) => (body += chunk));
            req.on("end", () => {
                res.setHeader("content-type", "application/json");
                try {
                    const { winner, notes, ...spec } = JSON.parse(body);
                    const findings = loadFindings();
                    const { trial, ideal } = recordJudgedTrial(
                        findings,
                        { ...spec, source: "ui" },
                        winner,
                        notes || "",
                    );
                    saveFindings(findings);
                    res.end(JSON.stringify({ ok: true, trial, ideal }));
                } catch (err) {
                    res.statusCode = 400;
                    res.end(JSON.stringify({ ok: false, error: err.message }));
                }
            });
        });
    },
};

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), "");

    // Pollinations is the zero-config default; the OpenAI BYOK lane appears
    // in the browser picker only when OPENAI_API_KEY is configured (the
    // dev server calls OpenAI server-side via openaiEndpointPlugin — keys
    // never reach the client; see docs/PROVIDERS.md §2's revision note).
    const openaiKey = env.OPENAI_API_KEY || process.env.OPENAI_API_KEY || "";
    // The Node adapter reads process.env — surface a .env-file-only key.
    if (openaiKey && !process.env.OPENAI_API_KEY) {
        process.env.OPENAI_API_KEY = openaiKey;
    }
    const availableProviders = [
        "pollinations",
        ...(openaiKey ? ["openai"] : []),
    ];

    const proxyConfig = {
        // Pollinations proxy (sole browser provider, always available)
        "/api/pollinations": pollinationsProxy(env, "/api/pollinations"),
        // Backward compatibility: /api/generate → pollinations
        "/api/generate": pollinationsProxy(env, "/api/generate"),
    };

    return {
        plugins: [react(), evalEndpointPlugin, openaiEndpointPlugin],
        server: {
            port: 5173,
            strictPort: false,
            proxy: proxyConfig,
        },
        define: {
            // Inject available providers into client code
            __AVAILABLE_PROVIDERS__: JSON.stringify(availableProviders),
        },
    };
});
