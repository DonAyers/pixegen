/**
 * AnimationPreview — shared animation playback component.
 *
 * Wraps the AnimationPlayer class (canvas playback engine) with the standard
 * transport UI: play/pause/stop, frame stepping, FPS, optional ping-pong and
 * onion-skin toggles, a frame counter, and an optional clickable thumbnail
 * strip. Used by the Generator tab, the Explorer, and the Characters tab so
 * any set of frames — fresh or loaded from storage — plays the same way
 * everywhere.
 *
 * Frames are plain `{ canvas, spriteW, spriteH }` objects (nulls tolerated),
 * the same shape AnimationPlayer consumes and sprite-storage hydrates.
 */

import React, { useEffect, useRef, useState, useCallback } from "react";
import {
    Box,
    Button,
    ButtonGroup,
    Checkbox,
    Flex,
    FormControl,
    FormLabel,
    HStack,
    IconButton,
    Image,
    NumberInput,
    NumberInputField,
    Text,
} from "@chakra-ui/react";
import { ChevronLeftIcon, ChevronRightIcon } from "@chakra-ui/icons";
import { AnimationPlayer } from "./animation-player.js";

export function AnimationPreview({
    frames = [],
    defaultFps = 8,
    maxFps = 60,
    onFpsChange,
    loop = true,
    showSteps = true,
    showPingPong = false,
    showOnionSkin = false,
    showStrip = false,
    onFrameChange,
    label = "Animation Preview:",
    emptyText = "No frames yet.",
}) {
    const canvasRef = useRef(null);
    const playerRef = useRef(null);

    const [isPlaying, setIsPlaying] = useState(false);
    const [currentFrame, setCurrentFrame] = useState(0);
    const [fps, setFps] = useState(defaultFps);
    const [pingPong, setPingPong] = useState(false);
    const [onionSkin, setOnionSkin] = useState(false);

    const filled = frames.filter(Boolean);
    const hasFrames = filled.length > 0;
    const canAnimate = filled.length > 1;

    // Keep the latest callback in a ref so the player wiring stays stable.
    const frameChangeRef = useRef(onFrameChange);
    frameChangeRef.current = onFrameChange;

    useEffect(() => {
        if (canvasRef.current && !playerRef.current) {
            playerRef.current = new AnimationPlayer(canvasRef.current, {
                fps: defaultFps,
                loop,
            });
            playerRef.current.onFrameChange = (idx) => {
                setCurrentFrame(idx);
                frameChangeRef.current?.(idx);
            };
        }
        return () => {
            playerRef.current?.pause();
            playerRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Load frames into the player whenever the frame set changes.
    useEffect(() => {
        const player = playerRef.current;
        if (!player) return;
        player.stop();
        setIsPlaying(false);
        player.setFrames(frames);
        setCurrentFrame(0);
        frameChangeRef.current?.(0);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [frames]);

    useEffect(() => {
        if (playerRef.current) playerRef.current.fps = fps;
    }, [fps]);

    useEffect(() => {
        if (playerRef.current) playerRef.current.pingPong = pingPong;
    }, [pingPong]);

    useEffect(() => {
        if (playerRef.current) {
            playerRef.current.onionSkinOpacity = onionSkin ? 0.25 : 0;
        }
    }, [onionSkin]);

    const handlePlayPause = useCallback(() => {
        if (!playerRef.current) return;
        setIsPlaying(playerRef.current.toggle());
    }, []);

    const handleStop = useCallback(() => {
        if (!playerRef.current) return;
        playerRef.current.stop();
        setIsPlaying(false);
    }, []);

    const handleStep = useCallback((dir) => {
        if (!playerRef.current) return;
        if (dir === 1) playerRef.current.stepForward();
        else playerRef.current.stepBackward();
        setIsPlaying(false);
    }, []);

    const handleSeek = useCallback((idx) => {
        if (!playerRef.current) return;
        playerRef.current.seek(idx);
        setIsPlaying(false);
    }, []);

    const handleFps = (val) => {
        const parsed = parseInt(val, 10) || defaultFps;
        setFps(parsed);
        onFpsChange?.(parsed);
    };

    return (
        <Box>
            <Flex
                justify="space-between"
                align="center"
                mb={2}
                flexWrap="wrap"
                gap={2}
            >
                <FormLabel fontSize="sm" color="gray.400" mb={0}>
                    {label}
                </FormLabel>
                {canAnimate && (
                    <HStack spacing={2} flexWrap="wrap">
                        <ButtonGroup size="sm" isAttached>
                            <Button
                                onClick={handlePlayPause}
                                aria-label={isPlaying ? "Pause" : "Play"}
                            >
                                {isPlaying ? "⏸" : "▶"}
                            </Button>
                            <Button onClick={handleStop} aria-label="Stop">
                                ⏹
                            </Button>
                            {showSteps && (
                                <>
                                    <IconButton
                                        icon={<ChevronLeftIcon />}
                                        onClick={() => handleStep(-1)}
                                        aria-label="Previous frame"
                                    />
                                    <IconButton
                                        icon={<ChevronRightIcon />}
                                        onClick={() => handleStep(1)}
                                        aria-label="Next frame"
                                    />
                                </>
                            )}
                        </ButtonGroup>

                        <HStack>
                            <FormLabel fontSize="xs" color="gray.400" mb={0}>
                                FPS:
                            </FormLabel>
                            <NumberInput
                                value={fps}
                                onChange={handleFps}
                                min={1}
                                max={maxFps}
                                maxW="60px"
                                size="sm"
                            >
                                <NumberInputField aria-label="Playback FPS" />
                            </NumberInput>
                        </HStack>

                        {showPingPong && (
                            <FormControl maxW="110px">
                                <HStack>
                                    <FormLabel
                                        fontSize="xs"
                                        color="gray.400"
                                        mb={0}
                                    >
                                        Ping-pong:
                                    </FormLabel>
                                    <Checkbox
                                        isChecked={pingPong}
                                        onChange={(e) =>
                                            setPingPong(e.target.checked)
                                        }
                                        size="sm"
                                    />
                                </HStack>
                            </FormControl>
                        )}

                        {showOnionSkin && (
                            <FormControl maxW="110px">
                                <HStack>
                                    <FormLabel
                                        fontSize="xs"
                                        color="gray.400"
                                        mb={0}
                                    >
                                        Onion skin:
                                    </FormLabel>
                                    <Checkbox
                                        isChecked={onionSkin}
                                        onChange={(e) =>
                                            setOnionSkin(e.target.checked)
                                        }
                                        size="sm"
                                    />
                                </HStack>
                            </FormControl>
                        )}

                        <Text
                            fontSize="xs"
                            color="gray.500"
                            minW="60px"
                            textAlign="center"
                        >
                            {currentFrame + 1} / {filled.length}
                        </Text>
                    </HStack>
                )}
            </Flex>

            <Box
                bg="background.tertiary"
                border="1px solid"
                borderColor="gray.700"
                borderRadius="md"
                minH="140px"
                maxH="280px"
                display="flex"
                alignItems="center"
                justifyContent="center"
                overflow="hidden"
            >
                <canvas
                    ref={canvasRef}
                    style={{
                        imageRendering: "pixelated",
                        display: hasFrames ? "block" : "none",
                    }}
                />
                {!hasFrames && (
                    <Text color="gray.600" fontSize="sm">
                        {emptyText}
                    </Text>
                )}
            </Box>

            {showStrip && hasFrames && (
                <Box mt={3}>
                    <Text fontSize="sm" color="gray.400" mb={2}>
                        Frames:
                    </Text>
                    <HStack spacing={2} overflowX="auto" p={1}>
                        {filled.map((frame, i) => (
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
                                onClick={() => handleSeek(i)}
                            >
                                {frame.canvas && (
                                    <Image
                                        src={frame.canvas.toDataURL(
                                            "image/png",
                                        )}
                                        alt={`Frame ${i + 1}`}
                                        w="full"
                                        h="full"
                                        objectFit="contain"
                                        imageRendering="pixelated"
                                    />
                                )}
                            </Box>
                        ))}
                    </HStack>
                </Box>
            )}
        </Box>
    );
}
