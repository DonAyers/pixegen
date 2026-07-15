import React, { useState, useEffect, useRef, useCallback } from "react";
import {
    Box,
    Container,
    Heading,
    Input,
    Select,
    Checkbox,
    Button,
    FormControl,
    FormLabel,
    HStack,
    VStack,
    Flex,
    Text,
    Image as ChakraImage,
    useToast,
    Divider,
    NumberInput,
    NumberInputField,
    ButtonGroup,
    IconButton,
    Grid,
    GridItem,
    Alert,
    AlertIcon,
    Code,
    Accordion,
    AccordionItem,
    AccordionButton,
    AccordionPanel,
    AccordionIcon,
    Tabs,
    TabList,
    TabPanels,
    Tab,
    TabPanel,
    useDisclosure,
} from "@chakra-ui/react";
import { ChevronLeftIcon, ChevronRightIcon, CopyIcon, CheckIcon, SettingsIcon } from "@chakra-ui/icons";
import {
    generateImage,
    generateSpriteSheet,
    DEFAULT_NEGATIVE_PROMPT,
    lastRequest,
    estimateBatchCount,
} from "./image-service.js";
import {
    processImage,
    processSpriteSheet,
    renderPixelArt,
    DITHER_OPTIONS,
    DOWNSCALE_OPTIONS,
    PREPROCESSING_PRESETS,
} from "./pixel-processor.js";
import {
    PALETTE_PROFILES,
    SPRITE_SCALES,
    DEFAULT_PROFILE,
} from "./palettes.js";
import { modelSupportsTransparent } from "./provider-service.js";
import {
    fetchImageModels,
    initModels,
    DEFAULT_MODELS,
    DEFAULT_MODEL_ID,
} from "./model-service.js";
import {
    ANIMATION_STATES,
    VIEWS,
    DEFAULT_STATE,
    DEFAULT_VIEW,
    buildPoseDescription,
    getStatesByCategory,
} from "./animation-states.js";
import { AnimationPreview } from "./AnimationPreview.jsx";
import { exportSpriteSheet } from "./sprite-sheet.js";
import {
    saveAllFrames,
    loadFrames,
    listCharacters,
    listAnimations,
} from "./sprite-storage.js";
import { Explorer } from "./Explorer.jsx";
import { Characters } from "./Characters.jsx";
import { TilesetStudio } from "./TilesetStudio.jsx";
import { CompareLab } from "./CompareLab.jsx";
import RunSidebar from "./RunSidebar.jsx";
import { startRun } from "./run-tracker.js";
import { randomPromptIdea } from "./core/prompt-ideas.js";
import {
    idealSettingsForTarget,
    emptyFindings,
} from "./core/eval-findings.js";

// Initialize multi-provider model service
initModels();

function App() {
    const toast = useToast();

    // Left sidebar view — lifted here so the header gear can open Settings
    const [sidebarView, setSidebarView] = useState("runs");

    // Prompt history (rendered by the left sidebar's "Prompts" view)
    const [promptHistory, setPromptHistory] = useState(() => {
        try {
            const saved = localStorage.getItem("pixegen_prompt_history");
            return saved ? JSON.parse(saved) : [];
        } catch (e) {
            console.error("Failed to load prompt history", e);
            return [];
        }
    });

    useEffect(() => {
        try {
            localStorage.setItem("pixegen_prompt_history", JSON.stringify(promptHistory));
        } catch (e) {
            console.error("Failed to save prompt history", e);
        }
    }, [promptHistory]);

    const recordPrompt = useCallback((text, type) => {
        if (!text || !text.trim()) return;
        const trimmed = text.trim();
        setPromptHistory((prev) => {
            const filtered = prev.filter((item) => item.text !== trimmed);
            return [
                {
                    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
                    text: trimmed,
                    type: type, // "random" | "user"
                    timestamp: Date.now()
                },
                ...filtered
            ];
        });
    }, []);

    // Form state
    const [prompt, setPrompt] = useState("");
    const [consoleId, setConsoleId] = useState(DEFAULT_PROFILE);
    const [spriteSize, setSpriteSize] = useState("");
    const [modelId, setModelId] = useState(DEFAULT_MODEL_ID);
    const [pipelineMode, setPipelineMode] = useState("enhanced");
    const [downscaleMode, setDownscaleMode] = useState("");
    const [ditherMode, setDitherMode] = useState("");
    const [showGrid, setShowGrid] = useState(false);
    const [transparentBg, setTransparentBg] = useState(false);
    const [outlines, setOutlines] = useState(true);
    const [cleanup, setCleanup] = useState(true);
    const [negativePrompt, setNegativePrompt] = useState("");
    const [seed, setSeed] = useState("");
    const [preprocessingMode, setPreprocessingMode] = useState("standard");

    // Animation state
    const [animState, setAnimState] = useState(DEFAULT_STATE);
    const [view, setView] = useState(DEFAULT_VIEW);
    const [currentFrame, setCurrentFrame] = useState(0);

    // Player state — fps is mirrored here (via AnimationPreview's
    // onFpsChange) because the sheet export needs it too.
    const [fps, setFps] = useState(8);
    const [playerFrames, setPlayerFrames] = useState([]);

    // Save/load state
    const [charName, setCharName] = useState("");

    // UI state
    const [isGenerating, setIsGenerating] = useState(false);
    const [models, setModels] = useState(DEFAULT_MODELS);
    const [sourceImageSrc, setSourceImageSrc] = useState(null);
    const [ditherOptions, setDitherOptions] = useState(DITHER_OPTIONS.enhanced);

    // Frame storage
    const frameStore = useRef({});
    const pixelCanvasRef = useRef(null);

    const getFrameKey = useCallback(() => {
        return `${animState}:${view}`;
    }, [animState, view]);

    const getCurrentFrames = useCallback(() => {
        const key = getFrameKey();
        if (!frameStore.current[key]) {
            const count = ANIMATION_STATES[animState].frameCount;
            frameStore.current[key] = new Array(count).fill(null);
        }
        return frameStore.current[key];
    }, [animState, getFrameKey]);

    const getFrameCount = useCallback(() => {
        return ANIMATION_STATES[animState].frameCount;
    }, [animState]);

    // Fetch models on mount
    useEffect(() => {
        fetchImageModels().then((fetchedModels) => {
            setModels(fetchedModels);
        });
    }, []);

    // Reset to the profile's suggested scale when the palette changes
    // (scales themselves are profile-independent — see palettes.js)
    useEffect(() => {
        const cfg = PALETTE_PROFILES[consoleId];
        if (cfg) {
            setSpriteSize(cfg.defaultScale);
        }
    }, [consoleId]);

    // Update dither options when pipeline changes
    useEffect(() => {
        const options = DITHER_OPTIONS[pipelineMode] || DITHER_OPTIONS.enhanced;
        setDitherOptions(options);
        if (!options.some((o) => o.value === ditherMode)) {
            setDitherMode("");
        }
    }, [pipelineMode, ditherMode]);

    // Sync player frames — publishes a fresh array so AnimationPreview
    // reloads its player.
    const syncPlayerFrames = useCallback(() => {
        setPlayerFrames(getCurrentFrames().filter((f) => f !== null));
    }, [getCurrentFrames]);

    // Switching animation/view swaps the active frame set.
    useEffect(() => {
        syncPlayerFrames();
    }, [animState, view, syncPlayerFrames]);

    // Handle generate
    // `skipToast` is used by batch generation to avoid spamming toasts.
    const handleGenerate = useCallback(
        async (skipToast = false) => {
            if (!prompt.trim()) {
                toast({
                    title: "Please enter a description for your sprite",
                    status: "error",
                    duration: 3000,
                    isClosable: true,
                });
                return;
            }

            recordPrompt(prompt, "user");

            const consoleCfg = PALETTE_PROFILES[consoleId];
            const dithering = ditherMode || null;
            const model = modelId;
            const negPrompt = negativePrompt.trim() || DEFAULT_NEGATIVE_PROMPT;
            const seedVal = seed ? parseInt(seed, 10) : undefined;

            const run = startRun({
                prompt: prompt.trim(),
                model,
                type: "single",
                tab: "generator",
                settings: { consoleId, spriteSize, pipeline: pipelineMode },
            });

            try {
                setIsGenerating(true);

                const poseDesc = buildPoseDescription(
                    animState,
                    view,
                    currentFrame,
                );

                toast({
                    title: `Generating frame ${currentFrame + 1}/${getFrameCount()}...`,
                    status: "info",
                    duration: 2000,
                });

                const img = await generateImage(prompt, {
                    model,
                    transparent: transparentBg,
                    negativePrompt: negPrompt,
                    seed:
                        seedVal !== undefined
                            ? seedVal + currentFrame
                            : undefined,
                    consoleName: consoleCfg.name,
                    poseDesc,
                    onStage: (stage, detail) => run.update(stage, detail),
                });
                run.setUrl(lastRequest.url);

                setSourceImageSrc(img.src);
                const generationGroupId = crypto.randomUUID
                    ? crypto.randomUUID()
                    : `${Date.now()}-${Math.random()}`;

                run.update("processing");
                toast({
                    title: `Processing to ${consoleCfg.name} pixel art...`,
                    status: "info",
                    duration: 2000,
                });

                await new Promise((r) => setTimeout(r, 50));

                const preprocessingOptions =
                    PREPROCESSING_PRESETS[preprocessingMode] ||
                    PREPROCESSING_PRESETS.none;

                const { pixelData, spriteW, spriteH } = await processImage(
                    img,
                    {
                        consoleId,
                        spriteSize,
                        dithering,
                        pipeline: pipelineMode,
                        downscale: downscaleMode,
                        outlines,
                        cleanup,
                        preprocessing: preprocessingOptions,
                    },
                );

                if (pixelCanvasRef.current) {
                    renderPixelArt(
                        pixelCanvasRef.current,
                        pixelData,
                        spriteW,
                        spriteH,
                        {
                            showGrid,
                        },
                    );

                    const frameCanvas = document.createElement("canvas");
                    frameCanvas.width = pixelCanvasRef.current.width;
                    frameCanvas.height = pixelCanvasRef.current.height;
                    frameCanvas
                        .getContext("2d")
                        .drawImage(pixelCanvasRef.current, 0, 0);

                    const frames = getCurrentFrames();
                    frames[currentFrame] = {
                        canvas: frameCanvas,
                        pixelData,
                        spriteW,
                        spriteH,
                    };
                    syncPlayerFrames();

                    // Auto-save each generation so nothing is lost.
                    run.update("saving");
                    await saveAllFrames(
                        [{ canvas: frameCanvas, pixelData, spriteW, spriteH }],
                        {
                            characterName: charName.trim() || "untitled",
                            consoleId,
                            animState,
                            view,
                            frame: currentFrame,
                            prompt: prompt.trim(),
                            model: modelId,
                            sourceBlob: img._sourceBlob,
                            generationGroupId,
                            size: spriteSize,
                            pipeline: pipelineMode,
                            dither: ditherMode,
                            seed:
                                seedVal !== undefined
                                    ? seedVal + currentFrame
                                    : undefined,
                        },
                    );
                }

                run.complete(`${spriteW}×${spriteH} ${consoleCfg.name}`);
                if (!skipToast) {
                    toast({
                        title: `Done! Frame ${currentFrame + 1}/${getFrameCount()}`,
                        description: `${spriteW}×${spriteH} ${consoleCfg.name} sprite`,
                        status: "success",
                        duration: 3000,
                        isClosable: true,
                    });
                }
            } catch (err) {
                console.error("Generation failed:", err);
                run.fail({ message: err.message, detail: lastRequest.error });
                toast({
                    title: "Generation failed",
                    description: err.message,
                    status: "error",
                    duration: 5000,
                });
            } finally {
                setIsGenerating(false);
            }
        },
        [
            prompt,
            consoleId,
            ditherMode,
            modelId,
            negativePrompt,
            seed,
            animState,
            view,
            currentFrame,
            transparentBg,
            spriteSize,
            pipelineMode,
            downscaleMode,
            outlines,
            cleanup,
            showGrid,
            preprocessingMode,
            toast,
            getFrameCount,
            getCurrentFrames,
            syncPlayerFrames,
            recordPrompt,
        ],
    );

    // Handle reprocess
    const handleReprocess = useCallback(async () => {
        if (!sourceImageSrc) return;

        const consoleCfg = PALETTE_PROFILES[consoleId];
        const dithering = ditherMode || null;
        const preprocessingOptions =
            PREPROCESSING_PRESETS[preprocessingMode] ||
            PREPROCESSING_PRESETS.none;

        try {
            const img = new Image();
            img.src = sourceImageSrc;

            await new Promise((resolve, reject) => {
                img.onload = resolve;
                img.onerror = reject;
            });

            const { pixelData, spriteW, spriteH } = await processImage(img, {
                consoleId,
                spriteSize,
                dithering,
                pipeline: pipelineMode,
                downscale: downscaleMode,
                outlines,
                cleanup,
                preprocessing: preprocessingOptions,
            });

            if (pixelCanvasRef.current) {
                renderPixelArt(
                    pixelCanvasRef.current,
                    pixelData,
                    spriteW,
                    spriteH,
                    {
                        showGrid,
                    },
                );
            }

            toast({
                title: "Reprocessed",
                description: `${spriteW}×${spriteH} ${consoleCfg.name} sprite`,
                status: "success",
                duration: 2000,
            });
        } catch (err) {
            console.error("Reprocessing failed:", err);
            toast({
                title: "Reprocessing failed",
                description: err.message,
                status: "error",
                duration: 3000,
            });
        }
    }, [
        sourceImageSrc,
        consoleId,
        spriteSize,
        ditherMode,
        pipelineMode,
        downscaleMode,
        outlines,
        cleanup,
        showGrid,
        preprocessingMode,
        toast,
    ]);

    // Auto-reprocess when settings change
    useEffect(() => {
        if (sourceImageSrc) {
            handleReprocess();
        }
    }, [
        consoleId,
        spriteSize,
        ditherMode,
        showGrid,
        pipelineMode,
        downscaleMode,
        outlines,
        cleanup,
        preprocessingMode,
        sourceImageSrc,
        handleReprocess,
    ]);

    // Handle generate all frames — the default, cost-efficient batched path.
    // Generates every frame of the current animation in as few AI requests
    // as possible (one request unless the frame count exceeds a single
    // request's resolution budget), instead of one AI call per frame.
    const handleGenerateAllFrames = async () => {
        if (!prompt.trim()) {
            toast({
                title: "Please enter a description",
                status: "error",
                duration: 3000,
            });
            return;
        }

        recordPrompt(prompt, "user");

        const consoleCfg = PALETTE_PROFILES[consoleId];
        const dithering = ditherMode || null;
        const model = modelId;
        const negPrompt = negativePrompt.trim();
        const seedVal = seed ? parseInt(seed, 10) : undefined;
        const total = getFrameCount();
        const animStateObj = ANIMATION_STATES[animState];
        const viewObj = VIEWS[view];

        const run = startRun({
            prompt: prompt.trim(),
            model,
            type: "sheet",
            tab: "generator",
            settings: { consoleId, spriteSize, pipeline: pipelineMode },
        });

        try {
            setIsGenerating(true);

            const batchCount = estimateBatchCount(total);
            toast({
                title:
                    batchCount > 1
                        ? `Generating ${total} frames in ${batchCount} batches...`
                        : `Generating ${total}-frame sprite sheet...`,
                status: "info",
                duration: 2000,
            });

            const sheetResult = await generateSpriteSheet(prompt, {
                model,
                frameCount: total,
                seed: seedVal,
                transparent: transparentBg,
                negativePrompt: negPrompt,
                consoleName: consoleCfg.name,
                viewDesc: viewObj.promptDesc,
                animDesc: animStateObj.promptDesc,
                frameHints: animStateObj.frameHints,
                onStage: (stage, detail) => run.update(stage, detail),
            });
            run.setUrl(lastRequest.url);

            const firstImg = sheetResult.batches[0]?.img;
            if (firstImg) setSourceImageSrc(firstImg.src);
            const sheetGroupId = crypto.randomUUID
                ? crypto.randomUUID()
                : `${Date.now()}-${Math.random()}`;

            run.update("processing", `slicing ${total} frames`);
            toast({
                title: `Slicing ${total} frames...`,
                status: "info",
                duration: 2000,
            });

            await new Promise((r) => setTimeout(r, 50));

            const preprocessingOptions =
                PREPROCESSING_PRESETS[preprocessingMode] ||
                PREPROCESSING_PRESETS.none;

            const { frames: processedFrames } = await processSpriteSheet(
                sheetResult,
                {
                    consoleId,
                    spriteSize,
                    dithering,
                    pipeline: pipelineMode,
                    downscale: downscaleMode,
                    outlines,
                    cleanup,
                    preprocessing: preprocessingOptions,
                },
            );

            const storedFrames = getCurrentFrames();
            for (
                let i = 0;
                i < processedFrames.length && i < storedFrames.length;
                i++
            ) {
                const { pixelData, spriteW, spriteH } = processedFrames[i];

                const frameCanvas = document.createElement("canvas");
                renderPixelArt(frameCanvas, pixelData, spriteW, spriteH, {
                    showGrid,
                });

                storedFrames[i] = {
                    canvas: frameCanvas,
                    pixelData,
                    spriteW,
                    spriteH,
                };
            }

            if (storedFrames[0] && pixelCanvasRef.current) {
                const ctx = pixelCanvasRef.current.getContext("2d");
                pixelCanvasRef.current.width = storedFrames[0].canvas.width;
                pixelCanvasRef.current.height = storedFrames[0].canvas.height;
                ctx.drawImage(storedFrames[0].canvas, 0, 0);
            }

            setCurrentFrame(0);
            syncPlayerFrames();

            // Auto-save the sheet with shared source blob.
            run.update("saving");
            try {
                const saveMeta = {
                    characterName: charName.trim() || "untitled",
                    consoleId,
                    animState,
                    view,
                    prompt: prompt.trim(),
                    model: modelId,
                    sourceBlob: firstImg?._sourceBlob,
                    generationGroupId: sheetGroupId,
                    size: spriteSize,
                    pipeline: pipelineMode,
                    dither: ditherMode,
                    seed: seedVal,
                };
                for (
                    let i = 0;
                    i < processedFrames.length && i < storedFrames.length;
                    i++
                ) {
                    if (storedFrames[i]) {
                        await saveAllFrames([storedFrames[i]], {
                            ...saveMeta,
                            frame: i,
                        });
                    }
                }
            } catch (saveErr) {
                console.error("Auto-save sheet failed:", saveErr);
            }

            run.complete(`${total} frames, ${processedFrames[0]?.spriteW}×${processedFrames[0]?.spriteH}`);
            toast({
                title: `Done! ${total}-frame sprite sheet`,
                description: `${processedFrames[0]?.spriteW}×${processedFrames[0]?.spriteH} ${consoleCfg.name} sprites`,
                status: "success",
                duration: 3000,
            });
        } catch (err) {
            console.error("Batch generation failed:", err);
            run.fail({ message: err.message, detail: lastRequest.error });
            toast({
                title: "Batch generation failed",
                description: err.message,
                status: "error",
                duration: 5000,
            });
        } finally {
            setIsGenerating(false);
        }
    };

    // Auto-configure the recorded ideal settings for the selected target
    // (from eval/findings.json via the dev-server endpoint; falls back to
    // the recipe baseline when no trials exist or the endpoint is absent).
    const handleApplyIdeal = async () => {
        let findings = null;
        try {
            const res = await fetch("/api/eval/findings");
            if (res.ok) findings = await res.json();
        } catch {
            // Production build / endpoint unavailable — baseline still applies.
        }

        const { settings, trials, source } = idealSettingsForTarget(
            findings || emptyFindings(),
            consoleId,
        );

        if (settings.spriteSize) setSpriteSize(settings.spriteSize);
        if (settings.pipeline) setPipelineMode(settings.pipeline);
        setDownscaleMode(settings.downscale || "");
        setDitherMode(settings.dithering || "");
        if (settings.outlines !== undefined) setOutlines(settings.outlines);
        if (settings.cleanup !== undefined) setCleanup(settings.cleanup);
        if (typeof settings.preprocessing === "string") {
            setPreprocessingMode(settings.preprocessing);
        }
        if (settings.model) {
            setModelId(
                settings.model.includes(":")
                    ? settings.model
                    : `pollinations:${settings.model}`,
            );
        }

        toast({
            title:
                source === "ideal"
                    ? `Applied ideal settings for ${consoleCfg?.name || consoleId}`
                    : `No trials recorded for ${consoleCfg?.name || consoleId} yet`,
            description:
                source === "ideal"
                    ? `Based on ${trials} decisive trial${trials === 1 ? "" : "s"} (eval/findings.json)`
                    : "Applied the recipe baseline — run comparisons in the A/B Test tab to teach it.",
            status: source === "ideal" ? "success" : "info",
            duration: 4000,
        });
    };

    // Handle save frames
    const handleSaveFrames = async () => {
        const frames = getCurrentFrames().filter((f) => f !== null);
        if (frames.length === 0) {
            toast({
                title: "No frames to save",
                description: "Generate some first",
                status: "error",
                duration: 3000,
            });
            return;
        }

        const name = charName.trim() || "untitled";

        try {
            // Same metadata as auto-save so Explorer groups these frames as
            // one generation instead of fragmenting them by timestamp.
            await saveAllFrames(getCurrentFrames(), {
                characterName: name,
                consoleId,
                animState,
                view,
                prompt: prompt.trim(),
                model: modelId,
                generationGroupId: crypto.randomUUID
                    ? crypto.randomUUID()
                    : `${Date.now()}-${Math.random()}`,
                size: spriteSize,
                pipeline: pipelineMode,
                dither: ditherMode,
                seed: seed ? parseInt(seed, 10) : undefined,
            });

            toast({
                title: "Saved!",
                description: `${frames.length} frames for "${name}" (${animState}/${view})`,
                status: "success",
                duration: 3000,
            });
        } catch (err) {
            console.error("Save failed:", err);
            toast({
                title: "Save failed",
                description: err.message,
                status: "error",
                duration: 5000,
            });
        }
    };

    // Handle export sheet
    const handleExportSheet = async () => {
        const frames = getCurrentFrames().filter((f) => f !== null);
        if (frames.length === 0) {
            toast({
                title: "No frames to export",
                description: "Generate some first",
                status: "error",
                duration: 3000,
            });
            return;
        }

        try {
            const name = charName.trim() || "sprite";
            const consoleCfg = PALETTE_PROFILES[consoleId];
            const animStateObj = ANIMATION_STATES[animState];

            const result = await exportSpriteSheet(frames, {
                characterName: name,
                animName: animState,
                consoleName: consoleId,
                fps,
                loop: animStateObj.loop,
            });

            toast({
                title: "Exported!",
                description: `${result.pngName} + ${result.jsonName} (${frames.length} frames)`,
                status: "success",
                duration: 3000,
            });
        } catch (err) {
            console.error("Export failed:", err);
            toast({
                title: "Export failed",
                description: err.message,
                status: "error",
                duration: 5000,
            });
        }
    };

    // Handle load
    const handleLoad = async () => {
        const name = charName.trim();
        if (!name) {
            try {
                const chars = await listCharacters();
                if (chars.length === 0) {
                    toast({
                        title: "No saved characters found",
                        status: "info",
                        duration: 3000,
                    });
                } else {
                    toast({
                        title: "Saved characters",
                        description: `${chars.join(", ")}. Enter a name and click Load.`,
                        status: "info",
                        duration: 5000,
                    });
                }
            } catch (err) {
                toast({
                    title: "Load error",
                    description: err.message,
                    status: "error",
                    duration: 5000,
                });
            }
            return;
        }

        try {
            const loaded = await loadFrames(name, animState, view);

            if (loaded.length === 0) {
                const anims = await listAnimations(name);
                if (anims.length === 0) {
                    toast({
                        title: `No saved data for "${name}"`,
                        status: "error",
                        duration: 3000,
                    });
                } else {
                    const avail = anims
                        .map(
                            (a) =>
                                `${a.animState}/${a.view} (${a.frameCount}f)`,
                        )
                        .join(", ");
                    toast({
                        title: `No ${animState}/${view} for "${name}"`,
                        description: `Available: ${avail}`,
                        status: "error",
                        duration: 5000,
                    });
                }
                return;
            }

            const frames = getCurrentFrames();
            for (const f of loaded) {
                const idx = f.meta.frame;
                if (idx < frames.length) {
                    frames[idx] = {
                        canvas: f.canvas,
                        spriteW: f.spriteW,
                        spriteH: f.spriteH,
                    };
                }
            }

            setCurrentFrame(0);
            syncPlayerFrames();

            toast({
                title: "Loaded!",
                description: `${loaded.length} frames for "${name}" (${animState}/${view})`,
                status: "success",
                duration: 3000,
            });
        } catch (err) {
            console.error("Load failed:", err);
            toast({
                title: "Load failed",
                description: err.message,
                status: "error",
                duration: 5000,
            });
        }
    };

    const consoleCfg = PALETTE_PROFILES[consoleId];
    const spriteScales = Object.entries(SPRITE_SCALES);
    const selectedModelInfo = models.find(
        (m) => (m.fullId || m.id) === modelId,
    );
    const transparentSupported = modelSupportsTransparent(modelId);
    const batchEstimate = estimateBatchCount(getFrameCount());

    return (
        <Flex align="flex-start">
            <RunSidebar
                view={sidebarView}
                onViewChange={setSidebarView}
                promptHistory={promptHistory}
                onUsePrompt={(text) => {
                    setPrompt(text);
                    toast({
                        title: "Prompt loaded",
                        description:
                            "Prompt copied into main generator input field.",
                        status: "success",
                        duration: 2000,
                        isClosable: true,
                    });
                }}
                onClearPrompts={() => {
                    setPromptHistory([]);
                    toast({
                        title: "History Cleared",
                        status: "info",
                        duration: 2000,
                    });
                }}
            />
            <Container maxW="container.lg" py={8} flex="1" minW={0}>
            <Flex justifyContent="space-between" alignItems="center" mb={6}>
                <Heading color="brand.500" letterSpacing="wider" mb={0}>
                    PixelGen
                </Heading>
                <IconButton
                    aria-label="Settings"
                    title="Settings"
                    icon={<SettingsIcon />}
                    size="sm"
                    variant="ghost"
                    onClick={() => setSidebarView("settings")}
                />
            </Flex>

            {/* isLazy so Explorer mounts (and loads saved rows) when its tab
                is first opened rather than at page load, when nothing has
                been generated yet; keepMounted preserves tab state after. */}
            <Tabs
                colorScheme="brand"
                variant="enclosed"
                mb={6}
                isLazy
                lazyBehavior="keepMounted"
            >
                <TabList>
                    <Tab>Generator</Tab>
                    <Tab>Inspector</Tab>
                    <Tab>Explorer</Tab>
                    <Tab>Characters</Tab>
                    <Tab>Tileset</Tab>
                    <Tab>A/B Test</Tab>
                </TabList>

                <TabPanels>
                    <TabPanel>
                        {/* Main Input */}
                        <VStack spacing={4} align="stretch" mb={6}>
                            <FormControl>
                                <FormLabel fontSize="sm" color="gray.400">
                                    Describe your sprite:
                                </FormLabel>
                                <HStack>
                                    <Input
                                        value={prompt}
                                        onChange={(e) =>
                                            setPrompt(e.target.value)
                                        }
                                        onKeyPress={(e) =>
                                            e.key === "Enter" &&
                                            handleGenerate()
                                        }
                                        placeholder="e.g. a knight with a sword, a red dragon, a treasure chest..."
                                        bg="background.secondary"
                                        borderColor="gray.600"
                                    />
                                    <Button
                                        onClick={() => {
                                            const idea = randomPromptIdea(
                                                consoleId,
                                                "sprite",
                                            );
                                            setPrompt(idea);
                                            recordPrompt(idea, "random");
                                        }}
                                        aria-label="Random prompt idea"
                                        title="Random idea inspired by classics of the selected system"
                                        px={3}
                                        flexShrink={0}
                                    >
                                        🎲
                                    </Button>
                                </HStack>
                            </FormControl>

                            {/* Controls Row 1 */}
                            <Flex gap={4} flexWrap="wrap">
                                <FormControl maxW="260px">
                                    <FormLabel fontSize="xs" color="gray.400">
                                        System:
                                    </FormLabel>
                                    <HStack spacing={2}>
                                        <Select
                                            value={consoleId}
                                            onChange={(e) =>
                                                setConsoleId(e.target.value)
                                            }
                                            bg="background.secondary"
                                            borderColor="gray.600"
                                            size="sm"
                                        >
                                            {Object.entries(
                                                PALETTE_PROFILES,
                                            ).map(([id, cfg]) => (
                                                <option key={id} value={id}>
                                                    {cfg.name}
                                                </option>
                                            ))}
                                        </Select>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            flexShrink={0}
                                            onClick={handleApplyIdeal}
                                            aria-label="Apply ideal settings"
                                            title="Auto-configure the best-known settings for this system (from recorded A/B trials)"
                                        >
                                            ✨ Ideal
                                        </Button>
                                    </HStack>
                                </FormControl>

                                <FormControl maxW="150px">
                                    <FormLabel fontSize="xs" color="gray.400">
                                        Size:
                                    </FormLabel>
                                    <Select
                                        value={spriteSize}
                                        onChange={(e) =>
                                            setSpriteSize(e.target.value)
                                        }
                                        bg="background.secondary"
                                        borderColor="gray.600"
                                        size="sm"
                                    >
                                        {spriteScales.map(
                                            ([key, { w, h, label }]) => (
                                                <option key={key} value={key}>
                                                    {label} ({w}×{h})
                                                </option>
                                            ),
                                        )}
                                    </Select>
                                </FormControl>

                                <FormControl maxW="200px">
                                    <FormLabel fontSize="xs" color="gray.400">
                                        AI Model:
                                    </FormLabel>
                                    <Select
                                        value={modelId}
                                        onChange={(e) =>
                                            setModelId(e.target.value)
                                        }
                                        bg="background.secondary"
                                        borderColor="gray.600"
                                        size="sm"
                                    >
                                        {(() => {
                                            // Group models by provider
                                            const modelsByProvider = {};
                                            models.forEach((m) => {
                                                const provider =
                                                    m.providerName ||
                                                    "Pollinations";
                                                if (
                                                    !modelsByProvider[provider]
                                                ) {
                                                    modelsByProvider[provider] =
                                                        [];
                                                }
                                                modelsByProvider[provider].push(
                                                    m,
                                                );
                                            });

                                            // Render optgroups
                                            return Object.entries(
                                                modelsByProvider,
                                            ).map(
                                                ([
                                                    providerName,
                                                    providerModels,
                                                ]) => (
                                                    <optgroup
                                                        key={providerName}
                                                        label={providerName}
                                                    >
                                                        {providerModels.map(
                                                            (m) => (
                                                <option
                                                                    key={
                                                                        m.fullId ||
                                                                        m.id
                                                                    }
                                                                    value={
                                                                        m.fullId ||
                                                                        m.id
                                                                    }
                                                                    disabled={
                                                                        m.available ===
                                                                        false
                                                                    }
                                                                    title={
                                                                        m.available ===
                                                                        false
                                                                            ? `Set ${m.provider === "openai" ? "OPENAI_API_KEY" : "the provider key"} in .env and restart the dev server`
                                                                            : `${m.description} (${m.cost})`
                                                                    }
                                                                >
                                                                    {m.name} —{" "}
                                                                    {m.cost}
                                                                    {m.paidOnly
                                                                        ? " 🔑 API key required"
                                                                        : ""}
                                                                    {m.available ===
                                                                    false
                                                                        ? " (key not configured)"
                                                                        : ""}
                                                                </option>
                                                            ),
                                                        )}
                                                    </optgroup>
                                                ),
                                            );
                                        })()}
                                    </Select>
                                    {selectedModelInfo && (
                                        <Text
                                            fontSize="xs"
                                            color="gray.500"
                                            mt={1}
                                        >
                                            Est. cost: {batchEstimate} req
                                            {batchEstimate === 1 ? "" : "s"} ×{" "}
                                            {selectedModelInfo.cost}
                                        </Text>
                                    )}
                                </FormControl>
                            </Flex>

                            {/* Controls Row 2 */}
                            <Flex gap={4} flexWrap="wrap" alignItems="flex-end">
                                <FormControl maxW="180px">
                                    <FormLabel fontSize="xs" color="gray.400">
                                        Pipeline:
                                    </FormLabel>
                                    <Select
                                        value={pipelineMode}
                                        onChange={(e) =>
                                            setPipelineMode(e.target.value)
                                        }
                                        bg="background.secondary"
                                        borderColor="gray.600"
                                        size="sm"
                                    >
                                        <option value="enhanced">
                                            Enhanced (OKLAB)
                                        </option>
                                        <option value="classic">
                                            Classic (sRGB)
                                        </option>
                                    </Select>
                                </FormControl>

                                <FormControl maxW="180px">
                                    <FormLabel fontSize="xs" color="gray.400">
                                        Dithering:
                                    </FormLabel>
                                    <Select
                                        value={ditherMode}
                                        onChange={(e) =>
                                            setDitherMode(e.target.value)
                                        }
                                        bg="background.secondary"
                                        borderColor="gray.600"
                                        size="sm"
                                    >
                                        {ditherOptions.map((opt) => (
                                            <option
                                                key={opt.value}
                                                value={opt.value}
                                            >
                                                {opt.label}
                                            </option>
                                        ))}
                                    </Select>
                                </FormControl>

                                <FormControl maxW="180px">
                                    <FormLabel fontSize="xs" color="gray.400">
                                        Downscale:
                                    </FormLabel>
                                    <Select
                                        value={downscaleMode}
                                        onChange={(e) =>
                                            setDownscaleMode(e.target.value)
                                        }
                                        bg="background.secondary"
                                        borderColor="gray.600"
                                        size="sm"
                                    >
                                        <option value="">
                                            Auto (pipeline default)
                                        </option>
                                        {DOWNSCALE_OPTIONS.map((opt) => (
                                            <option
                                                key={opt.value}
                                                value={opt.value}
                                            >
                                                {opt.label}
                                            </option>
                                        ))}
                                    </Select>
                                </FormControl>

                                <FormControl maxW="180px">
                                    <FormLabel fontSize="xs" color="gray.400">
                                        Preprocessing:
                                    </FormLabel>
                                    <Select
                                        value={preprocessingMode}
                                        onChange={(e) =>
                                            setPreprocessingMode(e.target.value)
                                        }
                                        bg="background.secondary"
                                        borderColor="gray.600"
                                        size="sm"
                                    >
                                        {Object.entries(
                                            PREPROCESSING_PRESETS,
                                        ).map(([key, preset]) => (
                                            <option key={key} value={key}>
                                                {preset.label}
                                            </option>
                                        ))}
                                    </Select>
                                </FormControl>

                                <FormControl maxW="80px">
                                    <FormLabel fontSize="xs" color="gray.400">
                                        Grid:
                                    </FormLabel>
                                    <Checkbox
                                        isChecked={showGrid}
                                        onChange={(e) =>
                                            setShowGrid(e.target.checked)
                                        }
                                    />
                                </FormControl>

                                <FormControl maxW="140px">
                                    <FormLabel fontSize="xs" color="gray.400">
                                        Transparent BG:
                                    </FormLabel>
                                    <Checkbox
                                        isChecked={
                                            transparentBg &&
                                            transparentSupported
                                        }
                                        isDisabled={!transparentSupported}
                                        onChange={(e) =>
                                            setTransparentBg(e.target.checked)
                                        }
                                        title={
                                            transparentSupported
                                                ? undefined
                                                : "Not supported by the selected model (GPT Image models only)"
                                        }
                                    />
                                    {!transparentSupported && (
                                        <Text fontSize="xs" color="gray.600">
                                            n/a for this model
                                        </Text>
                                    )}
                                </FormControl>

                                <FormControl maxW="100px">
                                    <FormLabel fontSize="xs" color="gray.400">
                                        Outlines:
                                    </FormLabel>
                                    <Checkbox
                                        isChecked={outlines}
                                        onChange={(e) =>
                                            setOutlines(e.target.checked)
                                        }
                                    />
                                </FormControl>

                                <FormControl maxW="100px">
                                    <FormLabel fontSize="xs" color="gray.400">
                                        Cleanup:
                                    </FormLabel>
                                    <Checkbox
                                        isChecked={cleanup}
                                        onChange={(e) =>
                                            setCleanup(e.target.checked)
                                        }
                                    />
                                </FormControl>

                                <Button
                                    onClick={() => handleGenerate()}
                                    isLoading={isGenerating}
                                    loadingText="Generating..."
                                    size="md"
                                >
                                    Generate
                                </Button>
                            </Flex>

                            {/* Negative Prompt & Seed */}
                            <Flex gap={4} flexWrap="wrap">
                                <FormControl flex="1" minW="200px">
                                    <FormLabel fontSize="xs" color="gray.400">
                                        Avoid:
                                    </FormLabel>
                                    <Input
                                        value={negativePrompt}
                                        onChange={(e) =>
                                            setNegativePrompt(e.target.value)
                                        }
                                        placeholder={DEFAULT_NEGATIVE_PROMPT}
                                        bg="background.secondary"
                                        borderColor="gray.600"
                                        size="sm"
                                    />
                                </FormControl>

                                <FormControl
                                    maxW="150px"
                                    isDisabled={
                                        selectedModelInfo?.supportsSeed ===
                                        false
                                    }
                                >
                                    <FormLabel fontSize="xs" color="gray.400">
                                        Seed:
                                    </FormLabel>
                                    <NumberInput
                                        value={seed}
                                        onChange={(val) => setSeed(val)}
                                        min={0}
                                        max={999999}
                                        isDisabled={
                                            selectedModelInfo?.supportsSeed ===
                                            false
                                        }
                                    >
                                        <NumberInputField
                                            placeholder="random"
                                            bg="background.secondary"
                                            borderColor="gray.600"
                                            size="sm"
                                        />
                                    </NumberInput>
                                    {selectedModelInfo?.supportsSeed ===
                                        false && (
                                        <Text fontSize="10px" color="gray.500">
                                            no seed support for this model
                                        </Text>
                                    )}
                                </FormControl>
                            </Flex>
                        </VStack>

                        <Divider my={4} borderColor="gray.700" />

                        {/* Animation Controls */}
                        <Flex
                            gap={4}
                            flexWrap="wrap"
                            alignItems="flex-end"
                            mb={4}
                        >
                            <FormControl maxW="200px">
                                <FormLabel fontSize="xs" color="gray.400">
                                    Animation:
                                </FormLabel>
                                <Select
                                    value={animState}
                                    onChange={(e) => {
                                        setAnimState(e.target.value);
                                        setCurrentFrame(0);
                                    }}
                                    bg="background.secondary"
                                    borderColor="gray.600"
                                    size="sm"
                                >
                                    {getStatesByCategory().map((group) => (
                                        <optgroup
                                            key={group.label}
                                            label={group.label}
                                        >
                                            {group.states.map((state) => (
                                                <option
                                                    key={state.id}
                                                    value={state.id}
                                                >
                                                    {state.name} (
                                                    {state.frameCount}f)
                                                </option>
                                            ))}
                                        </optgroup>
                                    ))}
                                </Select>
                            </FormControl>

                            <FormControl maxW="150px">
                                <FormLabel fontSize="xs" color="gray.400">
                                    View:
                                </FormLabel>
                                <Select
                                    value={view}
                                    onChange={(e) => {
                                        setView(e.target.value);
                                        setCurrentFrame(0);
                                    }}
                                    bg="background.secondary"
                                    borderColor="gray.600"
                                    size="sm"
                                >
                                    {Object.entries(VIEWS).map(([id, v]) => (
                                        <option key={id} value={id}>
                                            {v.name}
                                        </option>
                                    ))}
                                </Select>
                            </FormControl>

                            <FormControl maxW="150px">
                                <FormLabel fontSize="xs" color="gray.400">
                                    Frame:
                                </FormLabel>
                                <HStack>
                                    <IconButton
                                        icon={<ChevronLeftIcon />}
                                        size="sm"
                                        onClick={() =>
                                            setCurrentFrame(
                                                Math.max(0, currentFrame - 1),
                                            )
                                        }
                                        isDisabled={currentFrame <= 0}
                                        aria-label="Previous frame"
                                    />
                                    <Text
                                        fontSize="sm"
                                        minW="50px"
                                        textAlign="center"
                                    >
                                        {currentFrame + 1} / {getFrameCount()}
                                    </Text>
                                    <IconButton
                                        icon={<ChevronRightIcon />}
                                        size="sm"
                                        onClick={() =>
                                            setCurrentFrame(
                                                Math.min(
                                                    getFrameCount() - 1,
                                                    currentFrame + 1,
                                                ),
                                            )
                                        }
                                        isDisabled={
                                            currentFrame >= getFrameCount() - 1
                                        }
                                        aria-label="Next frame"
                                    />
                                </HStack>
                            </FormControl>

                            <Button
                                onClick={handleGenerateAllFrames}
                                isDisabled={
                                    isGenerating ||
                                    selectedModelInfo?.provider === "openai"
                                }
                                title={
                                    selectedModelInfo?.provider === "openai"
                                        ? "OpenAI models generate single sprites in the browser — use the CLI for full sheets"
                                        : undefined
                                }
                                size="sm"
                                variant="outline"
                                colorScheme="purple"
                            >
                                Generate All Frames
                            </Button>
                        </Flex>

                        {/* Console Info */}
                        {consoleCfg && (
                            <Alert
                                status="info"
                                variant="left-accent"
                                mb={4}
                                bg="background.secondary"
                                borderColor="brand.500"
                            >
                                <AlertIcon />
                                <Text fontSize="xs">
                                    {consoleCfg.fullName} ({consoleCfg.year}) ·{" "}
                                    {consoleCfg.colorDepth} ·{" "}
                                    {consoleCfg.colorsPerSprite} per sprite
                                </Text>
                            </Alert>
                        )}

                        {/* Output Panels */}
                        <Grid templateColumns="repeat(2, 1fr)" gap={6} mb={6}>
                            <GridItem>
                                <FormLabel fontSize="sm" color="gray.400">
                                    Source (AI generated):
                                </FormLabel>
                                <Box
                                    bg="background.tertiary"
                                    border="1px solid"
                                    borderColor="gray.700"
                                    borderRadius="md"
                                    minH="280px"
                                    display="flex"
                                    alignItems="center"
                                    justifyContent="center"
                                    overflow="hidden"
                                >
                                    {sourceImageSrc ? (
                                        <ChakraImage
                                            src={sourceImageSrc}
                                            maxH="280px"
                                            alt="Generated source"
                                        />
                                    ) : (
                                        <Text
                                            color="gray.600"
                                            fontStyle="italic"
                                            fontSize="sm"
                                        >
                                            Enter a prompt and click Generate
                                        </Text>
                                    )}
                                </Box>
                            </GridItem>

                            <GridItem>
                                <FormLabel fontSize="sm" color="gray.400">
                                    {consoleCfg?.name} Pixel Art:
                                </FormLabel>
                                <Box
                                    bg="background.tertiary"
                                    border="1px solid"
                                    borderColor="gray.700"
                                    borderRadius="md"
                                    minH="280px"
                                    display="flex"
                                    alignItems="center"
                                    justifyContent="center"
                                    overflow="hidden"
                                >
                                    <canvas
                                        ref={pixelCanvasRef}
                                        style={{
                                            imageRendering: "pixelated",
                                        }}
                                    />
                                </Box>
                            </GridItem>
                        </Grid>

                        {/* Frame Strip */}
                        <Box mb={6}>
                            <FormLabel fontSize="sm" color="gray.400">
                                Frames:
                            </FormLabel>
                            <Box
                                bg="background.tertiary"
                                border="1px solid"
                                borderColor="gray.700"
                                borderRadius="md"
                                p={2}
                                minH="60px"
                                overflowX="auto"
                            >
                                <HStack spacing={1}>
                                    {getCurrentFrames().map((frame, i) => (
                                        <Box
                                            key={i}
                                            w="48px"
                                            h="48px"
                                            border="2px solid"
                                            borderColor={
                                                i === currentFrame
                                                    ? "brand.500"
                                                    : "gray.700"
                                            }
                                            borderRadius="sm"
                                            cursor="pointer"
                                            bg="background.secondary"
                                            flexShrink={0}
                                            onClick={() => setCurrentFrame(i)}
                                            opacity={frame ? 1 : 0.3}
                                            borderStyle={
                                                frame ? "solid" : "dashed"
                                            }
                                        >
                                            {frame && (
                                                <canvas
                                                    width={48}
                                                    height={48}
                                                    ref={(canvas) => {
                                                        if (canvas && frame) {
                                                            const ctx =
                                                                canvas.getContext(
                                                                    "2d",
                                                                );
                                                            ctx.imageSmoothingEnabled = false;
                                                            ctx.drawImage(
                                                                frame.canvas,
                                                                0,
                                                                0,
                                                                48,
                                                                48,
                                                            );
                                                        }
                                                    }}
                                                    style={{
                                                        width: "100%",
                                                        height: "100%",
                                                        imageRendering:
                                                            "pixelated",
                                                    }}
                                                />
                                            )}
                                        </Box>
                                    ))}
                                </HStack>
                            </Box>
                        </Box>

                        {/* Animation Preview */}
                        <Box mb={6}>
                            <AnimationPreview
                                frames={playerFrames}
                                maxFps={30}
                                onFpsChange={setFps}
                                showPingPong
                                showOnionSkin
                                emptyText="Generate frames to preview the animation."
                            />
                        </Box>

                        {/* Save/Export */}
                        <Flex
                            gap={3}
                            flexWrap="wrap"
                            alignItems="flex-end"
                            mb={6}
                        >
                            <FormControl maxW="200px">
                                <FormLabel fontSize="xs" color="gray.400">
                                    Character name:
                                </FormLabel>
                                <Input
                                    value={charName}
                                    onChange={(e) =>
                                        setCharName(e.target.value)
                                    }
                                    placeholder="e.g. knight, dragon..."
                                    bg="background.secondary"
                                    borderColor="gray.600"
                                    size="sm"
                                />
                            </FormControl>

                            <Button
                                onClick={handleSaveFrames}
                                size="sm"
                                variant="outline"
                                colorScheme="brand"
                            >
                                Save Frames
                            </Button>

                            <Button
                                onClick={handleExportSheet}
                                size="sm"
                                variant="outline"
                                colorScheme="brand"
                            >
                                Export Sheet
                            </Button>

                            <Button
                                onClick={handleLoad}
                                size="sm"
                                variant="outline"
                                colorScheme="brand"
                            >
                                Load
                            </Button>
                        </Flex>

                        {/* Prompt Debug */}
                        <Accordion allowToggle>
                            <AccordionItem
                                border="1px solid"
                                borderColor="gray.700"
                                borderRadius="md"
                            >
                                <AccordionButton>
                                    <Box
                                        flex="1"
                                        textAlign="left"
                                        fontSize="xs"
                                        color="gray.500"
                                    >
                                        Show Prompt Details
                                    </Box>
                                    <AccordionIcon />
                                </AccordionButton>
                                <AccordionPanel pb={4}>
                                    <VStack align="stretch" spacing={3}>
                                        <Box>
                                            <Text
                                                fontSize="xs"
                                                color="gray.600"
                                                textTransform="uppercase"
                                                mb={1}
                                            >
                                                Prompt sent:
                                            </Text>
                                            <Code
                                                display="block"
                                                whiteSpace="pre-wrap"
                                                p={2}
                                                bg="gray.900"
                                                fontSize="xs"
                                                borderRadius="sm"
                                                maxH="120px"
                                                overflowY="auto"
                                            >
                                                {lastRequest.prompt || "—"}
                                            </Code>
                                        </Box>

                                        <Box>
                                            <Text
                                                fontSize="xs"
                                                color="gray.600"
                                                textTransform="uppercase"
                                                mb={1}
                                            >
                                                Negative prompt:
                                            </Text>
                                            <Code
                                                display="block"
                                                whiteSpace="pre-wrap"
                                                p={2}
                                                bg="gray.900"
                                                fontSize="xs"
                                                borderRadius="sm"
                                            >
                                                {lastRequest.negativePrompt ||
                                                    "(none)"}
                                            </Code>
                                        </Box>

                                        <Box>
                                            <Text
                                                fontSize="xs"
                                                color="gray.600"
                                                textTransform="uppercase"
                                                mb={1}
                                            >
                                                Request:
                                            </Text>
                                            <Code
                                                display="block"
                                                whiteSpace="pre-wrap"
                                                wordBreak="break-all"
                                                p={2}
                                                bg="gray.900"
                                                fontSize="xs"
                                                borderRadius="sm"
                                                maxH="120px"
                                                overflowY="auto"
                                            >
                                                {lastRequest.type === "sheet"
                                                    ? "Sheet"
                                                    : lastRequest.type ===
                                                        "grid"
                                                      ? "Grid"
                                                      : "Single"}{" "}
                                                | {lastRequest.model} |{" "}
                                                {lastRequest.width}×
                                                {lastRequest.height}
                                                {"\n"}
                                                {lastRequest.url}
                                            </Code>
                                        </Box>
                                    </VStack>
                                </AccordionPanel>
                            </AccordionItem>
                        </Accordion>
                    </TabPanel>

                    {/* Inspector Tab */}
                    <TabPanel>
                        <VStack align="stretch" spacing={6}>
                            <Box>
                                <Heading size="md" mb={2} color="brand.500">
                                    Request Inspector
                                </Heading>
                                <Text fontSize="sm" color="gray.400">
                                    View raw model input and output from the
                                    last generation request.
                                </Text>
                            </Box>

                            {/* Request Details */}
                            <Box
                                bg="background.secondary"
                                p={5}
                                borderRadius="md"
                                borderWidth="1px"
                                borderColor="gray.700"
                            >
                                <Heading size="sm" mb={4} color="brand.500">
                                    Request Details
                                </Heading>
                                <VStack align="stretch" spacing={3}>
                                    <Flex>
                                        <Text
                                            fontSize="sm"
                                            fontWeight="bold"
                                            color="brand.500"
                                            minW="120px"
                                        >
                                            Provider:
                                        </Text>
                                        <Text fontSize="sm">
                                            {lastRequest.provider || "—"}
                                        </Text>
                                    </Flex>
                                    <Flex>
                                        <Text
                                            fontSize="sm"
                                            fontWeight="bold"
                                            color="brand.500"
                                            minW="120px"
                                        >
                                            Model:
                                        </Text>
                                        <Text fontSize="sm">
                                            {lastRequest.model || "—"}
                                        </Text>
                                    </Flex>
                                    <Flex>
                                        <Text
                                            fontSize="sm"
                                            fontWeight="bold"
                                            color="brand.500"
                                            minW="120px"
                                        >
                                            Type:
                                        </Text>
                                        <Text fontSize="sm">
                                            {lastRequest.type === "sheet"
                                                ? "Sprite Sheet"
                                                : lastRequest.type === "grid"
                                                  ? "Tile Grid"
                                                  : lastRequest.type ===
                                                      "single"
                                                    ? "Single Frame"
                                                    : "—"}
                                        </Text>
                                    </Flex>
                                    <Flex>
                                        <Text
                                            fontSize="sm"
                                            fontWeight="bold"
                                            color="brand.500"
                                            minW="120px"
                                        >
                                            Dimensions:
                                        </Text>
                                        <Text fontSize="sm">
                                            {lastRequest.width &&
                                            lastRequest.height
                                                ? `${lastRequest.width} × ${lastRequest.height} px`
                                                : "—"}
                                        </Text>
                                    </Flex>
                                    <Flex>
                                        <Text
                                            fontSize="sm"
                                            fontWeight="bold"
                                            color="brand.500"
                                            minW="120px"
                                        >
                                            Outcome:
                                        </Text>
                                        <Text
                                            fontSize="sm"
                                            color={
                                                lastRequest.error
                                                    ? "red.300"
                                                    : "green.300"
                                            }
                                        >
                                            {lastRequest.error
                                                ? `FAILED${lastRequest.status ? ` (HTTP ${lastRequest.status})` : ""}`
                                                : lastRequest.status
                                                  ? `OK (HTTP ${lastRequest.status})`
                                                  : "—"}
                                            {lastRequest.durationMs
                                                ? ` — ${(lastRequest.durationMs / 1000).toFixed(1)}s`
                                                : ""}
                                        </Text>
                                    </Flex>
                                </VStack>
                            </Box>

                            {/* Error detail (present only after a failed request) */}
                            {lastRequest.error && (
                                <Box
                                    bg="background.secondary"
                                    p={5}
                                    borderRadius="md"
                                    borderWidth="1px"
                                    borderColor="red.500"
                                >
                                    <Heading size="sm" mb={3} color="red.300">
                                        Last Error
                                    </Heading>
                                    <Code
                                        display="block"
                                        whiteSpace="pre-wrap"
                                        wordBreak="break-all"
                                        p={3}
                                        bg="gray.900"
                                        fontSize="xs"
                                        borderRadius="sm"
                                        maxH="240px"
                                        overflowY="auto"
                                    >
                                        {JSON.stringify(
                                            lastRequest.error,
                                            null,
                                            2,
                                        )}
                                    </Code>
                                </Box>
                            )}

                            {/* Enhanced Prompt */}
                            <Box
                                bg="background.secondary"
                                p={5}
                                borderRadius="md"
                                borderWidth="1px"
                                borderColor="gray.700"
                            >
                                <Heading size="sm" mb={3} color="brand.500">
                                    Enhanced Prompt
                                </Heading>
                                <Code
                                    display="block"
                                    whiteSpace="pre-wrap"
                                    p={3}
                                    bg="gray.900"
                                    fontSize="sm"
                                    borderRadius="sm"
                                    maxH="200px"
                                    overflowY="auto"
                                >
                                    {lastRequest.prompt || "—"}
                                </Code>
                            </Box>

                            {/* Negative Prompt */}
                            <Box
                                bg="background.secondary"
                                p={5}
                                borderRadius="md"
                                borderWidth="1px"
                                borderColor="gray.700"
                            >
                                <Heading size="sm" mb={3} color="brand.500">
                                    Negative Prompt
                                </Heading>
                                <Code
                                    display="block"
                                    whiteSpace="pre-wrap"
                                    p={3}
                                    bg="gray.900"
                                    fontSize="sm"
                                    borderRadius="sm"
                                >
                                    {lastRequest.negativePrompt || "(none)"}
                                </Code>
                            </Box>

                            {/* Request URL */}
                            <Box
                                bg="background.secondary"
                                p={5}
                                borderRadius="md"
                                borderWidth="1px"
                                borderColor="gray.700"
                            >
                                <Heading size="sm" mb={3} color="brand.500">
                                    Request URL
                                </Heading>
                                <Code
                                    display="block"
                                    whiteSpace="pre-wrap"
                                    wordBreak="break-all"
                                    p={3}
                                    bg="gray.900"
                                    fontSize="xs"
                                    borderRadius="sm"
                                    maxH="200px"
                                    overflowY="auto"
                                >
                                    {lastRequest.url || "—"}
                                </Code>
                            </Box>

                            {/* Configuration */}
                            <Box
                                bg="background.secondary"
                                p={5}
                                borderRadius="md"
                                borderWidth="1px"
                                borderColor="gray.700"
                            >
                                <Heading size="sm" mb={3} color="brand.500">
                                    Configuration
                                </Heading>
                                <Code
                                    display="block"
                                    whiteSpace="pre"
                                    p={3}
                                    bg="gray.900"
                                    fontSize="sm"
                                    borderRadius="sm"
                                >
                                    {JSON.stringify(
                                        {
                                            console: consoleId,
                                            spriteSize,
                                            pipelineMode,
                                            downscaleMode: downscaleMode || "auto",
                                            dithering: ditherMode || "none",
                                            outlines,
                                            cleanup,
                                            transparent: transparentBg,
                                            seed: seed || "random",
                                        },
                                        null,
                                        2,
                                    )}
                                </Code>
                            </Box>
                        </VStack>
                    </TabPanel>

                    {/* Explorer Tab */}
                    <TabPanel>
                        <Explorer toast={toast} />
                    </TabPanel>

                    {/* Characters Tab */}
                    <TabPanel>
                        <Characters toast={toast} onRecordPrompt={recordPrompt} />
                    </TabPanel>

                    {/* Tileset Tab */}
                    <TabPanel>
                        <TilesetStudio toast={toast} onRecordPrompt={recordPrompt} />
                    </TabPanel>

                    {/* A/B Test Tab */}
                    <TabPanel>
                        <CompareLab toast={toast} onRecordPrompt={recordPrompt} />
                    </TabPanel>
                </TabPanels>
            </Tabs>

            </Container>
        </Flex>
    );
}

export default App;
