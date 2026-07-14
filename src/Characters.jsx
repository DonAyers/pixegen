/**
 * Characters tab
 *
 * The persistent layer above individual generations: a Character is a locked
 * prompt subject (description + style notes) plus preferred settings
 * (palette, scale, model, base seed) and a canonical reference image. Every
 * animation generated from here reuses that identical scaffold, so one
 * character accumulates a consistent set of animations (idle, walk, attack…)
 * that can be browsed and played in place.
 *
 * Consistency mechanics (in order of strength):
 *   1. Locked description/styleNotes → identical prompt subject every run.
 *   2. Base seed reused for every animation of the character.
 *   3. When the chosen model accepts reference images (maxReferenceImages >
 *      0), the character's reference generation URL is sent as `image=`
 *      conditioning — the browser counterpart of the Node cohesion chain.
 */

import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
    Badge,
    Box,
    Button,
    Flex,
    FormControl,
    FormLabel,
    Grid,
    GridItem,
    Heading,
    HStack,
    IconButton,
    Image as ChakraImage,
    Input,
    NumberInput,
    NumberInputField,
    Select,
    Text,
    Textarea,
    VStack,
    Wrap,
    WrapItem,
} from "@chakra-ui/react";
import { DeleteIcon } from "@chakra-ui/icons";
import { AnimationPreview } from "./AnimationPreview.jsx";
import {
    generateImage,
    generateSpriteSheet,
    lastRequest,
} from "./image-service.js";
import {
    processImage,
    processSpriteSheet,
    renderPixelArt,
    PREPROCESSING_PRESETS,
} from "./pixel-processor.js";
import { PALETTE_PROFILES, SPRITE_SCALES } from "./palettes.js";
import {
    ANIMATION_STATES,
    VIEWS,
    DEFAULT_VIEW,
    getStatesByCategory,
    buildPoseDescription,
} from "./animation-states.js";
import {
    fetchImageModels,
    initModels,
    DEFAULT_MODELS,
    DEFAULT_MODEL_ID,
} from "./model-service.js";
import {
    createCharacter,
    updateCharacter,
    listCharacterEntities,
    deleteCharacterEntity,
    adoptSpritesByName,
    listCharacterAnimations,
    loadCharacterFrames,
    deleteCharacterFrames,
    saveAllFrames,
} from "./sprite-storage.js";
import { getModelInfo } from "./core/models.js";
import { startRun } from "./run-tracker.js";
import { randomPromptIdea } from "./core/prompt-ideas.js";
import {
    buildPackedSheet,
    emitSheetMetadata,
    EXPORT_FORMATS,
    exportSheetAsPng,
    downloadFile,
} from "./sprite-sheet.js";

function formatDate(date) {
    return date ? new Date(date).toLocaleString() : "";
}

export function Characters({ toast, onRecordPrompt }) {
    // Character list + selection
    const [characters, setCharacters] = useState([]);
    const [selectedId, setSelectedId] = useState(null);
    const [draft, setDraft] = useState(null);

    // Create form
    const [newName, setNewName] = useState("");
    const [newDescription, setNewDescription] = useState("");

    // Animations of the selected character
    const [combos, setCombos] = useState([]);
    const [selectedCombo, setSelectedCombo] = useState(null);
    const [comboFrames, setComboFrames] = useState([]);

    // Generation
    const [genAnim, setGenAnim] = useState("walk");
    const [genView, setGenView] = useState(DEFAULT_VIEW);
    const [isGenerating, setIsGenerating] = useState(false);

    // Export
    const [exportFormat, setExportFormat] = useState("aseprite");
    const [isExporting, setIsExporting] = useState(false);

    const [models, setModels] = useState(DEFAULT_MODELS);
    const [refThumbUrl, setRefThumbUrl] = useState(null);

    const character = useMemo(
        () => characters.find((c) => c.id === selectedId) || null,
        [characters, selectedId],
    );

    useEffect(() => {
        initModels();
        fetchImageModels().then((fetched) => setModels(fetched));
    }, []);

    const loadCharacters = useCallback(async () => {
        try {
            const rows = await listCharacterEntities();
            setCharacters(rows);
        } catch (err) {
            console.error("Character list failed:", err);
            toast({
                title: "Failed to load characters",
                description: err.message,
                status: "error",
                duration: 5000,
            });
        }
    }, [toast]);

    useEffect(() => {
        loadCharacters();
    }, [loadCharacters]);

    // Reset the editable draft + animations when the selection changes.
    useEffect(() => {
        setDraft(character ? { ...character } : null);
        setSelectedCombo(null);
        setComboFrames([]);
        if (character) {
            listCharacterAnimations(character.id).then(setCombos);
        } else {
            setCombos([]);
        }
    }, [character]);

    // Reference image thumbnail (object URL lifecycle).
    useEffect(() => {
        if (!character?.refImageBlob) {
            setRefThumbUrl(null);
            return;
        }
        const url = URL.createObjectURL(character.refImageBlob);
        setRefThumbUrl(url);
        return () => URL.revokeObjectURL(url);
    }, [character]);

    const refreshCombos = useCallback(async (characterId) => {
        setCombos(await listCharacterAnimations(characterId));
    }, []);

    const setDraftField = (patch) =>
        setDraft((prev) => (prev ? { ...prev, ...patch } : prev));

    const modelInfo = draft
        ? getModelInfo(draft.modelId || DEFAULT_MODEL_ID)
        : null;
    const refCapable = (modelInfo?.maxReferenceImages ?? 0) > 0;

    // ── Create / save / delete ──────────────────────────────────────────

    const handleCreate = async () => {
        const name = newName.trim();
        const description = newDescription.trim();
        if (!name || !description) {
            toast({
                title: "Name and description required",
                description:
                    "The description becomes the locked prompt subject for every animation.",
                status: "error",
                duration: 4000,
            });
            return;
        }
        try {
            const consoleId = "nes";
            const id = await createCharacter({
                name,
                description,
                consoleId,
                size: PALETTE_PROFILES[consoleId].defaultScale,
                modelId: DEFAULT_MODEL_ID,
            });
            // Link any frames previously saved under this name in the
            // Generator tab.
            const adopted = await adoptSpritesByName(id, name);
            setNewName("");
            setNewDescription("");
            await loadCharacters();
            setSelectedId(id);
            toast({
                title: `Character "${name}" created`,
                description: adopted
                    ? `${adopted} previously saved frame(s) linked to it`
                    : undefined,
                status: "success",
                duration: 3000,
            });
        } catch (err) {
            toast({
                title: "Create failed",
                description: err.message,
                status: "error",
                duration: 5000,
            });
        }
    };

    const persistDraft = useCallback(async () => {
        if (!draft || !selectedId) return;
        const { id, createdAt, updatedAt, ...fields } = draft;
        await updateCharacter(selectedId, fields);
        await loadCharacters();
    }, [draft, selectedId, loadCharacters]);

    const handleSaveDraft = async () => {
        try {
            await persistDraft();
            toast({ title: "Character saved", status: "success", duration: 2000 });
        } catch (err) {
            toast({
                title: "Save failed",
                description: err.message,
                status: "error",
                duration: 5000,
            });
        }
    };

    const handleDeleteCharacter = async (row) => {
        try {
            const deleted = await deleteCharacterEntity(row.id, {
                deleteSprites: false,
            });
            if (selectedId === row.id) setSelectedId(null);
            await loadCharacters();
            toast({
                title: `Deleted "${row.name}"`,
                description: `Saved frames were kept (${deleted} removed). They remain visible in the Explorer.`,
                status: "success",
                duration: 3000,
            });
        } catch (err) {
            toast({
                title: "Delete failed",
                description: err.message,
                status: "error",
                duration: 5000,
            });
        }
    };

    const handleClearReference = async () => {
        if (!selectedId) return;
        await updateCharacter(selectedId, {
            refImageUrl: "",
            refImageBlob: undefined,
        });
        await loadCharacters();
        toast({ title: "Reference cleared", status: "info", duration: 2000 });
    };

    // ── Animation browsing ──────────────────────────────────────────────

    const handleSelectCombo = useCallback(
        async (combo) => {
            if (!character) return;
            setSelectedCombo(combo);
            try {
                const frames = await loadCharacterFrames(
                    character.id,
                    combo.animState,
                    combo.view,
                );
                setComboFrames(
                    frames.map((f) => ({
                        canvas: f.canvas,
                        spriteW: f.spriteW,
                        spriteH: f.spriteH,
                        meta: f.meta,
                    })),
                );
            } catch (err) {
                console.error("Failed to load animation:", err);
                setComboFrames([]);
            }
        },
        [character],
    );

    const handleDeleteCombo = async (combo) => {
        if (!character) return;
        try {
            const count = await deleteCharacterFrames(
                character.id,
                combo.animState,
                combo.view,
            );
            if (
                selectedCombo?.animState === combo.animState &&
                selectedCombo?.view === combo.view
            ) {
                setSelectedCombo(null);
                setComboFrames([]);
            }
            await refreshCombos(character.id);
            toast({
                title: `Deleted ${combo.animState}/${combo.view}`,
                description: `${count} frame(s) removed`,
                status: "success",
                duration: 3000,
            });
        } catch (err) {
            toast({
                title: "Delete failed",
                description: err.message,
                status: "error",
                duration: 5000,
            });
        }
    };

    // Promote a saved animation's source generation to the character's
    // reference image (frame 0's raw AI image + its upstream URL).
    const handleUseAsReference = async () => {
        const first = comboFrames[0]?.meta;
        if (!selectedId || !first?.sourceBlob) {
            toast({
                title: "No source image on these frames",
                description:
                    "Older saves may not carry the raw AI image; regenerate to capture one.",
                status: "warning",
                duration: 4000,
            });
            return;
        }
        await updateCharacter(selectedId, {
            refImageBlob: first.sourceBlob,
            refImageUrl: first.sourceUrl || "",
        });
        await loadCharacters();
        toast({
            title: "Reference updated",
            status: "success",
            duration: 2000,
        });
    };

    // ── Generation ──────────────────────────────────────────────────────

    const handleGenerateAnimation = async () => {
        if (!draft || !selectedId) return;
        const anim = ANIMATION_STATES[genAnim];
        const viewObj = VIEWS[genView];
        if (!anim || !viewObj) return;

        // Persist any edits first so the generation always matches what the
        // user sees in the properties panel.
        try {
            await persistDraft();
        } catch (err) {
            toast({
                title: "Could not save character before generating",
                description: err.message,
                status: "error",
                duration: 5000,
            });
            return;
        }

        const profile =
            PALETTE_PROFILES[draft.consoleId] || PALETTE_PROFILES.nes;
        const consoleName = profile.quantizeMode === "none" ? "" : profile.name;
        const modelId = draft.modelId || DEFAULT_MODEL_ID;
        const seed = draft.baseSeed;
        const referenceImages =
            refCapable && draft.refImageUrl ? [draft.refImageUrl] : [];

        onRecordPrompt?.(draft.description, "user");

        const run = startRun({
            prompt: draft.description,
            model: modelId,
            type: anim.frameCount > 1 ? "sheet" : "single",
            tab: "characters",
            settings: {
                consoleId: draft.consoleId,
                spriteSize: draft.size,
                pipeline: "enhanced",
            },
        });

        const processOptions = {
            consoleId: draft.consoleId,
            spriteSize: draft.size,
            dithering: null,
            pipeline: "enhanced",
            outlines: true,
            cleanup: true,
            preprocessing: PREPROCESSING_PRESETS.standard,
        };

        try {
            setIsGenerating(true);
            toast({
                title: `Generating ${anim.name} (${anim.frameCount} frame${anim.frameCount === 1 ? "" : "s"})...`,
                status: "info",
                duration: 2000,
            });

            let processedFrames;
            let sourceImg;

            if (anim.frameCount > 1) {
                const sheetResult = await generateSpriteSheet(
                    draft.description,
                    {
                        model: modelId,
                        frameCount: anim.frameCount,
                        seed,
                        consoleName,
                        viewDesc: viewObj.promptDesc,
                        animDesc: anim.promptDesc,
                        frameHints: anim.frameHints,
                        styleNotes: draft.styleNotes || "",
                        referenceImages,
                        onStage: (stage, detail) => run.update(stage, detail),
                    },
                );
                run.setUrl(lastRequest.url);
                sourceImg = sheetResult.batches[0]?.img;

                run.update("processing");
                const { frames } = await processSpriteSheet(
                    sheetResult,
                    processOptions,
                );
                processedFrames = frames;
            } else {
                const img = await generateImage(draft.description, {
                    model: modelId,
                    seed,
                    consoleName,
                    poseDesc: buildPoseDescription(genAnim, genView, 0),
                    styleNotes: draft.styleNotes || "",
                    referenceImages,
                    onStage: (stage, detail) => run.update(stage, detail),
                });
                run.setUrl(lastRequest.url);
                sourceImg = img;

                run.update("processing");
                processedFrames = [await processImage(img, processOptions)];
            }

            // Render + persist every frame under this character.
            run.update("saving");
            const generationGroupId = crypto.randomUUID
                ? crypto.randomUUID()
                : `${Date.now()}-${Math.random()}`;
            const saveMeta = {
                characterId: selectedId,
                characterName: draft.name,
                consoleId: draft.consoleId,
                animState: genAnim,
                view: genView,
                prompt: draft.description,
                model: modelId,
                sourceBlob: sourceImg?._sourceBlob,
                sourceUrl: sourceImg?._upstreamUrl || "",
                generationGroupId,
                size: draft.size,
                pipeline: "enhanced",
                dither: "",
                seed,
            };

            const renderedFrames = processedFrames
                .filter(Boolean)
                .map(({ pixelData, spriteW, spriteH }) => {
                    const canvas = document.createElement("canvas");
                    renderPixelArt(canvas, pixelData, spriteW, spriteH, {
                        showGrid: false,
                    });
                    return { canvas, pixelData, spriteW, spriteH };
                });

            await saveAllFrames(renderedFrames, saveMeta);

            // First successful generation becomes the reference anchor
            // (only when none is set yet).
            if (!draft.refImageUrl && sourceImg?._upstreamUrl) {
                await updateCharacter(selectedId, {
                    refImageUrl: sourceImg._upstreamUrl,
                    refImageBlob: sourceImg._sourceBlob,
                });
            }

            await loadCharacters();
            await refreshCombos(selectedId);
            await handleSelectCombo({ animState: genAnim, view: genView });

            run.complete(`${renderedFrames.length} frames`);
            toast({
                title: `Done! ${anim.name} for "${draft.name}"`,
                description: `${renderedFrames.length} frame(s), seed ${seed}${referenceImages.length ? ", reference-conditioned" : ""}`,
                status: "success",
                duration: 3000,
            });
        } catch (err) {
            console.error("Character generation failed:", err);
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
    };

    // ── Export ──────────────────────────────────────────────────────────
    //
    // One PNG with every animation packed (one row each) + one metadata
    // file in the chosen engine format.
    const handleExportCharacter = async () => {
        if (!character || combos.length === 0) {
            toast({
                title: "Nothing to export",
                description: "Generate at least one animation first.",
                status: "error",
                duration: 3000,
            });
            return;
        }
        try {
            setIsExporting(true);
            const animations = [];
            for (const combo of combos) {
                const frames = await loadCharacterFrames(
                    character.id,
                    combo.animState,
                    combo.view,
                );
                if (frames.length === 0) continue;
                animations.push({
                    name: `${combo.animState}_${combo.view.replace(/[^a-z0-9]+/gi, "-")}`,
                    fps: 8,
                    loop: ANIMATION_STATES[combo.animState]?.loop ?? true,
                    frames,
                });
            }
            if (animations.length === 0) {
                throw new Error("No frames could be loaded for this character");
            }

            const slug = character.name
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-|-$/g, "") || "character";
            const pngName = `${slug}.png`;
            const { canvas, model } = buildPackedSheet(animations, {
                imageName: pngName,
            });
            const { content, ext } = emitSheetMetadata(exportFormat, model);

            const pngBlob = await exportSheetAsPng(canvas);
            downloadFile(pngBlob, pngName);
            downloadFile(
                new Blob([content], { type: "application/octet-stream" }),
                `${slug}${ext}`,
            );

            toast({
                title: "Exported!",
                description: `${pngName} + ${slug}${ext} (${animations.length} animation${animations.length === 1 ? "" : "s"}, ${model.frames.length} frames)`,
                status: "success",
                duration: 4000,
            });
        } catch (err) {
            console.error("Character export failed:", err);
            toast({
                title: "Export failed",
                description: err.message,
                status: "error",
                duration: 5000,
            });
        } finally {
            setIsExporting(false);
        }
    };

    // ── Render ──────────────────────────────────────────────────────────

    const spriteScales = Object.entries(SPRITE_SCALES);
    const stateCategories = getStatesByCategory();
    const playerFrames = useMemo(
        () =>
            comboFrames.map((f) => ({
                canvas: f.canvas,
                spriteW: f.spriteW,
                spriteH: f.spriteH,
            })),
        [comboFrames],
    );

    return (
        <VStack align="stretch" spacing={6}>
            <Flex justify="space-between" align="center" flexWrap="wrap" gap={3}>
                <Box>
                    <Heading size="md" mb={1} color="brand.500">
                        Characters
                    </Heading>
                    <Text fontSize="sm" color="gray.400">
                        A character locks its description, seed, and reference
                        image so every animation you generate stays consistent.
                    </Text>
                </Box>
                <Button size="sm" variant="outline" onClick={loadCharacters}>
                    Refresh
                </Button>
            </Flex>

            <Grid
                templateColumns={{ base: "1fr", md: "320px 1fr" }}
                gap={6}
                alignItems="start"
            >
                {/* Left: create + list */}
                <GridItem>
                    <VStack align="stretch" spacing={4}>
                        <Box
                            bg="background.secondary"
                            border="1px solid"
                            borderColor="gray.700"
                            borderRadius="md"
                            p={4}
                        >
                            <Heading size="xs" color="brand.500" mb={3}>
                                New Character
                            </Heading>
                            <FormControl mb={2}>
                                <FormLabel fontSize="xs" color="gray.400">
                                    Name:
                                </FormLabel>
                                <Input
                                    size="sm"
                                    value={newName}
                                    onChange={(e) => setNewName(e.target.value)}
                                    placeholder="e.g. Sir Bramble"
                                    bg="background.tertiary"
                                    borderColor="gray.600"
                                />
                            </FormControl>
                            <FormControl mb={3}>
                                <FormLabel fontSize="xs" color="gray.400">
                                    Description (locked prompt subject):
                                </FormLabel>
                                <Textarea
                                    size="sm"
                                    rows={3}
                                    value={newDescription}
                                    onChange={(e) =>
                                        setNewDescription(e.target.value)
                                    }
                                    placeholder="e.g. a knight in mossy green armor with a thorned sword"
                                    bg="background.tertiary"
                                    borderColor="gray.600"
                                />
                            </FormControl>
                            <HStack>
                                <Button
                                    size="sm"
                                    colorScheme="brand"
                                    onClick={handleCreate}
                                >
                                    Create Character
                                </Button>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    title="Random idea"
                                    onClick={() =>
                                        setNewDescription(
                                            randomPromptIdea("nes"),
                                        )
                                    }
                                >
                                    🎲
                                </Button>
                            </HStack>
                        </Box>

                        <Box
                            bg="background.secondary"
                            border="1px solid"
                            borderColor="gray.700"
                            borderRadius="md"
                            maxH="420px"
                            overflowY="auto"
                        >
                            {characters.length === 0 ? (
                                <Box p={4}>
                                    <Text color="gray.500" fontSize="sm">
                                        No characters yet — create one above.
                                    </Text>
                                </Box>
                            ) : (
                                characters.map((row) => {
                                    const active = row.id === selectedId;
                                    return (
                                        <Flex
                                            key={row.id}
                                            p={3}
                                            borderBottom="1px solid"
                                            borderColor="gray.700"
                                            bg={
                                                active
                                                    ? "brand.900"
                                                    : "transparent"
                                            }
                                            cursor="pointer"
                                            onClick={() =>
                                                setSelectedId(row.id)
                                            }
                                            justify="space-between"
                                            align="center"
                                            _hover={{
                                                bg: active
                                                    ? "brand.900"
                                                    : "gray.800",
                                            }}
                                        >
                                            <Box flex="1" minW={0} mr={2}>
                                                <Text
                                                    fontWeight="bold"
                                                    fontSize="sm"
                                                    noOfLines={1}
                                                >
                                                    {row.name}
                                                </Text>
                                                <Text
                                                    fontSize="xs"
                                                    color="gray.500"
                                                    noOfLines={1}
                                                >
                                                    {row.description}
                                                </Text>
                                                <Text
                                                    fontSize="xs"
                                                    color="gray.600"
                                                >
                                                    {formatDate(row.updatedAt)}
                                                </Text>
                                            </Box>
                                            <IconButton
                                                icon={<DeleteIcon />}
                                                size="xs"
                                                variant="ghost"
                                                colorScheme="red"
                                                aria-label="Delete character"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleDeleteCharacter(row);
                                                }}
                                            />
                                        </Flex>
                                    );
                                })
                            )}
                        </Box>
                    </VStack>
                </GridItem>

                {/* Right: detail */}
                <GridItem>
                    {!draft ? (
                        <Box
                            bg="background.secondary"
                            border="1px solid"
                            borderColor="gray.700"
                            borderRadius="md"
                            p={6}
                            minH="280px"
                            display="flex"
                            alignItems="center"
                            justifyContent="center"
                        >
                            <Text color="gray.500" fontSize="sm">
                                Select or create a character to manage its
                                animations.
                            </Text>
                        </Box>
                    ) : (
                        <VStack align="stretch" spacing={4}>
                            {/* Properties */}
                            <Box
                                bg="background.secondary"
                                border="1px solid"
                                borderColor="gray.700"
                                borderRadius="md"
                                p={4}
                            >
                                <Flex
                                    justify="space-between"
                                    align="center"
                                    mb={3}
                                >
                                    <Heading size="sm" color="brand.500">
                                        {draft.name}
                                    </Heading>
                                    <Button
                                        size="xs"
                                        variant="outline"
                                        onClick={handleSaveDraft}
                                    >
                                        Save Changes
                                    </Button>
                                </Flex>
                                <Grid
                                    templateColumns={{
                                        base: "1fr",
                                        lg: "repeat(2, 1fr)",
                                    }}
                                    gap={3}
                                >
                                    <FormControl>
                                        <FormLabel
                                            fontSize="xs"
                                            color="gray.400"
                                        >
                                            Name:
                                        </FormLabel>
                                        <Input
                                            size="sm"
                                            value={draft.name}
                                            onChange={(e) =>
                                                setDraftField({
                                                    name: e.target.value,
                                                })
                                            }
                                            bg="background.tertiary"
                                            borderColor="gray.600"
                                        />
                                    </FormControl>
                                    <FormControl>
                                        <FormLabel
                                            fontSize="xs"
                                            color="gray.400"
                                        >
                                            Base seed (reused for all
                                            animations):
                                        </FormLabel>
                                        <NumberInput
                                            size="sm"
                                            value={draft.baseSeed ?? 0}
                                            onChange={(val) =>
                                                setDraftField({
                                                    baseSeed:
                                                        parseInt(val, 10) || 0,
                                                })
                                            }
                                        >
                                            <NumberInputField
                                                bg="background.tertiary"
                                                borderColor="gray.600"
                                            />
                                        </NumberInput>
                                    </FormControl>
                                    <FormControl gridColumn={{ lg: "1 / -1" }}>
                                        <FormLabel
                                            fontSize="xs"
                                            color="gray.400"
                                        >
                                            Description (locked prompt
                                            subject):
                                        </FormLabel>
                                        <Textarea
                                            size="sm"
                                            rows={2}
                                            value={draft.description}
                                            onChange={(e) =>
                                                setDraftField({
                                                    description:
                                                        e.target.value,
                                                })
                                            }
                                            bg="background.tertiary"
                                            borderColor="gray.600"
                                        />
                                    </FormControl>
                                    <FormControl gridColumn={{ lg: "1 / -1" }}>
                                        <FormLabel
                                            fontSize="xs"
                                            color="gray.400"
                                        >
                                            Style notes (optional, appended to
                                            the style section):
                                        </FormLabel>
                                        <Input
                                            size="sm"
                                            value={draft.styleNotes || ""}
                                            onChange={(e) =>
                                                setDraftField({
                                                    styleNotes: e.target.value,
                                                })
                                            }
                                            placeholder="e.g. big head proportions, teal and gold palette"
                                            bg="background.tertiary"
                                            borderColor="gray.600"
                                        />
                                    </FormControl>
                                    <FormControl>
                                        <FormLabel
                                            fontSize="xs"
                                            color="gray.400"
                                        >
                                            System / palette:
                                        </FormLabel>
                                        <Select
                                            size="sm"
                                            value={draft.consoleId}
                                            onChange={(e) =>
                                                setDraftField({
                                                    consoleId: e.target.value,
                                                })
                                            }
                                            bg="background.tertiary"
                                            borderColor="gray.600"
                                        >
                                            {Object.entries(
                                                PALETTE_PROFILES,
                                            ).map(([id, p]) => (
                                                <option key={id} value={id}>
                                                    {p.name}
                                                </option>
                                            ))}
                                        </Select>
                                    </FormControl>
                                    <FormControl>
                                        <FormLabel
                                            fontSize="xs"
                                            color="gray.400"
                                        >
                                            Sprite scale:
                                        </FormLabel>
                                        <Select
                                            size="sm"
                                            value={draft.size}
                                            onChange={(e) =>
                                                setDraftField({
                                                    size: e.target.value,
                                                })
                                            }
                                            bg="background.tertiary"
                                            borderColor="gray.600"
                                        >
                                            {spriteScales.map(
                                                ([key, scale]) => (
                                                    <option
                                                        key={key}
                                                        value={key}
                                                    >
                                                        {key} — {scale.label}
                                                    </option>
                                                ),
                                            )}
                                        </Select>
                                    </FormControl>
                                    <FormControl>
                                        <FormLabel
                                            fontSize="xs"
                                            color="gray.400"
                                        >
                                            Model:
                                        </FormLabel>
                                        <Select
                                            size="sm"
                                            value={
                                                draft.modelId ||
                                                DEFAULT_MODEL_ID
                                            }
                                            onChange={(e) =>
                                                setDraftField({
                                                    modelId: e.target.value,
                                                })
                                            }
                                            bg="background.tertiary"
                                            borderColor="gray.600"
                                        >
                                            {models.map((m) => (
                                                <option
                                                    key={m.fullId || m.id}
                                                    value={m.fullId || m.id}
                                                    disabled={
                                                        m.available === false
                                                    }
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
                                </Grid>
                                <Text fontSize="xs" color="gray.500" mt={2}>
                                    {refCapable
                                        ? "This model accepts reference images — the character's reference is attached automatically for stronger consistency."
                                        : "This model ignores reference images; consistency relies on the locked description and seed. Models marked with reference support (e.g. gptimage, klein, nanobanana) hold identity better across animations."}
                                </Text>
                            </Box>

                            {/* Reference image */}
                            <Box
                                bg="background.secondary"
                                border="1px solid"
                                borderColor="gray.700"
                                borderRadius="md"
                                p={4}
                            >
                                <Flex
                                    justify="space-between"
                                    align="center"
                                    mb={2}
                                >
                                    <Heading size="xs" color="brand.500">
                                        Reference image
                                    </Heading>
                                    {character?.refImageUrl && (
                                        <Button
                                            size="xs"
                                            variant="outline"
                                            onClick={handleClearReference}
                                        >
                                            Clear
                                        </Button>
                                    )}
                                </Flex>
                                <HStack align="start" spacing={4}>
                                    <Box
                                        w="96px"
                                        h="96px"
                                        border="1px solid"
                                        borderColor="gray.700"
                                        borderRadius="sm"
                                        bg="background.tertiary"
                                        display="flex"
                                        alignItems="center"
                                        justifyContent="center"
                                        overflow="hidden"
                                        flexShrink={0}
                                    >
                                        {refThumbUrl ? (
                                            <ChakraImage
                                                src={refThumbUrl}
                                                alt="Character reference"
                                                w="full"
                                                h="full"
                                                objectFit="contain"
                                            />
                                        ) : (
                                            <Text
                                                fontSize="xs"
                                                color="gray.600"
                                                textAlign="center"
                                                px={1}
                                            >
                                                none yet
                                            </Text>
                                        )}
                                    </Box>
                                    <Text fontSize="xs" color="gray.500">
                                        The first generated animation anchors
                                        the character automatically. To change
                                        it, select an animation below and use
                                        “Use as reference”.
                                    </Text>
                                </HStack>
                            </Box>

                            {/* Generate */}
                            <Box
                                bg="background.secondary"
                                border="1px solid"
                                borderColor="gray.700"
                                borderRadius="md"
                                p={4}
                            >
                                <Heading size="xs" color="brand.500" mb={3}>
                                    Generate animation
                                </Heading>
                                <Flex gap={3} flexWrap="wrap" align="flex-end">
                                    <FormControl maxW="220px">
                                        <FormLabel
                                            fontSize="xs"
                                            color="gray.400"
                                        >
                                            Animation:
                                        </FormLabel>
                                        <Select
                                            size="sm"
                                            value={genAnim}
                                            onChange={(e) =>
                                                setGenAnim(e.target.value)
                                            }
                                            bg="background.tertiary"
                                            borderColor="gray.600"
                                        >
                                            {stateCategories.map((cat) => (
                                                <optgroup
                                                    key={cat.category}
                                                    label={cat.label}
                                                >
                                                    {cat.states.map((s) => (
                                                        <option
                                                            key={s.id}
                                                            value={s.id}
                                                        >
                                                            {s.name} (
                                                            {s.frameCount}f)
                                                        </option>
                                                    ))}
                                                </optgroup>
                                            ))}
                                        </Select>
                                    </FormControl>
                                    <FormControl maxW="180px">
                                        <FormLabel
                                            fontSize="xs"
                                            color="gray.400"
                                        >
                                            View:
                                        </FormLabel>
                                        <Select
                                            size="sm"
                                            value={genView}
                                            onChange={(e) =>
                                                setGenView(e.target.value)
                                            }
                                            bg="background.tertiary"
                                            borderColor="gray.600"
                                        >
                                            {Object.values(VIEWS).map((v) => (
                                                <option key={v.id} value={v.id}>
                                                    {v.name}
                                                </option>
                                            ))}
                                        </Select>
                                    </FormControl>
                                    <Button
                                        size="sm"
                                        colorScheme="brand"
                                        onClick={handleGenerateAnimation}
                                        isLoading={isGenerating}
                                        loadingText="Generating..."
                                    >
                                        Generate
                                    </Button>
                                </Flex>
                            </Box>

                            {/* Animations */}
                            <Box
                                bg="background.secondary"
                                border="1px solid"
                                borderColor="gray.700"
                                borderRadius="md"
                                p={4}
                            >
                                <Flex
                                    justify="space-between"
                                    align="center"
                                    mb={3}
                                    flexWrap="wrap"
                                    gap={2}
                                >
                                    <Heading size="xs" color="brand.500">
                                        Animations
                                    </Heading>
                                    <HStack>
                                        <Select
                                            size="xs"
                                            maxW="220px"
                                            value={exportFormat}
                                            onChange={(e) =>
                                                setExportFormat(e.target.value)
                                            }
                                            bg="background.tertiary"
                                            borderColor="gray.600"
                                            aria-label="Export format"
                                        >
                                            {Object.values(EXPORT_FORMATS).map(
                                                (f) => (
                                                    <option
                                                        key={f.id}
                                                        value={f.id}
                                                    >
                                                        {f.label}
                                                    </option>
                                                ),
                                            )}
                                        </Select>
                                        <Button
                                            size="xs"
                                            variant="outline"
                                            colorScheme="brand"
                                            onClick={handleExportCharacter}
                                            isLoading={isExporting}
                                            isDisabled={combos.length === 0}
                                        >
                                            Export Character
                                        </Button>
                                    </HStack>
                                </Flex>
                                {combos.length === 0 ? (
                                    <Text fontSize="sm" color="gray.500">
                                        Nothing generated for this character
                                        yet.
                                    </Text>
                                ) : (
                                    <Wrap spacing={2} mb={3}>
                                        {combos.map((combo) => {
                                            const active =
                                                selectedCombo?.animState ===
                                                    combo.animState &&
                                                selectedCombo?.view ===
                                                    combo.view;
                                            const animName =
                                                ANIMATION_STATES[
                                                    combo.animState
                                                ]?.name || combo.animState;
                                            return (
                                                <WrapItem
                                                    key={`${combo.animState}:${combo.view}`}
                                                >
                                                    <HStack
                                                        spacing={1}
                                                        border="1px solid"
                                                        borderColor={
                                                            active
                                                                ? "brand.500"
                                                                : "gray.700"
                                                        }
                                                        borderRadius="md"
                                                        px={2}
                                                        py={1}
                                                        cursor="pointer"
                                                        bg={
                                                            active
                                                                ? "brand.900"
                                                                : "background.tertiary"
                                                        }
                                                        onClick={() =>
                                                            handleSelectCombo(
                                                                combo,
                                                            )
                                                        }
                                                    >
                                                        <Text fontSize="sm">
                                                            {animName}/
                                                            {combo.view}
                                                        </Text>
                                                        <Badge fontSize="10px">
                                                            {combo.frameCount}f
                                                        </Badge>
                                                        <IconButton
                                                            icon={
                                                                <DeleteIcon />
                                                            }
                                                            size="xs"
                                                            variant="ghost"
                                                            colorScheme="red"
                                                            aria-label={`Delete ${animName} ${combo.view}`}
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleDeleteCombo(
                                                                    combo,
                                                                );
                                                            }}
                                                        />
                                                    </HStack>
                                                </WrapItem>
                                            );
                                        })}
                                    </Wrap>
                                )}

                                {selectedCombo && comboFrames.length > 0 && (
                                    <VStack align="stretch" spacing={3}>
                                        <AnimationPreview
                                            frames={playerFrames}
                                            showStrip
                                            label={`${ANIMATION_STATES[selectedCombo.animState]?.name || selectedCombo.animState} / ${selectedCombo.view}`}
                                        />
                                        <HStack>
                                            <Button
                                                size="xs"
                                                variant="outline"
                                                onClick={handleUseAsReference}
                                            >
                                                Use as reference
                                            </Button>
                                        </HStack>
                                    </VStack>
                                )}
                            </Box>
                        </VStack>
                    )}
                </GridItem>
            </Grid>
        </VStack>
    );
}
