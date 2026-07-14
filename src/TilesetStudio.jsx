/**
 * Tileset Studio
 *
 * Generates a whole M×N grid of tileset tiles in as few AI requests as
 * possible (batched the same way the Generator tab's "Generate All Frames"
 * batches animation frames), assigns each tile a role from tile-roles.js,
 * and saves the result to Dexie's `tiles` table.
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
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
    Input,
    NumberInput,
    NumberInputField,
    Select,
    Text,
    VStack,
} from "@chakra-ui/react";
import {
    generateTileGrid,
    DEFAULT_NEGATIVE_PROMPT,
    estimateBatchCount,
    lastRequest,
} from "./image-service.js";
import { startRun } from "./run-tracker.js";
import {
    processTileGrid,
    renderPixelArt,
    DITHER_OPTIONS,
    PREPROCESSING_PRESETS,
} from "./pixel-processor.js";
import {
    PALETTE_PROFILES,
    SPRITE_SCALES,
    DEFAULT_PROFILE,
} from "./palettes.js";
import { modelSupportsTransparent } from "./provider-service.js";
import { fetchImageModels, initModels, DEFAULT_MODELS, DEFAULT_MODEL_ID } from "./model-service.js";
import { TILE_ROLES, DEFAULT_ROLE, getRoleHint, getRolesByCategory } from "./tile-roles.js";
import { saveAllTiles } from "./sprite-storage.js";
import { randomPromptIdea } from "./core/prompt-ideas.js";

const MIN_GRID = 1;
const MAX_GRID = 8;

function buildDefaultRoleGrid(cols, rows) {
    const roleIds = Object.keys(TILE_ROLES);
    const grid = [];
    for (let i = 0; i < cols * rows; i++) {
        grid.push(roleIds[i % roleIds.length] || DEFAULT_ROLE);
    }
    return grid;
}

export function TilesetStudio({ toast, onRecordPrompt }) {
    const [prompt, setPrompt] = useState("");
    const [consoleId, setConsoleId] = useState(DEFAULT_PROFILE);
    const [spriteSize, setSpriteSize] = useState("");
    const [modelId, setModelId] = useState(DEFAULT_MODEL_ID);
    const [models, setModels] = useState(DEFAULT_MODELS);
    const [pipelineMode, setPipelineMode] = useState("enhanced");
    const [ditherMode, setDitherMode] = useState("");
    const [ditherOptions, setDitherOptions] = useState(DITHER_OPTIONS.enhanced);
    const [outlines, setOutlines] = useState(true);
    const [cleanup, setCleanup] = useState(true);
    const [transparentBg, setTransparentBg] = useState(false);
    const [preprocessingMode, setPreprocessingMode] = useState("standard");
    const [negativePrompt, setNegativePrompt] = useState("");
    const [seed, setSeed] = useState("");

    const [cols, setCols] = useState(4);
    const [rows, setRows] = useState(4);
    const [roleGrid, setRoleGrid] = useState(() => buildDefaultRoleGrid(4, 4));
    const [tilesetName, setTilesetName] = useState("");

    const [isGenerating, setIsGenerating] = useState(false);
    const [tiles, setTiles] = useState([]); // Array<{ canvas, spriteW, spriteH, gridX, gridY, roleId } | null>

    const gridContainerRef = useRef(null);

    useEffect(() => {
        initModels();
        fetchImageModels().then((fetched) => setModels(fetched));
    }, []);

    useEffect(() => {
        const cfg = PALETTE_PROFILES[consoleId];
        if (cfg) setSpriteSize(cfg.defaultScale);
    }, [consoleId]);

    useEffect(() => {
        const options = DITHER_OPTIONS[pipelineMode] || DITHER_OPTIONS.enhanced;
        setDitherOptions(options);
        if (!options.some((o) => o.value === ditherMode)) {
            setDitherMode("");
        }
    }, [pipelineMode, ditherMode]);

    // Resize the role grid (preserving existing assignments) when cols/rows change.
    useEffect(() => {
        setRoleGrid((prev) => {
            const next = buildDefaultRoleGrid(cols, rows);
            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                    const idx = r * cols + c;
                    if (prev[idx]) next[idx] = prev[idx];
                }
            }
            return next;
        });
        setTiles(new Array(cols * rows).fill(null));
    }, [cols, rows]);

    const setCellRole = useCallback(
        (idx, roleId) => {
            setRoleGrid((prev) => {
                const next = prev.slice();
                next[idx] = roleId;
                return next;
            });
        },
        [],
    );

    const consoleCfg = PALETTE_PROFILES[consoleId];
    const spriteScales = Object.entries(SPRITE_SCALES);
    const selectedModelInfo = models.find((m) => (m.fullId || m.id) === modelId);
    const transparentSupported = modelSupportsTransparent(modelId);
    const totalTiles = cols * rows;
    const batchEstimate = estimateBatchCount(totalTiles);

    const handleGenerate = async () => {
        if (!prompt.trim()) {
            toast({
                title: "Please enter a theme/style description",
                status: "error",
                duration: 3000,
            });
            return;
        }

        onRecordPrompt?.(prompt, "user");

        const dithering = ditherMode || null;
        const negPrompt = negativePrompt.trim();
        const seedVal = seed ? parseInt(seed, 10) : undefined;
        const tileHints = roleGrid.map((roleId) => getRoleHint(roleId));
        const run = startRun({
            prompt: prompt.trim(),
            model: modelId,
            type: "tileset",
            tab: "tileset",
            settings: { consoleId, spriteSize, pipeline: pipelineMode },
        });

        try {
            setIsGenerating(true);

            toast({
                title:
                    batchEstimate > 1
                        ? `Generating ${totalTiles} tiles in ${batchEstimate} batches...`
                        : `Generating ${totalTiles}-tile grid...`,
                status: "info",
                duration: 2000,
            });

            const gridResult = await generateTileGrid(prompt, {
                model: modelId,
                cols,
                rows,
                tileHints,
                seed: seedVal,
                transparent: transparentBg,
                negativePrompt: negPrompt || DEFAULT_NEGATIVE_PROMPT,
                consoleName: consoleCfg.name,
                onStage: (stage, detail) => run.update(stage, detail),
            });
            run.setUrl(lastRequest.url);

            const firstImg = gridResult.batches[0]?.img;
            const groupId = crypto.randomUUID
                ? crypto.randomUUID()
                : `${Date.now()}-${Math.random()}`;

            run.update("processing", `slicing ${totalTiles} tiles`);
            toast({
                title: `Slicing ${totalTiles} tiles...`,
                status: "info",
                duration: 2000,
            });

            await new Promise((r) => setTimeout(r, 50));

            const preprocessingOptions =
                PREPROCESSING_PRESETS[preprocessingMode] ||
                PREPROCESSING_PRESETS.none;

            const { tiles: processedTiles } = await processTileGrid(gridResult, {
                consoleId,
                spriteSize,
                dithering,
                pipeline: pipelineMode,
                outlines,
                cleanup,
                preprocessing: preprocessingOptions,
            });

            const renderedTiles = processedTiles.map((tile, idx) => {
                if (!tile) return null;
                const canvas = document.createElement("canvas");
                renderPixelArt(canvas, tile.pixelData, tile.spriteW, tile.spriteH, {
                    showGrid: false,
                });
                return {
                    canvas,
                    pixelData: tile.pixelData,
                    spriteW: tile.spriteW,
                    spriteH: tile.spriteH,
                    gridX: tile.gridX,
                    gridY: tile.gridY,
                    roleId: roleGrid[idx],
                };
            });

            setTiles(renderedTiles);

            run.update("saving");
            try {
                await saveAllTiles(renderedTiles, {
                    tilesetName: tilesetName.trim() || "untitled",
                    consoleId,
                    prompt: prompt.trim(),
                    model: modelId,
                    sourceBlob: firstImg?._sourceBlob,
                    generationGroupId: groupId,
                    size: spriteSize,
                    pipeline: pipelineMode,
                    dither: ditherMode,
                });
            } catch (saveErr) {
                console.error("Auto-save tileset failed:", saveErr);
            }

            run.complete(`${totalTiles} tiles`);
            toast({
                title: `Done! ${totalTiles}-tile tileset`,
                description: `${processedTiles[0]?.spriteW}×${processedTiles[0]?.spriteH} ${consoleCfg.name} tiles, ${batchEstimate} request${batchEstimate === 1 ? "" : "s"}`,
                status: "success",
                duration: 3000,
            });
        } catch (err) {
            console.error("Tileset generation failed:", err);
            run.fail({ message: err.message, detail: lastRequest.error });
            toast({
                title: "Tileset generation failed",
                description: err.message,
                status: "error",
                duration: 5000,
            });
        } finally {
            setIsGenerating(false);
        }
    };

    return (
        <VStack align="stretch" spacing={6}>
            <Box>
                <Heading size="md" mb={1} color="brand.500">
                    Tileset Studio
                </Heading>
                <Text fontSize="sm" color="gray.400">
                    Generate a whole grid of terrain/prop tiles in as few AI
                    requests as possible, with a shared palette and style.
                </Text>
            </Box>

            <FormControl>
                <FormLabel fontSize="sm" color="gray.400">
                    Describe your tileset theme:
                </FormLabel>
                <HStack>
                    <Input
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        placeholder="e.g. a sunny grassland village, a haunted swamp..."
                        bg="background.secondary"
                        borderColor="gray.600"
                    />
                    <Button
                        onClick={() => {
                            const idea = randomPromptIdea(consoleId, "tileset");
                            setPrompt(idea);
                            onRecordPrompt?.(idea, "random");
                        }}
                        aria-label="Random tileset idea"
                        title="Random theme inspired by classics of the selected system"
                        px={3}
                        flexShrink={0}
                    >
                        🎲
                    </Button>
                </HStack>
            </FormControl>

            <Flex gap={4} flexWrap="wrap">
                <FormControl maxW="200px">
                    <FormLabel fontSize="xs" color="gray.400">
                        System:
                    </FormLabel>
                    <Select
                        value={consoleId}
                        onChange={(e) => setConsoleId(e.target.value)}
                        bg="background.secondary"
                        borderColor="gray.600"
                        size="sm"
                    >
                        {Object.entries(PALETTE_PROFILES).map(([id, cfg]) => (
                            <option key={id} value={id}>
                                {cfg.name}
                            </option>
                        ))}
                    </Select>
                </FormControl>

                <FormControl maxW="150px">
                    <FormLabel fontSize="xs" color="gray.400">
                        Tile size:
                    </FormLabel>
                    <Select
                        value={spriteSize}
                        onChange={(e) => setSpriteSize(e.target.value)}
                        bg="background.secondary"
                        borderColor="gray.600"
                        size="sm"
                    >
                        {spriteScales.map(([key, { w, h, label }]) => (
                            <option key={key} value={key}>
                                {label} ({w}×{h})
                            </option>
                        ))}
                    </Select>
                </FormControl>

                <FormControl maxW="220px">
                    <FormLabel fontSize="xs" color="gray.400">
                        AI Model:
                    </FormLabel>
                    <Select
                        value={modelId}
                        onChange={(e) => setModelId(e.target.value)}
                        bg="background.secondary"
                        borderColor="gray.600"
                        size="sm"
                    >
                        {models.map((m) => (
                            <option
                                key={m.fullId || m.id}
                                value={m.fullId || m.id}
                                disabled={
                                    m.available === false ||
                                    m.provider === "openai"
                                }
                                title={
                                    m.provider === "openai"
                                        ? "OpenAI's fixed canvas sizes can't batch tile grids in the browser — use the CLI"
                                        : m.available === false
                                          ? "Provider key not configured"
                                          : `${m.description} (${m.cost})`
                                }
                            >
                                {m.name} — {m.cost}
                                {m.paidOnly ? " 🔑 API key required" : ""}
                                {m.provider === "openai"
                                    ? " (CLI only for tilesets)"
                                    : m.available === false
                                      ? " (key not configured)"
                                      : ""}
                            </option>
                        ))}
                    </Select>
                    {selectedModelInfo && (
                        <Text fontSize="xs" color="gray.500" mt={1}>
                            Est. cost: {batchEstimate} req
                            {batchEstimate === 1 ? "" : "s"} ×{" "}
                            {selectedModelInfo.cost}
                        </Text>
                    )}
                </FormControl>
            </Flex>

            <Flex gap={4} flexWrap="wrap" alignItems="flex-end">
                <FormControl maxW="100px">
                    <FormLabel fontSize="xs" color="gray.400">
                        Columns:
                    </FormLabel>
                    <NumberInput
                        value={cols}
                        onChange={(_, val) =>
                            setCols(
                                Number.isNaN(val)
                                    ? MIN_GRID
                                    : Math.min(MAX_GRID, Math.max(MIN_GRID, val)),
                            )
                        }
                        min={MIN_GRID}
                        max={MAX_GRID}
                        size="sm"
                    >
                        <NumberInputField />
                    </NumberInput>
                </FormControl>

                <FormControl maxW="100px">
                    <FormLabel fontSize="xs" color="gray.400">
                        Rows:
                    </FormLabel>
                    <NumberInput
                        value={rows}
                        onChange={(_, val) =>
                            setRows(
                                Number.isNaN(val)
                                    ? MIN_GRID
                                    : Math.min(MAX_GRID, Math.max(MIN_GRID, val)),
                            )
                        }
                        min={MIN_GRID}
                        max={MAX_GRID}
                        size="sm"
                    >
                        <NumberInputField />
                    </NumberInput>
                </FormControl>

                <FormControl maxW="180px">
                    <FormLabel fontSize="xs" color="gray.400">
                        Pipeline:
                    </FormLabel>
                    <Select
                        value={pipelineMode}
                        onChange={(e) => setPipelineMode(e.target.value)}
                        bg="background.secondary"
                        borderColor="gray.600"
                        size="sm"
                    >
                        <option value="enhanced">Enhanced (OKLAB)</option>
                        <option value="classic">Classic (sRGB)</option>
                    </Select>
                </FormControl>

                <FormControl maxW="180px">
                    <FormLabel fontSize="xs" color="gray.400">
                        Dithering:
                    </FormLabel>
                    <Select
                        value={ditherMode}
                        onChange={(e) => setDitherMode(e.target.value)}
                        bg="background.secondary"
                        borderColor="gray.600"
                        size="sm"
                    >
                        {ditherOptions.map((opt) => (
                            <option key={opt.value} value={opt.value}>
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
                        onChange={(e) => setPreprocessingMode(e.target.value)}
                        bg="background.secondary"
                        borderColor="gray.600"
                        size="sm"
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

                <FormControl maxW="140px">
                    <FormLabel fontSize="xs" color="gray.400">
                        Transparent BG:
                    </FormLabel>
                    <Checkbox
                        isChecked={transparentBg && transparentSupported}
                        isDisabled={!transparentSupported}
                        onChange={(e) => setTransparentBg(e.target.checked)}
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
                        onChange={(e) => setOutlines(e.target.checked)}
                    />
                </FormControl>

                <FormControl maxW="100px">
                    <FormLabel fontSize="xs" color="gray.400">
                        Cleanup:
                    </FormLabel>
                    <Checkbox
                        isChecked={cleanup}
                        onChange={(e) => setCleanup(e.target.checked)}
                    />
                </FormControl>
            </Flex>

            <Flex gap={4} flexWrap="wrap">
                <FormControl flex="1" minW="200px">
                    <FormLabel fontSize="xs" color="gray.400">
                        Avoid:
                    </FormLabel>
                    <Input
                        value={negativePrompt}
                        onChange={(e) => setNegativePrompt(e.target.value)}
                        placeholder={DEFAULT_NEGATIVE_PROMPT}
                        bg="background.secondary"
                        borderColor="gray.600"
                        size="sm"
                    />
                </FormControl>

                <FormControl maxW="150px">
                    <FormLabel fontSize="xs" color="gray.400">
                        Seed:
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
                            size="sm"
                        />
                    </NumberInput>
                </FormControl>
            </Flex>

            {/* Per-tile role grid */}
            <Box>
                <FormLabel fontSize="sm" color="gray.400">
                    Tile roles ({cols}×{rows} grid):
                </FormLabel>
                <Box
                    bg="background.tertiary"
                    border="1px solid"
                    borderColor="gray.700"
                    borderRadius="md"
                    p={2}
                    overflowX="auto"
                >
                    <Grid
                        templateColumns={`repeat(${cols}, minmax(140px, 1fr))`}
                        gap={2}
                    >
                        {roleGrid.map((roleId, idx) => (
                            <GridItem key={idx}>
                                <Select
                                    value={roleId}
                                    onChange={(e) =>
                                        setCellRole(idx, e.target.value)
                                    }
                                    bg="background.secondary"
                                    borderColor="gray.600"
                                    size="xs"
                                >
                                    {getRolesByCategory().map((group) => (
                                        <optgroup
                                            key={group.category}
                                            label={group.label}
                                        >
                                            {group.roles.map((role) => (
                                                <option
                                                    key={role.id}
                                                    value={role.id}
                                                >
                                                    {role.name}
                                                </option>
                                            ))}
                                        </optgroup>
                                    ))}
                                </Select>
                            </GridItem>
                        ))}
                    </Grid>
                </Box>
            </Box>

            <Flex gap={3} flexWrap="wrap" alignItems="flex-end">
                <FormControl maxW="200px">
                    <FormLabel fontSize="xs" color="gray.400">
                        Tileset name:
                    </FormLabel>
                    <Input
                        value={tilesetName}
                        onChange={(e) => setTilesetName(e.target.value)}
                        placeholder="e.g. village, dungeon..."
                        bg="background.secondary"
                        borderColor="gray.600"
                        size="sm"
                    />
                </FormControl>

                <Button
                    onClick={handleGenerate}
                    isLoading={isGenerating}
                    loadingText="Generating..."
                    colorScheme="purple"
                    size="md"
                >
                    Generate Tileset
                </Button>
            </Flex>

            {/* Tile grid preview */}
            <Box>
                <FormLabel fontSize="sm" color="gray.400">
                    Tiles:
                </FormLabel>
                <Box
                    bg="background.tertiary"
                    border="1px solid"
                    borderColor="gray.700"
                    borderRadius="md"
                    p={2}
                    minH="80px"
                    overflowX="auto"
                    ref={gridContainerRef}
                >
                    <Grid
                        templateColumns={`repeat(${cols}, 48px)`}
                        gap={1}
                        display="inline-grid"
                    >
                        {tiles.map((tile, idx) => (
                            <Box
                                key={idx}
                                w="48px"
                                h="48px"
                                border="1px solid"
                                borderColor="gray.700"
                                borderRadius="sm"
                                bg="background.secondary"
                                opacity={tile ? 1 : 0.3}
                                borderStyle={tile ? "solid" : "dashed"}
                            >
                                {tile && (
                                    <canvas
                                        width={48}
                                        height={48}
                                        ref={(canvas) => {
                                            if (canvas && tile) {
                                                const ctx = canvas.getContext("2d");
                                                ctx.imageSmoothingEnabled = false;
                                                ctx.drawImage(
                                                    tile.canvas,
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
                                            imageRendering: "pixelated",
                                        }}
                                    />
                                )}
                            </Box>
                        ))}
                    </Grid>
                </Box>
            </Box>
        </VStack>
    );
}
