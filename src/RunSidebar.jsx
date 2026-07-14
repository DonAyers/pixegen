/**
 * Always-visible left sidebar: live generation-run tracking ("Runs") and
 * the prompt history ("Prompts", formerly the right-hand drawer).
 *
 * Runs come from src/run-tracker.js (module store — any tab's generation
 * flow registers itself, so the list keeps updating no matter which tab is
 * active). Clicking a run expands an in-sidebar summary: copyable prompt,
 * provider/model, status timeline, request URL, and error detail.
 */

import { useState, useSyncExternalStore } from "react";
import {
    Box,
    Flex,
    Text,
    Badge,
    Button,
    ButtonGroup,
    Checkbox,
    Code,
    IconButton,
    Input,
    Spinner,
    VStack,
} from "@chakra-ui/react";
import { CopyIcon, CheckIcon } from "@chakra-ui/icons";
import {
    subscribeRuns,
    getRunsSnapshot,
    clearRuns,
    RUN_STATUSES,
} from "./run-tracker.js";
import { getSettings, setSetting, subscribeSettings } from "./settings.js";

function useRuns() {
    return useSyncExternalStore(subscribeRuns, getRunsSnapshot);
}

function useAppSettings() {
    return useSyncExternalStore(subscribeSettings, getSettings);
}

const TYPE_LABELS = {
    single: "Sprite",
    sheet: "Sheet",
    tileset: "Tileset",
    "compare-a": "A/B — side A",
    "compare-b": "A/B — side B",
};

function CopyButton({ text, label = "Copy" }) {
    const [copied, setCopied] = useState(false);
    return (
        <IconButton
            size="xs"
            variant="ghost"
            aria-label={label}
            icon={copied ? <CheckIcon /> : <CopyIcon />}
            colorScheme={copied ? "green" : "gray"}
            onClick={(e) => {
                e.stopPropagation();
                navigator.clipboard.writeText(text);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
            }}
        />
    );
}

function formatElapsed(ms) {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}

/** Expanded run summary — everything you'd want for a quick post-mortem. */
function RunDetail({ run }) {
    const duration = (run.endedAt || Date.now()) - run.startedAt;
    return (
        <VStack align="stretch" spacing={2} mt={2} fontSize="xs">
            <Flex align="center" gap={1}>
                <Text color="gray.400" fontWeight="bold">
                    Prompt
                </Text>
                <CopyButton text={run.prompt} label="Copy prompt" />
            </Flex>
            <Code
                p={2}
                borderRadius="sm"
                whiteSpace="pre-wrap"
                wordBreak="break-word"
                fontSize="xs"
                bg="gray.900"
            >
                {run.prompt}
            </Code>

            <Flex gap={2} flexWrap="wrap" color="gray.400">
                <Text>
                    <b>{run.model}</b>
                </Text>
                <Text>{TYPE_LABELS[run.type] || run.type}</Text>
                {run.settings?.consoleId && <Text>{run.settings.consoleId}</Text>}
                {run.settings?.spriteSize && (
                    <Text>{run.settings.spriteSize}</Text>
                )}
                <Text>{formatElapsed(duration)}</Text>
            </Flex>

            <Text color="gray.400" fontWeight="bold">
                Timeline
            </Text>
            <VStack align="stretch" spacing={0.5}>
                {run.events.map((event, i) => (
                    <Flex key={i} gap={2} align="baseline">
                        <Text color="gray.500" minW="52px" textAlign="right">
                            +{formatElapsed(event.ts - run.startedAt)}
                        </Text>
                        <Badge
                            colorScheme={RUN_STATUSES[event.status]?.color || "gray"}
                            fontSize="9px"
                        >
                            {RUN_STATUSES[event.status]?.label || event.status}
                        </Badge>
                        {event.detail && (
                            <Text color="gray.400" noOfLines={1}>
                                {event.detail}
                            </Text>
                        )}
                    </Flex>
                ))}
            </VStack>

            {run.error && (
                <Box
                    border="1px solid"
                    borderColor="red.500"
                    borderRadius="sm"
                    p={2}
                    bg="gray.900"
                >
                    <Text color="red.300" fontWeight="bold" mb={1}>
                        Error
                    </Text>
                    <Text color="red.200" whiteSpace="pre-wrap" wordBreak="break-word">
                        {run.error.message}
                    </Text>
                    {run.error.detail && (
                        <Code
                            display="block"
                            mt={1}
                            p={1}
                            fontSize="10px"
                            whiteSpace="pre-wrap"
                            wordBreak="break-all"
                            bg="gray.800"
                        >
                            {JSON.stringify(run.error.detail, null, 1)}
                        </Code>
                    )}
                </Box>
            )}

            {run.url && (
                <Flex align="center" gap={1}>
                    <Text color="gray.500" noOfLines={1} flex="1" title={run.url}>
                        {run.url}
                    </Text>
                    <CopyButton text={run.url} label="Copy request URL" />
                </Flex>
            )}
        </VStack>
    );
}

function RunItem({ run, isExpanded, onToggle }) {
    const statusInfo = RUN_STATUSES[run.status] || RUN_STATUSES.initiated;
    return (
        <Box
            bg="background.tertiary"
            p={2}
            borderRadius="md"
            border="1px solid"
            borderColor={isExpanded ? "brand.500" : "gray.700"}
            _hover={{ borderColor: "brand.500", cursor: "pointer" }}
            onClick={onToggle}
        >
            <Flex align="center" gap={2}>
                <Text fontSize="sm" fontWeight="bold" whiteSpace="nowrap">
                    Request {run.id}
                </Text>
                <Badge colorScheme={statusInfo.color} display="flex" alignItems="center" gap={1}>
                    {statusInfo.active && <Spinner size="xs" speed="0.8s" />}
                    {statusInfo.label}
                </Badge>
                <Text fontSize="10px" color="gray.500" noOfLines={1} flex="1" textAlign="right">
                    {run.model?.split(":").pop() || ""}
                </Text>
            </Flex>
            {run.statusDetail && statusInfo.active && (
                <Text fontSize="10px" color="gray.400" mt={0.5} noOfLines={1}>
                    {run.statusDetail}
                </Text>
            )}
            {!isExpanded && (
                <Text fontSize="xs" color="gray.400" noOfLines={1} mt={0.5}>
                    {run.prompt}
                </Text>
            )}
            {isExpanded && <RunDetail run={run} />}
        </Box>
    );
}

function PromptItem({ item, onUse }) {
    return (
        <Box
            position="relative"
            bg="background.tertiary"
            p={2}
            borderRadius="md"
            border="1px solid"
            borderColor="gray.700"
            _hover={{ borderColor: "brand.500", cursor: "pointer" }}
            onClick={() => onUse(item.text)}
        >
            <Flex justifyContent="space-between" alignItems="center" mb={1} pr={7}>
                <Text
                    fontSize="9px"
                    fontWeight="bold"
                    color={item.type === "random" ? "purple.300" : "blue.300"}
                    textTransform="uppercase"
                >
                    {item.type}
                </Text>
                <Text fontSize="9px" color="gray.500">
                    {new Date(item.timestamp).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                    })}
                </Text>
            </Flex>
            <Text
                fontSize="xs"
                pr="26px"
                color="gray.200"
                wordBreak="break-word"
                whiteSpace="pre-wrap"
            >
                {item.text}
            </Text>
            <Box position="absolute" top={1} right={1}>
                <CopyButton text={item.text} label="Copy prompt" />
            </Box>
        </Box>
    );
}

export default function RunSidebar({
    promptHistory,
    onUsePrompt,
    onClearPrompts,
    view, // "runs" | "prompts" | "settings" — lifted so the header gear can open Settings
    onViewChange,
}) {
    const runs = useRuns();
    const settings = useAppSettings();
    const [search, setSearch] = useState("");
    const [promptFilter, setPromptFilter] = useState("all");
    const [expandedRun, setExpandedRun] = useState(null);

    const filteredRuns = runs.filter(
        (run) =>
            !search ||
            run.prompt?.toLowerCase().includes(search.toLowerCase()) ||
            String(run.id) === search.trim(),
    );
    const filteredPrompts = promptHistory.filter((item) => {
        const matchesSearch = item.text
            .toLowerCase()
            .includes(search.toLowerCase());
        const matchesFilter =
            promptFilter === "all" || item.type === promptFilter;
        return matchesSearch && matchesFilter;
    });

    return (
        <Box
            as="aside"
            w={{ base: "250px", xl: "320px" }}
            flexShrink={0}
            h="100vh"
            position="sticky"
            top="0"
            borderRight="1px solid"
            borderColor="gray.700"
            bg="background.secondary"
            display="flex"
            flexDirection="column"
            p={3}
            gap={3}
        >
            <ButtonGroup size="xs" isAttached variant="outline" colorScheme="brand" width="100%">
                <Button
                    flex="1"
                    onClick={() => onViewChange("runs")}
                    variant={view === "runs" ? "solid" : "outline"}
                >
                    Runs
                </Button>
                <Button
                    flex="1"
                    onClick={() => onViewChange("prompts")}
                    variant={view === "prompts" ? "solid" : "outline"}
                >
                    Prompts
                </Button>
                <Button
                    flex="1"
                    onClick={() => onViewChange("settings")}
                    variant={view === "settings" ? "solid" : "outline"}
                >
                    Settings
                </Button>
            </ButtonGroup>

            {view !== "settings" && (
                <Input
                    placeholder={view === "runs" ? "Search runs..." : "Search history..."}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    bg="background.tertiary"
                    borderColor="gray.600"
                    size="sm"
                />
            )}

            {view === "prompts" && (
                <ButtonGroup size="xs" isAttached variant="outline" colorScheme="brand" width="100%">
                    {[
                        ["all", "All"],
                        ["random", "Random"],
                        ["user", "User"],
                    ].map(([value, label]) => (
                        <Button
                            key={value}
                            flex="1"
                            onClick={() => setPromptFilter(value)}
                            variant={promptFilter === value ? "solid" : "outline"}
                        >
                            {label}
                        </Button>
                    ))}
                </ButtonGroup>
            )}

            <VStack align="stretch" spacing={2} overflowY="auto" flex="1" pr={1}>
                {view === "settings" ? (
                    <VStack align="stretch" spacing={4} pt={1}>
                        <Box>
                            <Checkbox
                                size="sm"
                                isChecked={settings.freeTier}
                                onChange={(e) =>
                                    setSetting("freeTier", e.target.checked)
                                }
                            >
                                <Text fontSize="sm">
                                    Use free tier when available
                                </Text>
                            </Checkbox>
                            <Text fontSize="xs" color="gray.500" mt={1} pl={6}>
                                Checked: requests go keyless on Pollinations'
                                free tier (no pollen spent; slower, may
                                queue) and fall back to your API key if the
                                free tier rejects them. Unchecked: always use
                                the API key — paid-tier priority, faster.
                            </Text>
                        </Box>
                        <Box>
                            <Checkbox
                                size="sm"
                                isChecked={settings.parallelBatches}
                                onChange={(e) =>
                                    setSetting(
                                        "parallelBatches",
                                        e.target.checked,
                                    )
                                }
                            >
                                <Text fontSize="sm">
                                    Parallel batch requests
                                </Text>
                            </Checkbox>
                            <Text fontSize="xs" color="gray.500" mt={1} pl={6}>
                                Sprite sheets and tile grids that need
                                multiple AI requests fire them all at once
                                instead of one after another. Faster,
                                especially when the provider is congested.
                            </Text>
                        </Box>
                        <Box>
                            <Checkbox
                                size="sm"
                                isChecked={settings.failoverEnabled}
                                onChange={(e) =>
                                    setSetting(
                                        "failoverEnabled",
                                        e.target.checked,
                                    )
                                }
                            >
                                <Text fontSize="sm">
                                    Fail over slow requests
                                </Text>
                            </Checkbox>
                            <Text fontSize="xs" color="gray.500" mt={1} pl={6}>
                                If a Pollinations request takes longer than
                                the threshold, abort it and retry on the
                                next fast free model (flux → klein →
                                zimage). The run tracker records any
                                substitution. Only applies to Pollinations
                                models.
                            </Text>
                            {settings.failoverEnabled && (
                                <Flex align="center" gap={2} mt={2} pl={6}>
                                    <Text fontSize="xs" color="gray.400">
                                        Threshold (seconds):
                                    </Text>
                                    <Input
                                        size="xs"
                                        width="64px"
                                        type="number"
                                        min={10}
                                        value={settings.failoverSeconds}
                                        onChange={(e) => {
                                            const v = parseInt(
                                                e.target.value,
                                                10,
                                            );
                                            if (!Number.isNaN(v)) {
                                                setSetting(
                                                    "failoverSeconds",
                                                    Math.max(10, v),
                                                );
                                            }
                                        }}
                                        bg="background.tertiary"
                                        borderColor="gray.600"
                                    />
                                </Flex>
                            )}
                        </Box>
                    </VStack>
                ) : view === "runs" ? (
                    filteredRuns.length === 0 ? (
                        <Text fontSize="xs" color="gray.500" textAlign="center" py={8}>
                            No generation runs yet — every request from any
                            tab shows up here.
                        </Text>
                    ) : (
                        filteredRuns.map((run) => (
                            <RunItem
                                key={run.id}
                                run={run}
                                isExpanded={expandedRun === run.id}
                                onToggle={() =>
                                    setExpandedRun(
                                        expandedRun === run.id ? null : run.id,
                                    )
                                }
                            />
                        ))
                    )
                ) : filteredPrompts.length === 0 ? (
                    <Text fontSize="xs" color="gray.500" textAlign="center" py={8}>
                        No prompts found
                    </Text>
                ) : (
                    filteredPrompts.map((item) => (
                        <PromptItem key={item.id} item={item} onUse={onUsePrompt} />
                    ))
                )}
            </VStack>

            {view !== "settings" && (
                <Box borderTop="1px solid" borderColor="gray.700" pt={2}>
                    <Button
                        size="xs"
                        variant="outline"
                        colorScheme="red"
                        width="100%"
                        onClick={() => {
                            if (
                                window.confirm(
                                    view === "runs"
                                        ? "Clear finished runs from the list?"
                                        : "Are you sure you want to clear your prompt history?",
                                )
                            ) {
                                if (view === "runs") clearRuns();
                                else onClearPrompts();
                            }
                        }}
                    >
                        {view === "runs" ? "Clear finished runs" : "Clear History"}
                    </Button>
                </Box>
            )}
        </Box>
    );
}
