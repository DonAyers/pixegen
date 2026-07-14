/**
 * Explorer view
 *
 * Browse every generation saved to IndexedDB. Selecting an item shows the
 * original AI-generated source image alongside the dithered/pixel-art output.
 * Multi-frame items can be played back with the same AnimationPreview
 * component used in the Generator tab.
 */

import React, { useEffect, useState, useCallback, useMemo } from "react";
import {
    Box,
    Button,
    Flex,
    Grid,
    GridItem,
    Heading,
    HStack,
    IconButton,
    Image,
    Spinner,
    Text,
    VStack,
} from "@chakra-ui/react";
import { DeleteIcon } from "@chakra-ui/icons";
import { AnimationPreview } from "./AnimationPreview.jsx";
import {
    listAllSaved,
    getSourceBlob,
    deleteById,
    deleteAllSprites,
    blobToCanvas,
} from "./sprite-storage.js";
import { CONSOLES } from "./palettes.js";
import { ANIMATION_STATES } from "./animation-states.js";

function formatDate(date) {
    if (!date) return "";
    const d = new Date(date);
    return d.toLocaleString();
}

function makeSourceUrl(blob) {
    return blob ? URL.createObjectURL(blob) : null;
}

/**
 * Render a frame's dithered canvas into a display image.
 */
function DitheredPreview({ frame }) {
    const [url, setUrl] = useState(null);

    useEffect(() => {
        if (!frame?.canvas) return;
        const blob = frame.canvas.toBlob ? null : null; // canvas.toBlob is async; use data URL for quick preview
        // Use a data URL so we don't have to manage object URLs for rendered canvases.
        setUrl(frame.canvas.toDataURL("image/png"));
    }, [frame]);

    if (!url) return <Spinner size="sm" />;
    return (
        <Image
            src={url}
            alt="Dithered frame"
            maxH="280px"
            imageRendering="pixelated"
        />
    );
}

export function Explorer({ toast }) {
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedGroup, setSelectedGroup] = useState(null);
    const [currentFrame, setCurrentFrame] = useState(0);
    const [sourceUrls, setSourceUrls] = useState({});

    // Group rows by generationGroupId, falling back to character+anim+view+time.
    const groups = React.useMemo(() => {
        const map = new Map();
        for (const row of items) {
            const key =
                row.generationGroupId ||
                `${row.characterName}|${row.animState}|${row.view}|${new Date(row.createdAt).toISOString()}`;
            if (!map.has(key)) {
                map.set(key, {
                    key,
                    characterName: row.characterName,
                    animState: row.animState,
                    view: row.view,
                    consoleId: row.consoleId,
                    prompt: row.prompt,
                    model: row.model,
                    size: row.size,
                    pipeline: row.pipeline,
                    dither: row.dither,
                    seed: row.seed,
                    createdAt: row.createdAt,
                    frames: [],
                    sourceBlob: row.sourceBlob,
                    firstId: row.id,
                });
            }
            const g = map.get(key);
            g.frames[row.frame] = row;
            // Prefer any row that has a source blob.
            if (row.sourceBlob && !g.sourceBlob) {
                g.sourceBlob = row.sourceBlob;
            }
            if (row.id < g.firstId) g.firstId = row.id;
        }
        return Array.from(map.values()).sort(
            (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
        );
    }, [items]);

    const loadItems = useCallback(async () => {
        setLoading(true);
        try {
            const rows = await listAllSaved();
            setItems(rows);
        } catch (err) {
            console.error("Explorer load failed:", err);
            toast({
                title: "Explorer load failed",
                description: err.message,
                status: "error",
                duration: 5000,
            });
        } finally {
            setLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        loadItems();
    }, [loadItems]);

    // Frame set for the shared AnimationPreview, rebuilt per selection.
    const playerFrames = useMemo(
        () =>
            (selectedGroup?.frames || []).filter(Boolean).map((row) => ({
                canvas: row.canvas,
                spriteW: row.spriteW,
                spriteH: row.spriteH,
            })),
        [selectedGroup],
    );

    // Load source blobs into object URLs
    useEffect(() => {
        const newUrls = {};
        let revoked = false;

        async function loadSources() {
            for (const group of groups) {
                let blob = group.sourceBlob;
                if (!blob && group.firstId) {
                    blob = await getSourceBlob(group.firstId);
                }
                if (blob) {
                    newUrls[group.key] = makeSourceUrl(blob);
                }
            }
            if (!revoked) {
                setSourceUrls((prev) => {
                    // Revoke old URLs that are being replaced
                    for (const key of Object.keys(prev)) {
                        if (newUrls[key] !== prev[key]) {
                            URL.revokeObjectURL(prev[key]);
                        }
                    }
                    return newUrls;
                });
            }
        }

        loadSources();

        return () => {
            revoked = true;
            for (const url of Object.values(newUrls)) {
                if (url) URL.revokeObjectURL(url);
            }
        };
    }, [groups]);

    // Rows come from Dexie with the pixel output as `imageBlob`; the detail
    // view (thumbnails, player) needs drawable canvases, so hydrate them
    // when a group is selected.
    const handleSelectGroup = useCallback(async (group) => {
        try {
            const frames = await Promise.all(
                group.frames.map(async (row) => {
                    if (!row || row.canvas || !row.imageBlob) return row;
                    const canvas = await blobToCanvas(
                        row.imageBlob,
                        row.canvasWidth || row.spriteW,
                        row.canvasHeight || row.spriteH,
                    );
                    return { ...row, canvas };
                }),
            );
            setSelectedGroup({ ...group, frames });
        } catch (err) {
            console.error("Failed to load generation:", err);
            setSelectedGroup(group);
        }
    }, []);

    const handleDeleteGroup = async (group) => {
        try {
            const rows = items.filter(
                (row) =>
                    row.generationGroupId === group.key ||
                    (!row.generationGroupId &&
                        row.characterName === group.characterName &&
                        row.animState === group.animState &&
                        row.view === group.view &&
                        new Date(row.createdAt).toISOString() ===
                            new Date(group.createdAt).toISOString()),
            );
            for (const row of rows) {
                await deleteById(row.id);
            }
            if (selectedGroup?.key === group.key) {
                setSelectedGroup(null);
            }
            await loadItems();
            toast({
                title: "Deleted",
                description: `${rows.length} saved frame(s) removed`,
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

    const handleClearAll = async () => {
        try {
            await deleteAllSprites();
            setSelectedGroup(null);
            await loadItems();
            toast({
                title: "Cleared",
                description: "All saved generations removed",
                status: "success",
                duration: 3000,
            });
        } catch (err) {
            toast({
                title: "Clear failed",
                description: err.message,
                status: "error",
                duration: 5000,
            });
        }
    };

    const selectedFrames = selectedGroup?.frames.filter(Boolean) || [];
    const consoleName = selectedGroup?.consoleId
        ? CONSOLES[selectedGroup.consoleId]?.name || selectedGroup.consoleId
        : "";
    const animName = selectedGroup?.animState
        ? ANIMATION_STATES[selectedGroup.animState]?.name ||
          selectedGroup.animState
        : "";

    return (
        <VStack align="stretch" spacing={6}>
            <Flex
                justify="space-between"
                align="center"
                flexWrap="wrap"
                gap={3}
            >
                <Box>
                    <Heading size="md" mb={1} color="brand.500">
                        Explorer
                    </Heading>
                    <Text fontSize="sm" color="gray.400">
                        Browse every generation saved locally in your browser.
                    </Text>
                </Box>
                <HStack>
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={loadItems}
                        isLoading={loading}
                    >
                        Refresh
                    </Button>
                    <Button
                        size="sm"
                        variant="outline"
                        colorScheme="red"
                        onClick={handleClearAll}
                    >
                        Clear All
                    </Button>
                </HStack>
            </Flex>

            <Grid
                templateColumns={{ base: "1fr", md: "320px 1fr" }}
                gap={6}
                alignItems="start"
            >
                {/* List */}
                <GridItem>
                    <Box
                        bg="background.secondary"
                        border="1px solid"
                        borderColor="gray.700"
                        borderRadius="md"
                        maxH="600px"
                        overflowY="auto"
                    >
                        {groups.length === 0 ? (
                            <Box p={4}>
                                <Text color="gray.500" fontSize="sm">
                                    {loading
                                        ? "Loading saved generations..."
                                        : "No saved generations yet."}
                                </Text>
                            </Box>
                        ) : (
                            groups.map((group) => {
                                const active = selectedGroup?.key === group.key;
                                const frameCount =
                                    group.frames.filter(Boolean).length;
                                return (
                                    <Flex
                                        key={group.key}
                                        p={3}
                                        borderBottom="1px solid"
                                        borderColor="gray.700"
                                        bg={
                                            active ? "brand.900" : "transparent"
                                        }
                                        cursor="pointer"
                                        onClick={() => handleSelectGroup(group)}
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
                                                {group.characterName ||
                                                    "untitled"}
                                            </Text>
                                            <Text
                                                fontSize="xs"
                                                color="gray.500"
                                                noOfLines={1}
                                            >
                                                {animName || group.animState}/
                                                {group.view} · {frameCount}{" "}
                                                frame
                                                {frameCount === 1 ? "" : "s"}
                                            </Text>
                                            <Text
                                                fontSize="xs"
                                                color="gray.600"
                                                noOfLines={1}
                                            >
                                                {formatDate(group.createdAt)}
                                            </Text>
                                        </Box>
                                        <IconButton
                                            icon={<DeleteIcon />}
                                            size="xs"
                                            variant="ghost"
                                            colorScheme="red"
                                            aria-label="Delete generation"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleDeleteGroup(group);
                                            }}
                                        />
                                    </Flex>
                                );
                            })
                        )}
                    </Box>
                </GridItem>

                {/* Detail */}
                <GridItem>
                    {!selectedGroup ? (
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
                                Select a generation from the list to view source
                                and dithered versions.
                            </Text>
                        </Box>
                    ) : (
                        <VStack align="stretch" spacing={4}>
                            <Box>
                                <Heading size="sm" color="brand.500" mb={1}>
                                    {selectedGroup.characterName || "untitled"}
                                </Heading>
                                <Text fontSize="xs" color="gray.400">
                                    {animName}/{selectedGroup.view} ·{" "}
                                    {consoleName} ·{" "}
                                    {selectedGroup.size || "default size"} ·{" "}
                                    {formatDate(selectedGroup.createdAt)}
                                </Text>
                                {selectedGroup.prompt && (
                                    <Text
                                        fontSize="xs"
                                        color="gray.500"
                                        mt={1}
                                        noOfLines={2}
                                    >
                                        Prompt: {selectedGroup.prompt}
                                    </Text>
                                )}
                            </Box>

                            <Grid
                                templateColumns={{
                                    base: "1fr",
                                    lg: "repeat(2, 1fr)",
                                }}
                                gap={4}
                            >
                                <GridItem>
                                    <Text fontSize="sm" color="gray.400" mb={2}>
                                        Source (AI generated):
                                    </Text>
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
                                        {sourceUrls[selectedGroup.key] ? (
                                            <Image
                                                src={
                                                    sourceUrls[
                                                        selectedGroup.key
                                                    ]
                                                }
                                                maxH="280px"
                                                alt="Source generation"
                                            />
                                        ) : (
                                            <Text
                                                color="gray.600"
                                                fontSize="sm"
                                            >
                                                Source image not saved for this
                                                generation.
                                            </Text>
                                        )}
                                    </Box>
                                </GridItem>

                                <GridItem>
                                    <Text fontSize="sm" color="gray.400" mb={2}>
                                        Dithered / pixel art:
                                    </Text>
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
                                        {selectedFrames.length > 0 ? (
                                            <DitheredPreview
                                                frame={
                                                    selectedFrames[
                                                        currentFrame
                                                    ] || selectedFrames[0]
                                                }
                                            />
                                        ) : (
                                            <Text
                                                color="gray.600"
                                                fontSize="sm"
                                            >
                                                No processed frames.
                                            </Text>
                                        )}
                                    </Box>
                                </GridItem>
                            </Grid>

                            {selectedFrames.length > 0 && (
                                <AnimationPreview
                                    frames={playerFrames}
                                    showStrip
                                    onFrameChange={setCurrentFrame}
                                />
                            )}
                        </VStack>
                    )}
                </GridItem>
            </Grid>
        </VStack>
    );
}
