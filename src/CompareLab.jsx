/**
 * A/B Test Lab
 *
 * Runs the same prompt (and seed) against two independent configurations —
 * model, palette profile, sprite scale, pipeline, dithering, preprocessing —
 * and shows the raw source and processed pixel-art results side by side,
 * with timings. This is the instrument for docs/Next-Phase.md §2/Phase 1:
 * turning "which model/pipeline combination is actually best" from a guess
 * into something you can eyeball in one screen.
 *
 * Both sides share one seed per run (best-effort per model) so differences
 * come from the config, not the sample.
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
    Alert,
    AlertIcon,
    Box,
    Button,
    Checkbox,
    Flex,
    FormControl,
    FormLabel,
    Grid,
    GridItem,
    Heading,
    HStack,
    Image as ChakraImage,
    Input,
    NumberInput,
    NumberInputField,
    Select,
    Text,
    VStack,
} from "@chakra-ui/react";
import {
    generateImage,
    generateSpriteSheet,
    DEFAULT_NEGATIVE_PROMPT,
    lastRequest,
} from "./image-service.js";
import { startRun } from "./run-tracker.js";
import {
    processImage,
    processSpriteSheet,
    renderPixelArt,
    DITHER_OPTIONS,
    PREPROCESSING_PRESETS,
} from "./pixel-processor.js";
import {
    ANIMATION_STATES,
    VIEWS,
    DEFAULT_VIEW,
    getStatesByCategory,
} from "./animation-states.js";
import { AnimationPlayer } from "./animation-player.js";
import { PALETTE_PROFILES, SPRITE_SCALES } from "./palettes.js";
import { modelSupportsTransparent } from "./provider-service.js";
import {
    fetchImageModels,
    initModels,
    DEFAULT_MODELS,
    DEFAULT_MODEL_ID,
} from "./model-service.js";
import { RECIPES } from "./core/recipes.js";
import { randomPromptIdea } from "./core/prompt-ideas.js";

/** Canonical eval-settings shape for a side config (bare model id). */
function configToSettings(config) {
    return {
        model: config.modelId.split(":").pop(),
        spriteSize: config.spriteSize,
        pipeline: config.pipeline,
        dithering: config.dither || null,
        outlines: config.outlines,
        cleanup: config.cleanup,
        preprocessing: config.preprocess,
    };
}

function defaultSideConfig(modelId) {
    return {
        recipeId: "",
        modelId,
        consoleId: "nes",
        spriteSize: "32x32",
        pipeline: "enhanced",
        dither: "",
        preprocess: "standard",
        outlines: true,
        cleanup: true,
    };
}

/** Map a core recipe onto a side config (recipes store bare model ids). */
function configFromRecipe(recipeId, current) {
    const recipe = RECIPES[recipeId];
    if (!recipe) return current;
    return {
        ...current,
        recipeId,
        modelId: `pollinations:${recipe.model}`,
        consoleId: recipe.consoleId,
        spriteSize: recipe.spriteSize,
        pipeline: recipe.pipeline,
        dither: recipe.dithering || "",
        preprocess:
            typeof recipe.preprocessing === "string"
                ? recipe.preprocessing
                : "none",
        outlines: recipe.outlines,
        cleanup: recipe.cleanup,
    };
}

function SidePanel({ label, config, setConfig, models, disabled }) {
    const ditherOptions =
        DITHER_OPTIONS[config.pipeline] || DITHER_OPTIONS.enhanced;

    const set = (patch) =>
        setConfig((prev) => {
            const next = { ...prev, ...patch, recipeId: patch.recipeId ?? "" };
            // Keep the dither value valid for the (possibly new) pipeline.
            const opts = DITHER_OPTIONS[next.pipeline] || DITHER_OPTIONS.enhanced;
            if (!opts.some((o) => o.value === next.dither)) next.dither = "";
            return next;
        });

    return (
        <VStack
            align="stretch"
            spacing={3}
            bg="background.secondary"
            border="1px solid"
            borderColor="gray.700"
            borderRadius="md"
            p={4}
        >
            <Heading size="sm" color="brand.500">
                Config {label}
            </Heading>

            <FormControl>
                <FormLabel fontSize="xs" color="gray.400">
                    Preset (recipe):
                </FormLabel>
                <Select
                    size="sm"
                    value={config.recipeId}
                    isDisabled={disabled}
                    onChange={(e) =>
                        setConfig((prev) =>
                            e.target.value
                                ? configFromRecipe(e.target.value, prev)
                                : { ...prev, recipeId: "" },
                        )
                    }
                    bg="background.tertiary"
                    borderColor="gray.600"
                >
                    <option value="">Custom</option>
                    {Object.entries(RECIPES).map(([id, r]) => (
                        <option key={id} value={id}>
                            {r.label}
                        </option>
                    ))}
                </Select>
            </FormControl>

            <FormControl>
                <FormLabel fontSize="xs" color="gray.400">
                    Model:
                </FormLabel>
                <Select
                    size="sm"
                    value={config.modelId}
                    isDisabled={disabled}
                    onChange={(e) => set({ modelId: e.target.value })}
                    bg="background.tertiary"
                    borderColor="gray.600"
                >
                    {models.map((m) => (
                        <option
                            key={m.fullId || m.id}
                            value={m.fullId || m.id}
                            disabled={m.available === false}
                        >
                            {m.name}
                            {m.paidOnly ? " 🔑" : ""}
                            {m.available === false
                                ? " (key not configured)"
                                : ""}
                        </option>
                    ))}
                </Select>
            </FormControl>

            <HStack spacing={3}>
                <FormControl>
                    <FormLabel fontSize="xs" color="gray.400">
                        Palette:
                    </FormLabel>
                    <Select
                        size="sm"
                        value={config.consoleId}
                        isDisabled={disabled}
                        onChange={(e) => set({ consoleId: e.target.value })}
                        bg="background.tertiary"
                        borderColor="gray.600"
                    >
                        {Object.entries(PALETTE_PROFILES).map(([id, cfg]) => (
                            <option key={id} value={id}>
                                {cfg.name}
                            </option>
                        ))}
                    </Select>
                </FormControl>
                <FormControl>
                    <FormLabel fontSize="xs" color="gray.400">
                        Size:
                    </FormLabel>
                    <Select
                        size="sm"
                        value={config.spriteSize}
                        isDisabled={disabled}
                        onChange={(e) => set({ spriteSize: e.target.value })}
                        bg="background.tertiary"
                        borderColor="gray.600"
                    >
                        {Object.entries(SPRITE_SCALES).map(
                            ([key, { w, h, label: scaleLabel }]) => (
                                <option key={key} value={key}>
                                    {scaleLabel} ({w}×{h})
                                </option>
                            ),
                        )}
                    </Select>
                </FormControl>
            </HStack>

            <HStack spacing={3}>
                <FormControl>
                    <FormLabel fontSize="xs" color="gray.400">
                        Pipeline:
                    </FormLabel>
                    <Select
                        size="sm"
                        value={config.pipeline}
                        isDisabled={disabled}
                        onChange={(e) => set({ pipeline: e.target.value })}
                        bg="background.tertiary"
                        borderColor="gray.600"
                    >
                        <option value="enhanced">Enhanced (OKLAB)</option>
                        <option value="classic">Classic (sRGB)</option>
                    </Select>
                </FormControl>
                <FormControl>
                    <FormLabel fontSize="xs" color="gray.400">
                        Dithering:
                    </FormLabel>
                    <Select
                        size="sm"
                        value={config.dither}
                        isDisabled={disabled}
                        onChange={(e) => set({ dither: e.target.value })}
                        bg="background.tertiary"
                        borderColor="gray.600"
                    >
                        {ditherOptions.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                                {opt.label}
                            </option>
                        ))}
                    </Select>
                </FormControl>
            </HStack>

            <HStack spacing={3} alignItems="flex-end">
                <FormControl>
                    <FormLabel fontSize="xs" color="gray.400">
                        Preprocessing:
                    </FormLabel>
                    <Select
                        size="sm"
                        value={config.preprocess}
                        isDisabled={disabled}
                        onChange={(e) => set({ preprocess: e.target.value })}
                        bg="background.tertiary"
                        borderColor="gray.600"
                    >
                        {Object.entries(PREPROCESSING_PRESETS).map(
                            ([key, preset]) => (
                                <option key={key} value={key}>
                                    {preset.label}
                                </option>
                            ),
                        )}
                    </Select>
                </FormControl>
                <Checkbox
                    size="sm"
                    isChecked={config.outlines}
                    isDisabled={disabled}
                    onChange={(e) => set({ outlines: e.target.checked })}
                >
                    <Text fontSize="xs">Outlines</Text>
                </Checkbox>
                <Checkbox
                    size="sm"
                    isChecked={config.cleanup}
                    isDisabled={disabled}
                    onChange={(e) => set({ cleanup: e.target.checked })}
                >
                    <Text fontSize="xs">Cleanup</Text>
                </Checkbox>
            </HStack>
        </VStack>
    );
}

function ResultPanel({ label, result, transparent, fps }) {
    const canvasRef = useRef(null);
    const playerRef = useRef(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const isAnimation = Boolean(result?.frames && result.frames.length > 1);

    // Static single-sprite render
    useEffect(() => {
        if (result?.pixelData && !isAnimation && canvasRef.current) {
            renderPixelArt(
                canvasRef.current,
                result.pixelData,
                result.spriteW,
                result.spriteH,
                { showGrid: false },
            );
        }
    }, [result, isAnimation]);

    // Animation playback — autoplay as soon as frames land, so both sides
    // move in the same moment you're comparing them.
    useEffect(() => {
        if (!isAnimation || !canvasRef.current) return;

        const player = new AnimationPlayer(canvasRef.current, {
            fps,
            loop: true,
        });
        playerRef.current = player;
        player.setFrames(result.frames);
        player.play();
        setIsPlaying(true);

        return () => {
            player.pause();
            playerRef.current = null;
        };
    }, [result, isAnimation]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (playerRef.current) playerRef.current.fps = fps;
    }, [fps]);

    if (!result) return null;

    if (result.error) {
        return (
            <Alert status="error" variant="left-accent" fontSize="sm">
                <AlertIcon />
                {label}: {result.error}
            </Alert>
        );
    }

    return (
        <VStack
            align="stretch"
            spacing={2}
            bg="background.tertiary"
            border="1px solid"
            borderColor="gray.700"
            borderRadius="md"
            p={3}
        >
            <Flex justify="space-between" align="center">
                <Text fontSize="sm" fontWeight="bold" color="brand.500">
                    Result {label}
                    {isAnimation ? ` · ${result.frames.length} frames` : ""}
                </Text>
                <HStack spacing={2}>
                    {isAnimation && (
                        <Button
                            size="xs"
                            onClick={() => {
                                if (playerRef.current) {
                                    setIsPlaying(playerRef.current.toggle());
                                }
                            }}
                        >
                            {isPlaying ? "⏸" : "▶"}
                        </Button>
                    )}
                    <Text fontSize="xs" color="gray.500">
                        gen {Math.round(result.genMs)}ms · process{" "}
                        {Math.round(result.totalMs - result.genMs)}ms
                    </Text>
                </HStack>
            </Flex>
            <Grid templateColumns="1fr 1fr" gap={2}>
                <GridItem>
                    <Text fontSize="xs" color="gray.500" mb={1}>
                        Source
                    </Text>
                    <ChakraImage
                        src={result.sourceSrc}
                        alt={`Source ${label}`}
                        maxH="220px"
                        mx="auto"
                    />
                </GridItem>
                <GridItem>
                    <Text fontSize="xs" color="gray.500" mb={1}>
                        {isAnimation ? "Animated" : "Processed"} (
                        {result.spriteW}×{result.spriteH})
                    </Text>
                    <Box display="flex" justifyContent="center">
                        <canvas
                            ref={canvasRef}
                            style={{
                                imageRendering: "pixelated",
                                maxWidth: "100%",
                            }}
                        />
                    </Box>
                </GridItem>
            </Grid>
            {transparent && !result.transparentSupported && (
                <Text fontSize="xs" color="orange.300">
                    Transparent background requested but this model doesn't
                    support it — parameter was not sent.
                </Text>
            )}
        </VStack>
    );
}

export function CompareLab({ toast, onRecordPrompt }) {
    const [prompt, setPrompt] = useState("");
    const [seed, setSeed] = useState("");
    const [transparent, setTransparent] = useState(false);
    const [animState, setAnimState] = useState(""); // "" = single sprite
    const [view, setView] = useState(DEFAULT_VIEW);
    const [fps, setFps] = useState(8);
    const [models, setModels] = useState(DEFAULT_MODELS);
    const [configA, setConfigA] = useState(() =>
        defaultSideConfig(DEFAULT_MODEL_ID),
    );
    const [configB, setConfigB] = useState(() =>
        defaultSideConfig("pollinations:gptimage"),
    );
    const [isRunning, setIsRunning] = useState(false);
    const [results, setResults] = useState({ a: null, b: null });
    const [lastRunSeed, setLastRunSeed] = useState(null);
    const [lastRunPrompt, setLastRunPrompt] = useState("");
    const [verdictRecorded, setVerdictRecorded] = useState(false);

    useEffect(() => {
        initModels();
        fetchImageModels().then((fetched) => setModels(fetched));
    }, []);

    const runSide = useCallback(
        async (config, runSeed, side) => {
            const t0 = performance.now();
            const profile = PALETTE_PROFILES[config.consoleId];
            const consoleName =
                profile.quantizeMode === "none" ? "" : profile.name;
            const run = startRun({
                prompt: prompt.trim(),
                model: config.modelId,
                type: side === "b" ? "compare-b" : "compare-a",
                tab: "compare",
                settings: {
                    consoleId: config.consoleId,
                    spriteSize: config.spriteSize,
                    pipeline: config.pipeline,
                },
            });
            const processOptions = {
                consoleId: config.consoleId,
                spriteSize: config.spriteSize,
                dithering: config.dither || null,
                pipeline: config.pipeline,
                outlines: config.outlines,
                cleanup: config.cleanup,
                preprocessing:
                    PREPROCESSING_PRESETS[config.preprocess] ||
                    PREPROCESSING_PRESETS.none,
            };
            const common = {
                genMs: 0,
                transparentSupported: modelSupportsTransparent(config.modelId),
            };

            try {
                // Animation mode: one batched strip request per side, sliced
                // and processed into playable frames.
                const anim = ANIMATION_STATES[animState];
                if (anim) {
                    const sheetResult = await generateSpriteSheet(prompt, {
                        model: config.modelId,
                        frameCount: anim.frameCount,
                        seed: runSeed,
                        transparent,
                        consoleName,
                        viewDesc: VIEWS[view]?.promptDesc || "",
                        animDesc: anim.promptDesc,
                        frameHints: anim.frameHints,
                        onStage: (stage, detail) => run.update(stage, detail),
                    });
                    run.setUrl(lastRequest.url);
                    common.genMs = performance.now() - t0;

                    run.update("processing");
                    const { frames: processed } = await processSpriteSheet(
                        sheetResult,
                        processOptions,
                    );

                    const frames = processed.filter(Boolean).map((f) => {
                        const canvas = document.createElement("canvas");
                        renderPixelArt(canvas, f.pixelData, f.spriteW, f.spriteH, {
                            showGrid: false,
                        });
                        return {
                            canvas,
                            pixelData: f.pixelData,
                            spriteW: f.spriteW,
                            spriteH: f.spriteH,
                        };
                    });

                    run.complete(`${frames.length} frames`);
                    return {
                        ...common,
                        frames,
                        sourceSrc: sheetResult.batches[0]?.img.src,
                        spriteW: frames[0]?.spriteW,
                        spriteH: frames[0]?.spriteH,
                        totalMs: performance.now() - t0,
                    };
                }

                const img = await generateImage(prompt, {
                    model: config.modelId,
                    seed: runSeed,
                    transparent,
                    negativePrompt: DEFAULT_NEGATIVE_PROMPT,
                    consoleName,
                    onStage: (stage, detail) => run.update(stage, detail),
                });
                run.setUrl(lastRequest.url);
                common.genMs = performance.now() - t0;

                run.update("processing");
                const { pixelData, spriteW, spriteH } = await processImage(
                    img,
                    processOptions,
                );

                run.complete(`${spriteW}×${spriteH}`);
                return {
                    ...common,
                    sourceSrc: img.src,
                    pixelData,
                    spriteW,
                    spriteH,
                    totalMs: performance.now() - t0,
                };
            } catch (err) {
                run.fail({ message: err.message, detail: lastRequest.error });
                throw err;
            }
        },
        [prompt, transparent, animState, view],
    );

    const handleRun = async () => {
        if (!prompt.trim()) {
            toast({
                title: "Please enter a prompt to compare",
                status: "error",
                duration: 3000,
            });
            return;
        }

        onRecordPrompt?.(prompt, "user");

        // One seed for both sides so differences come from the config.
        const runSeed = seed
            ? parseInt(seed, 10)
            : Math.floor(Math.random() * 1e6);
        setLastRunSeed(runSeed);
        setLastRunPrompt(prompt.trim());
        setVerdictRecorded(false);
        setIsRunning(true);
        setResults({ a: null, b: null });

        const [a, b] = await Promise.allSettled([
            runSide(configA, runSeed, "a"),
            runSide(configB, runSeed, "b"),
        ]);

        setResults({
            a:
                a.status === "fulfilled"
                    ? a.value
                    : { error: a.reason?.message || String(a.reason) },
            b:
                b.status === "fulfilled"
                    ? b.value
                    : { error: b.reason?.message || String(b.reason) },
        });
        setIsRunning(false);

        toast({
            title: "Comparison complete",
            description: `seed ${runSeed}`,
            status:
                a.status === "fulfilled" && b.status === "fulfilled"
                    ? "success"
                    : "warning",
            duration: 3000,
        });
    };

    // Record a judged trial into the eval knowledge base (eval/findings.json)
    // via the dev-server endpoint. The winner's settings become the ideal
    // for side A's console target.
    const handleVerdict = async (winner) => {
        try {
            const response = await fetch("/api/eval/record", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    target: configA.consoleId,
                    prompt: lastRunPrompt,
                    seed: lastRunSeed,
                    model: configA.modelId.split(":").pop(),
                    a: configToSettings(configA),
                    b: configToSettings(configB),
                    winner,
                    notes:
                        configA.consoleId !== configB.consoleId
                            ? `UI comparison; side B used target ${configB.consoleId}`
                            : "UI comparison",
                }),
            });
            const payload = await response.json();
            if (!response.ok || !payload.ok) {
                throw new Error(payload.error || `HTTP ${response.status}`);
            }
            setVerdictRecorded(true);
            toast({
                title: `Recorded: ${winner === "tie" ? "tie" : `${winner.toUpperCase()} wins`}`,
                description:
                    winner === "tie"
                        ? `Ideal for ${configA.consoleId} unchanged`
                        : `Ideal settings for ${configA.consoleId} updated (${payload.ideal?.trials ?? "?"} decisive trials)`,
                status: "success",
                duration: 4000,
            });
        } catch (err) {
            toast({
                title: "Could not record verdict",
                description: `${err.message} — the eval endpoint only exists on the dev server (npm run dev).`,
                status: "error",
                duration: 5000,
            });
        }
    };

    const bothSucceeded =
        results.a && results.b && !results.a.error && !results.b.error;

    return (
        <VStack align="stretch" spacing={6}>
            <Box>
                <Heading size="md" mb={1} color="brand.500">
                    A/B Test Lab
                </Heading>
                <Text fontSize="sm" color="gray.400">
                    Run one prompt against two model/pipeline configs with a
                    shared seed, side by side. Use this to find out which
                    combinations actually earn a recipe.
                </Text>
            </Box>

            {/* Prompt on its own full-width row — prompts are long. */}
            <FormControl>
                <FormLabel fontSize="sm" color="gray.400">
                    Prompt:
                </FormLabel>
                <HStack>
                    <Input
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        onKeyPress={(e) => e.key === "Enter" && handleRun()}
                        placeholder="e.g. a red dragon breathing fire"
                        bg="background.secondary"
                        borderColor="gray.600"
                    />
                    <Button
                        onClick={() => {
                            const idea = randomPromptIdea(
                                configA.consoleId,
                                "sprite",
                            );
                            setPrompt(idea);
                            onRecordPrompt?.(idea, "random");
                        }}
                        aria-label="Random prompt idea"
                        title="Random idea inspired by classics of side A's system"
                        px={3}
                        flexShrink={0}
                    >
                        🎲
                    </Button>
                </HStack>
            </FormControl>

            <Flex gap={4} flexWrap="wrap" alignItems="flex-end">
                <FormControl maxW="140px">
                    <FormLabel fontSize="xs" color="gray.400">
                        Seed (shared):
                    </FormLabel>
                    <NumberInput
                        value={seed}
                        onChange={(val) => setSeed(val)}
                        min={0}
                        max={999999}
                    >
                        <NumberInputField
                            placeholder="random"
                            bg="background.secondary"
                            borderColor="gray.600"
                        />
                    </NumberInput>
                </FormControl>

                <FormControl maxW="170px">
                    <FormLabel fontSize="xs" color="gray.400">
                        Animation:
                    </FormLabel>
                    <Select
                        size="sm"
                        value={animState}
                        onChange={(e) => setAnimState(e.target.value)}
                        bg="background.secondary"
                        borderColor="gray.600"
                    >
                        <option value="">None (single sprite)</option>
                        {getStatesByCategory().map((group) => (
                            <optgroup key={group.label} label={group.label}>
                                {group.states.map((state) => (
                                    <option key={state.id} value={state.id}>
                                        {state.name} ({state.frameCount}f)
                                    </option>
                                ))}
                            </optgroup>
                        ))}
                    </Select>
                </FormControl>

                {animState && (
                    <>
                        <FormControl maxW="120px">
                            <FormLabel fontSize="xs" color="gray.400">
                                View:
                            </FormLabel>
                            <Select
                                size="sm"
                                value={view}
                                onChange={(e) => setView(e.target.value)}
                                bg="background.secondary"
                                borderColor="gray.600"
                            >
                                {Object.entries(VIEWS).map(([id, v]) => (
                                    <option key={id} value={id}>
                                        {v.name}
                                    </option>
                                ))}
                            </Select>
                        </FormControl>
                        <FormControl maxW="80px">
                            <FormLabel fontSize="xs" color="gray.400">
                                FPS:
                            </FormLabel>
                            <NumberInput
                                value={fps}
                                onChange={(val) => setFps(parseInt(val) || 8)}
                                min={1}
                                max={30}
                                size="sm"
                            >
                                <NumberInputField
                                    bg="background.secondary"
                                    borderColor="gray.600"
                                />
                            </NumberInput>
                        </FormControl>
                    </>
                )}

                <FormControl maxW="130px">
                    <FormLabel fontSize="xs" color="gray.400">
                        Transparent BG:
                    </FormLabel>
                    <Checkbox
                        isChecked={transparent}
                        onChange={(e) => setTransparent(e.target.checked)}
                    />
                </FormControl>

                <Button
                    onClick={handleRun}
                    isLoading={isRunning}
                    loadingText="Comparing..."
                    colorScheme="purple"
                >
                    Run Comparison
                </Button>
            </Flex>

            {lastRunSeed !== null && (
                <Text fontSize="xs" color="gray.500">
                    Last run seed: {lastRunSeed} (enter it above to re-run the
                    same comparison)
                </Text>
            )}

            <Grid templateColumns={{ base: "1fr", md: "1fr 1fr" }} gap={4}>
                <GridItem>
                    <SidePanel
                        label="A"
                        config={configA}
                        setConfig={setConfigA}
                        models={models}
                        disabled={isRunning}
                    />
                </GridItem>
                <GridItem>
                    <SidePanel
                        label="B"
                        config={configB}
                        setConfig={setConfigB}
                        models={models}
                        disabled={isRunning}
                    />
                </GridItem>
                <GridItem>
                    <ResultPanel
                        label="A"
                        result={results.a}
                        transparent={transparent}
                        fps={fps}
                    />
                </GridItem>
                <GridItem>
                    <ResultPanel
                        label="B"
                        result={results.b}
                        transparent={transparent}
                        fps={fps}
                    />
                </GridItem>
            </Grid>

            {bothSucceeded && (
                <Flex
                    gap={3}
                    align="center"
                    justify="center"
                    bg="background.secondary"
                    border="1px solid"
                    borderColor="gray.700"
                    borderRadius="md"
                    p={3}
                    flexWrap="wrap"
                >
                    <Text fontSize="sm" color="gray.400">
                        Which looked better? Recording updates the ideal
                        settings for {configA.consoleId} (eval/findings.json):
                    </Text>
                    <Button
                        size="sm"
                        colorScheme="green"
                        variant="outline"
                        isDisabled={verdictRecorded}
                        onClick={() => handleVerdict("a")}
                    >
                        👑 A wins
                    </Button>
                    <Button
                        size="sm"
                        colorScheme="green"
                        variant="outline"
                        isDisabled={verdictRecorded}
                        onClick={() => handleVerdict("b")}
                    >
                        👑 B wins
                    </Button>
                    <Button
                        size="sm"
                        variant="outline"
                        isDisabled={verdictRecorded}
                        onClick={() => handleVerdict("tie")}
                    >
                        Tie
                    </Button>
                    {verdictRecorded && (
                        <Text fontSize="xs" color="green.300">
                            Verdict recorded ✓
                        </Text>
                    )}
                </Flex>
            )}
        </VStack>
    );
}
