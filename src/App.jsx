import React, { useState, useEffect, useRef, useCallback } from 'react'
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
  Image,
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
} from '@chakra-ui/react'
import { ChevronLeftIcon, ChevronRightIcon } from '@chakra-ui/icons'
import { generateImage, generateSpriteSheet, DEFAULT_NEGATIVE_PROMPT, lastRequest } from './image-service.js'
import { processImage, processSpriteSheet, renderPixelArt, DITHER_OPTIONS, PREPROCESSING_PRESETS } from './pixel-processor.js'
import { CONSOLES, DEFAULT_CONSOLE } from './palettes.js'
import { fetchImageModels, initModels, DEFAULT_MODELS, DEFAULT_MODEL_ID } from './model-service.js'
import {
  ANIMATION_STATES,
  VIEWS,
  DEFAULT_STATE,
  DEFAULT_VIEW,
  buildPoseDescription,
  getStatesByCategory,
} from './animation-states.js'
import { AnimationPlayer } from './animation-player.js'
import { exportSpriteSheet } from './sprite-sheet.js'
import { saveAllFrames, loadFrames, listCharacters, listAnimations } from './sprite-storage.js'

// Initialize multi-provider model service
initModels();

function App() {
  const toast = useToast()
  
  // Form state
  const [prompt, setPrompt] = useState('')
  const [consoleId, setConsoleId] = useState(DEFAULT_CONSOLE)
  const [spriteSize, setSpriteSize] = useState('')
  const [modelId, setModelId] = useState(DEFAULT_MODEL_ID)
  const [pipelineMode, setPipelineMode] = useState('enhanced')
  const [ditherMode, setDitherMode] = useState('')
  const [showGrid, setShowGrid] = useState(false)
  const [transparentBg, setTransparentBg] = useState(false)
  const [outlines, setOutlines] = useState(true)
  const [cleanup, setCleanup] = useState(true)
  const [negativePrompt, setNegativePrompt] = useState('')
  const [seed, setSeed] = useState('')
  const [preprocessingMode, setPreprocessingMode] = useState('standard')
  
  // Animation state
  const [animState, setAnimState] = useState(DEFAULT_STATE)
  const [view, setView] = useState(DEFAULT_VIEW)
  const [currentFrame, setCurrentFrame] = useState(0)
  
  // Player state
  const [fps, setFps] = useState(8)
  const [pingPong, setPingPong] = useState(false)
  const [onionSkin, setOnionSkin] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  
  // Save/load state
  const [charName, setCharName] = useState('')
  
  // UI state
  const [isGenerating, setIsGenerating] = useState(false)
  const [models, setModels] = useState(DEFAULT_MODELS)
  const [sourceImageSrc, setSourceImageSrc] = useState(null)
  const [ditherOptions, setDitherOptions] = useState(DITHER_OPTIONS.enhanced)
  
  // Frame storage
  const frameStore = useRef({})
  const pixelCanvasRef = useRef(null)
  const previewCanvasRef = useRef(null)
  const playerRef = useRef(null)
  
  const getFrameKey = useCallback(() => {
    return `${animState}:${view}`
  }, [animState, view])
  
  const getCurrentFrames = useCallback(() => {
    const key = getFrameKey()
    if (!frameStore.current[key]) {
      const count = ANIMATION_STATES[animState].frameCount
      frameStore.current[key] = new Array(count).fill(null)
    }
    return frameStore.current[key]
  }, [animState, getFrameKey])
  
  const getFrameCount = useCallback(() => {
    return ANIMATION_STATES[animState].frameCount
  }, [animState])
  
  // Initialize player
  useEffect(() => {
    if (previewCanvasRef.current && !playerRef.current) {
      playerRef.current = new AnimationPlayer(previewCanvasRef.current, {
        fps: 8,
        loop: true,
      })
      playerRef.current.onFrameChange = (idx) => {
        // Handle frame change during playback
      }
    }
  }, [])
  
  // Update player FPS
  useEffect(() => {
    if (playerRef.current) {
      playerRef.current.fps = fps
    }
  }, [fps])
  
  // Update player ping pong
  useEffect(() => {
    if (playerRef.current) {
      playerRef.current.pingPong = pingPong
    }
  }, [pingPong])
  
  // Update player onion skin
  useEffect(() => {
    if (playerRef.current) {
      playerRef.current.onionSkinOpacity = onionSkin ? 0.25 : 0
    }
  }, [onionSkin])
  
  // Fetch models on mount
  useEffect(() => {
    fetchImageModels().then((fetchedModels) => {
      setModels(fetchedModels)
    })
  }, [])
  
  // Update sprite sizes when console changes
  useEffect(() => {
    const cfg = CONSOLES[consoleId]
    if (cfg) {
      setSpriteSize(cfg.defaultSize)
    }
  }, [consoleId])
  
  // Update dither options when pipeline changes
  useEffect(() => {
    const options = DITHER_OPTIONS[pipelineMode] || DITHER_OPTIONS.enhanced
    setDitherOptions(options)
    if (!options.some(o => o.value === ditherMode)) {
      setDitherMode('')
    }
  }, [pipelineMode, ditherMode])
  
  // Sync player frames
  const syncPlayerFrames = useCallback(() => {
    const frames = getCurrentFrames()
    const filled = frames.filter(f => f !== null)
    if (playerRef.current) {
      playerRef.current.setFrames(filled)
    }
  }, [getCurrentFrames])
  
  // Handle generate
  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) {
      toast({
        title: 'Please enter a description for your sprite',
        status: 'error',
        duration: 3000,
      })
      return
    }
    
    const consoleCfg = CONSOLES[consoleId]
    const dithering = ditherMode || null
    const model = modelId
    const negPrompt = negativePrompt.trim() || DEFAULT_NEGATIVE_PROMPT
    const seedVal = seed ? parseInt(seed, 10) : undefined
    
    try {
      setIsGenerating(true)
      
      const poseDesc = buildPoseDescription(animState, view, currentFrame)
      
      toast({
        title: `Generating frame ${currentFrame + 1}/${getFrameCount()}...`,
        status: 'info',
        duration: 2000,
      })
      
      const img = await generateImage(prompt, {
        model,
        transparent: transparentBg,
        negativePrompt: negPrompt,
        seed: seedVal !== undefined ? seedVal + currentFrame : undefined,
        consoleName: consoleCfg.name,
        poseDesc,
      })
      
      setSourceImageSrc(img.src)
      
      toast({
        title: `Processing to ${consoleCfg.name} pixel art...`,
        status: 'info',
        duration: 2000,
      })
      
      await new Promise(r => setTimeout(r, 50))
      
      const preprocessingOptions = PREPROCESSING_PRESETS[preprocessingMode] || PREPROCESSING_PRESETS.none
      
      const { pixelData, spriteW, spriteH } = await processImage(img, {
        consoleId,
        spriteSize,
        dithering,
        pipeline: pipelineMode,
        outlines,
        cleanup,
        preprocessing: preprocessingOptions,
      })
      
      if (pixelCanvasRef.current) {
        renderPixelArt(pixelCanvasRef.current, pixelData, spriteW, spriteH, {
          showGrid,
        })
        
        const frameCanvas = document.createElement('canvas')
        frameCanvas.width = pixelCanvasRef.current.width
        frameCanvas.height = pixelCanvasRef.current.height
        frameCanvas.getContext('2d').drawImage(pixelCanvasRef.current, 0, 0)
        
        const frames = getCurrentFrames()
        frames[currentFrame] = { canvas: frameCanvas, pixelData, spriteW, spriteH }
        syncPlayerFrames()
      }
      
      toast({
        title: `Done! Frame ${currentFrame + 1}/${getFrameCount()}`,
        description: `${spriteW}×${spriteH} ${consoleCfg.name} sprite`,
        status: 'success',
        duration: 3000,
      })
    } catch (err) {
      console.error('Generation failed:', err)
      toast({
        title: 'Generation failed',
        description: err.message,
        status: 'error',
        duration: 5000,
      })
    } finally {
      setIsGenerating(false)
    }
  }, [prompt, consoleId, ditherMode, modelId, negativePrompt, seed, animState, view, currentFrame, transparentBg, spriteSize, pipelineMode, outlines, cleanup, showGrid, preprocessingMode, toast, getFrameCount, getCurrentFrames, syncPlayerFrames])
  
  // Handle reprocess
  const handleReprocess = useCallback(async () => {
    if (!sourceImageSrc) return
    
    const consoleCfg = CONSOLES[consoleId]
    const dithering = ditherMode || null
    const preprocessingOptions = PREPROCESSING_PRESETS[preprocessingMode] || PREPROCESSING_PRESETS.none
    
    try {
      const img = new Image()
      img.src = sourceImageSrc
      
      await new Promise((resolve, reject) => {
        img.onload = resolve
        img.onerror = reject
      })
      
      const { pixelData, spriteW, spriteH } = await processImage(img, {
        consoleId,
        spriteSize,
        dithering,
        pipeline: pipelineMode,
        outlines,
        cleanup,
        preprocessing: preprocessingOptions,
      })
      
      if (pixelCanvasRef.current) {
        renderPixelArt(pixelCanvasRef.current, pixelData, spriteW, spriteH, {
          showGrid,
        })
      }
      
      toast({
        title: 'Reprocessed',
        description: `${spriteW}×${spriteH} ${consoleCfg.name} sprite`,
        status: 'success',
        duration: 2000,
      })
    } catch (err) {
      console.error('Reprocessing failed:', err)
      toast({
        title: 'Reprocessing failed',
        description: err.message,
        status: 'error',
        duration: 3000,
      })
    }
  }, [sourceImageSrc, consoleId, spriteSize, ditherMode, pipelineMode, outlines, cleanup, showGrid, preprocessingMode, toast])
  
  // Auto-reprocess when settings change
  useEffect(() => {
    if (sourceImageSrc) {
      handleReprocess()
    }
  }, [consoleId, spriteSize, ditherMode, showGrid, pipelineMode, outlines, cleanup, preprocessingMode, sourceImageSrc, handleReprocess])
  
  // Handle generate all frames
  const handleGenerateAllFrames = async () => {
    if (!prompt.trim()) {
      toast({
        title: 'Please enter a description',
        status: 'error',
        duration: 3000,
      })
      return
    }
    
    const total = getFrameCount()
    
    try {
      setIsGenerating(true)
      
      for (let i = 0; i < total; i++) {
        setCurrentFrame(i)
        await handleGenerate()
      }
      
      setCurrentFrame(0)
      syncPlayerFrames()
      
      toast({
        title: `All ${total} frames generated!`,
        status: 'success',
        duration: 3000,
      })
    } catch (err) {
      console.error('Batch generation failed:', err)
      toast({
        title: 'Batch generation failed',
        description: err.message,
        status: 'error',
        duration: 5000,
      })
    }
  }
  
  // Handle generate sheet
  const handleGenerateSheet = async () => {
    if (!prompt.trim()) {
      toast({
        title: 'Please enter a description',
        status: 'error',
        duration: 3000,
      })
      return
    }
    
    const consoleCfg = CONSOLES[consoleId]
    const dithering = ditherMode || null
    const model = modelId
    const negPrompt = negativePrompt.trim()
    const seedVal = seed ? parseInt(seed, 10) : undefined
    const total = getFrameCount()
    const animStateObj = ANIMATION_STATES[animState]
    const viewObj = VIEWS[view]
    
    try {
      setIsGenerating(true)
      
      toast({
        title: `Generating ${total}-frame sprite sheet...`,
        status: 'info',
        duration: 2000,
      })
      
      const sheetImg = await generateSpriteSheet(prompt, {
        model,
        frameCount: total,
        seed: seedVal,
        transparent: transparentBg,
        negativePrompt: negPrompt,
        consoleName: consoleCfg.name,
        viewDesc: viewObj.promptDesc,
        animDesc: animStateObj.promptDesc,
        frameHints: animStateObj.frameHints,
      })
      
      setSourceImageSrc(sheetImg.src)
      
      toast({
        title: `Slicing ${total} frames...`,
        status: 'info',
        duration: 2000,
      })
      
      await new Promise(r => setTimeout(r, 50))
      
      const preprocessingOptions = PREPROCESSING_PRESETS[preprocessingMode] || PREPROCESSING_PRESETS.none
      
      const { frames: processedFrames } = await processSpriteSheet(sheetImg, total, {
        consoleId,
        spriteSize,
        dithering,
        pipeline: pipelineMode,
        outlines,
        cleanup,
        preprocessing: preprocessingOptions,
      })
      
      const storedFrames = getCurrentFrames()
      for (let i = 0; i < processedFrames.length && i < storedFrames.length; i++) {
        const { pixelData, spriteW, spriteH } = processedFrames[i]
        
        const frameCanvas = document.createElement('canvas')
        renderPixelArt(frameCanvas, pixelData, spriteW, spriteH, { showGrid })
        
        storedFrames[i] = { canvas: frameCanvas, pixelData, spriteW, spriteH }
      }
      
      if (storedFrames[0] && pixelCanvasRef.current) {
        const ctx = pixelCanvasRef.current.getContext('2d')
        pixelCanvasRef.current.width = storedFrames[0].canvas.width
        pixelCanvasRef.current.height = storedFrames[0].canvas.height
        ctx.drawImage(storedFrames[0].canvas, 0, 0)
      }
      
      setCurrentFrame(0)
      syncPlayerFrames()
      
      toast({
        title: `Done! ${total}-frame sprite sheet`,
        description: `${processedFrames[0]?.spriteW}×${processedFrames[0]?.spriteH} ${consoleCfg.name} sprites`,
        status: 'success',
        duration: 3000,
      })
    } catch (err) {
      console.error('Sheet generation failed:', err)
      toast({
        title: 'Sheet generation failed',
        description: err.message,
        status: 'error',
        duration: 5000,
      })
    } finally {
      setIsGenerating(false)
    }
  }
  
  // Handle play/pause
  const handlePlayPause = () => {
    if (playerRef.current) {
      const playing = playerRef.current.toggle()
      setIsPlaying(playing)
    }
  }
  
  // Handle stop
  const handleStop = () => {
    if (playerRef.current) {
      playerRef.current.stop()
      setIsPlaying(false)
    }
  }
  
  // Handle save frames
  const handleSaveFrames = async () => {
    const frames = getCurrentFrames().filter(f => f !== null)
    if (frames.length === 0) {
      toast({
        title: 'No frames to save',
        description: 'Generate some first',
        status: 'error',
        duration: 3000,
      })
      return
    }
    
    const name = charName.trim() || 'untitled'
    
    try {
      await saveAllFrames(getCurrentFrames(), {
        characterName: name,
        consoleId,
        animState,
        view,
        prompt: prompt.trim(),
        model: modelId,
      })
      
      toast({
        title: 'Saved!',
        description: `${frames.length} frames for "${name}" (${animState}/${view})`,
        status: 'success',
        duration: 3000,
      })
    } catch (err) {
      console.error('Save failed:', err)
      toast({
        title: 'Save failed',
        description: err.message,
        status: 'error',
        duration: 5000,
      })
    }
  }
  
  // Handle export sheet
  const handleExportSheet = async () => {
    const frames = getCurrentFrames().filter(f => f !== null)
    if (frames.length === 0) {
      toast({
        title: 'No frames to export',
        description: 'Generate some first',
        status: 'error',
        duration: 3000,
      })
      return
    }
    
    try {
      const name = charName.trim() || 'sprite'
      const consoleCfg = CONSOLES[consoleId]
      const animStateObj = ANIMATION_STATES[animState]
      
      const result = await exportSpriteSheet(frames, {
        characterName: name,
        animName: animState,
        consoleName: consoleId,
        fps,
        loop: animStateObj.loop,
      })
      
      toast({
        title: 'Exported!',
        description: `${result.pngName} + ${result.jsonName} (${frames.length} frames)`,
        status: 'success',
        duration: 3000,
      })
    } catch (err) {
      console.error('Export failed:', err)
      toast({
        title: 'Export failed',
        description: err.message,
        status: 'error',
        duration: 5000,
      })
    }
  }
  
  // Handle load
  const handleLoad = async () => {
    const name = charName.trim()
    if (!name) {
      try {
        const chars = await listCharacters()
        if (chars.length === 0) {
          toast({
            title: 'No saved characters found',
            status: 'info',
            duration: 3000,
          })
        } else {
          toast({
            title: 'Saved characters',
            description: `${chars.join(', ')}. Enter a name and click Load.`,
            status: 'info',
            duration: 5000,
          })
        }
      } catch (err) {
        toast({
          title: 'Load error',
          description: err.message,
          status: 'error',
          duration: 5000,
        })
      }
      return
    }
    
    try {
      const loaded = await loadFrames(name, animState, view)
      
      if (loaded.length === 0) {
        const anims = await listAnimations(name)
        if (anims.length === 0) {
          toast({
            title: `No saved data for "${name}"`,
            status: 'error',
            duration: 3000,
          })
        } else {
          const avail = anims.map(a => `${a.animState}/${a.view} (${a.frameCount}f)`).join(', ')
          toast({
            title: `No ${animState}/${view} for "${name}"`,
            description: `Available: ${avail}`,
            status: 'error',
            duration: 5000,
          })
        }
        return
      }
      
      const frames = getCurrentFrames()
      for (const f of loaded) {
        const idx = f.meta.frame
        if (idx < frames.length) {
          frames[idx] = { canvas: f.canvas, spriteW: f.spriteW, spriteH: f.spriteH }
        }
      }
      
      setCurrentFrame(0)
      syncPlayerFrames()
      
      toast({
        title: 'Loaded!',
        description: `${loaded.length} frames for "${name}" (${animState}/${view})`,
        status: 'success',
        duration: 3000,
      })
    } catch (err) {
      console.error('Load failed:', err)
      toast({
        title: 'Load failed',
        description: err.message,
        status: 'error',
        duration: 5000,
      })
    }
  }
  
  const consoleCfg = CONSOLES[consoleId]
  const spriteSizes = consoleCfg ? Object.entries(consoleCfg.spriteSizes) : []
  
  return (
    <Container maxW="container.lg" py={8}>
      <Heading mb={6} color="brand.500" letterSpacing="wider">
        PixelGen
      </Heading>
      
      <Tabs colorScheme="brand" variant="enclosed" mb={6}>
        <TabList>
          <Tab>Generator</Tab>
          <Tab>Inspector</Tab>
        </TabList>
        
        <TabPanels>
          <TabPanel>
      
      {/* Main Input */}
      <VStack spacing={4} align="stretch" mb={6}>
        <FormControl>
          <FormLabel fontSize="sm" color="gray.400">Describe your sprite:</FormLabel>
          <Input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleGenerate()}
            placeholder="e.g. a knight with a sword, a red dragon, a treasure chest..."
            bg="background.secondary"
            borderColor="gray.600"
          />
        </FormControl>
        
        {/* Controls Row 1 */}
        <Flex gap={4} flexWrap="wrap">
          <FormControl maxW="200px">
            <FormLabel fontSize="xs" color="gray.400">System:</FormLabel>
            <Select
              value={consoleId}
              onChange={(e) => setConsoleId(e.target.value)}
              bg="background.secondary"
              borderColor="gray.600"
              size="sm"
            >
              {Object.entries(CONSOLES).map(([id, cfg]) => (
                <option key={id} value={id}>{cfg.name}</option>
              ))}
            </Select>
          </FormControl>
          
          <FormControl maxW="150px">
            <FormLabel fontSize="xs" color="gray.400">Size:</FormLabel>
            <Select
              value={spriteSize}
              onChange={(e) => setSpriteSize(e.target.value)}
              bg="background.secondary"
              borderColor="gray.600"
              size="sm"
            >
              {spriteSizes.map(([key, { w, h }]) => (
                <option key={key} value={key}>{w}×{h}</option>
              ))}
            </Select>
          </FormControl>
          
          <FormControl maxW="200px">
            <FormLabel fontSize="xs" color="gray.400">AI Model:</FormLabel>
            <Select
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              bg="background.secondary"
              borderColor="gray.600"
              size="sm"
            >
              {(() => {
                // Group models by provider
                const modelsByProvider = {}
                models.forEach(m => {
                  const provider = m.providerName || 'Pollinations'
                  if (!modelsByProvider[provider]) {
                    modelsByProvider[provider] = []
                  }
                  modelsByProvider[provider].push(m)
                })
                
                // Render optgroups
                return Object.entries(modelsByProvider).map(([providerName, providerModels]) => (
                  <optgroup key={providerName} label={providerName}>
                    {providerModels.map((m) => (
                      <option key={m.fullId || m.id} value={m.fullId || m.id} title={`${m.description} (${m.cost})`}>
                        {m.name}
                      </option>
                    ))}
                  </optgroup>
                ))
              })()}
            </Select>
          </FormControl>
        </Flex>
        
        {/* Controls Row 2 */}
        <Flex gap={4} flexWrap="wrap" alignItems="flex-end">
          <FormControl maxW="180px">
            <FormLabel fontSize="xs" color="gray.400">Pipeline:</FormLabel>
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
            <FormLabel fontSize="xs" color="gray.400">Dithering:</FormLabel>
            <Select
              value={ditherMode}
              onChange={(e) => setDitherMode(e.target.value)}
              bg="background.secondary"
              borderColor="gray.600"
              size="sm"
            >
              {ditherOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </Select>
          </FormControl>
          
          <FormControl maxW="180px">
            <FormLabel fontSize="xs" color="gray.400">Preprocessing:</FormLabel>
            <Select
              value={preprocessingMode}
              onChange={(e) => setPreprocessingMode(e.target.value)}
              bg="background.secondary"
              borderColor="gray.600"
              size="sm"
            >
              {Object.entries(PREPROCESSING_PRESETS).map(([key, preset]) => (
                <option key={key} value={key}>{preset.label}</option>
              ))}
            </Select>
          </FormControl>
          
          <FormControl maxW="80px">
            <FormLabel fontSize="xs" color="gray.400">Grid:</FormLabel>
            <Checkbox isChecked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} />
          </FormControl>
          
          <FormControl maxW="120px">
            <FormLabel fontSize="xs" color="gray.400">Transparent BG:</FormLabel>
            <Checkbox isChecked={transparentBg} onChange={(e) => setTransparentBg(e.target.checked)} />
          </FormControl>
          
          <FormControl maxW="100px">
            <FormLabel fontSize="xs" color="gray.400">Outlines:</FormLabel>
            <Checkbox isChecked={outlines} onChange={(e) => setOutlines(e.target.checked)} />
          </FormControl>
          
          <FormControl maxW="100px">
            <FormLabel fontSize="xs" color="gray.400">Cleanup:</FormLabel>
            <Checkbox isChecked={cleanup} onChange={(e) => setCleanup(e.target.checked)} />
          </FormControl>
          
          <Button
            onClick={handleGenerate}
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
            <FormLabel fontSize="xs" color="gray.400">Avoid:</FormLabel>
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
            <FormLabel fontSize="xs" color="gray.400">Seed:</FormLabel>
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
      </VStack>
      
      <Divider my={4} borderColor="gray.700" />
      
      {/* Animation Controls */}
      <Flex gap={4} flexWrap="wrap" alignItems="flex-end" mb={4}>
        <FormControl maxW="200px">
          <FormLabel fontSize="xs" color="gray.400">Animation:</FormLabel>
          <Select
            value={animState}
            onChange={(e) => {
              setAnimState(e.target.value)
              setCurrentFrame(0)
            }}
            bg="background.secondary"
            borderColor="gray.600"
            size="sm"
          >
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
        
        <FormControl maxW="150px">
          <FormLabel fontSize="xs" color="gray.400">View:</FormLabel>
          <Select
            value={view}
            onChange={(e) => {
              setView(e.target.value)
              setCurrentFrame(0)
            }}
            bg="background.secondary"
            borderColor="gray.600"
            size="sm"
          >
            {Object.entries(VIEWS).map(([id, v]) => (
              <option key={id} value={id}>{v.name}</option>
            ))}
          </Select>
        </FormControl>
        
        <FormControl maxW="150px">
          <FormLabel fontSize="xs" color="gray.400">Frame:</FormLabel>
          <HStack>
            <IconButton
              icon={<ChevronLeftIcon />}
              size="sm"
              onClick={() => setCurrentFrame(Math.max(0, currentFrame - 1))}
              isDisabled={currentFrame <= 0}
              aria-label="Previous frame"
            />
            <Text fontSize="sm" minW="50px" textAlign="center">
              {currentFrame + 1} / {getFrameCount()}
            </Text>
            <IconButton
              icon={<ChevronRightIcon />}
              size="sm"
              onClick={() => setCurrentFrame(Math.min(getFrameCount() - 1, currentFrame + 1))}
              isDisabled={currentFrame >= getFrameCount() - 1}
              aria-label="Next frame"
            />
          </HStack>
        </FormControl>
        
        <Button
          onClick={handleGenerateAllFrames}
          isDisabled={isGenerating}
          size="sm"
          variant="outline"
          colorScheme="brand"
        >
          Gen All Frames
        </Button>
        
        <Button
          onClick={handleGenerateSheet}
          isDisabled={isGenerating}
          size="sm"
          variant="outline"
          colorScheme="purple"
        >
          Gen Sheet
        </Button>
      </Flex>
      
      {/* Console Info */}
      {consoleCfg && (
        <Alert status="info" variant="left-accent" mb={4} bg="background.secondary" borderColor="brand.500">
          <AlertIcon />
          <Text fontSize="xs">
            {consoleCfg.fullName} ({consoleCfg.year}) · {consoleCfg.colorDepth} · {consoleCfg.colorsPerSprite} per sprite
          </Text>
        </Alert>
      )}
      
      {/* Output Panels */}
      <Grid templateColumns="repeat(2, 1fr)" gap={6} mb={6}>
        <GridItem>
          <FormLabel fontSize="sm" color="gray.400">Source (AI generated):</FormLabel>
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
              <Image src={sourceImageSrc} maxH="280px" alt="Generated source" />
            ) : (
              <Text color="gray.600" fontStyle="italic" fontSize="sm">
                Enter a prompt and click Generate
              </Text>
            )}
          </Box>
        </GridItem>
        
        <GridItem>
          <FormLabel fontSize="sm" color="gray.400">{consoleCfg?.name} Pixel Art:</FormLabel>
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
                imageRendering: 'pixelated',
              }}
            />
          </Box>
        </GridItem>
      </Grid>
      
      {/* Frame Strip */}
      <Box mb={6}>
        <FormLabel fontSize="sm" color="gray.400">Frames:</FormLabel>
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
                borderColor={i === currentFrame ? 'brand.500' : 'gray.700'}
                borderRadius="sm"
                cursor="pointer"
                bg="background.secondary"
                flexShrink={0}
                onClick={() => setCurrentFrame(i)}
                opacity={frame ? 1 : 0.3}
                borderStyle={frame ? 'solid' : 'dashed'}
              >
                {frame && (
                  <canvas
                    width={48}
                    height={48}
                    ref={(canvas) => {
                      if (canvas && frame) {
                        const ctx = canvas.getContext('2d')
                        ctx.imageSmoothingEnabled = false
                        ctx.drawImage(frame.canvas, 0, 0, 48, 48)
                      }
                    }}
                    style={{
                      width: '100%',
                      height: '100%',
                      imageRendering: 'pixelated',
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
        <Flex justify="space-between" align="center" mb={2} flexWrap="wrap" gap={2}>
          <FormLabel fontSize="sm" color="gray.400" mb={0}>Animation Preview:</FormLabel>
          <HStack spacing={2} flexWrap="wrap">
            <ButtonGroup size="sm" isAttached>
              <Button onClick={handlePlayPause}>{isPlaying ? '⏸' : '▶'}</Button>
              <Button onClick={handleStop}>⏹</Button>
            </ButtonGroup>
            
            <HStack>
              <FormLabel fontSize="xs" color="gray.400" mb={0}>FPS:</FormLabel>
              <NumberInput
                value={fps}
                onChange={(val) => setFps(parseInt(val) || 8)}
                min={1}
                max={30}
                maxW="60px"
                size="sm"
              >
                <NumberInputField />
              </NumberInput>
            </HStack>
            
            <FormControl maxW="110px">
              <HStack>
                <FormLabel fontSize="xs" color="gray.400" mb={0}>Ping-pong:</FormLabel>
                <Checkbox isChecked={pingPong} onChange={(e) => setPingPong(e.target.checked)} size="sm" />
              </HStack>
            </FormControl>
            
            <FormControl maxW="110px">
              <HStack>
                <FormLabel fontSize="xs" color="gray.400" mb={0}>Onion skin:</FormLabel>
                <Checkbox isChecked={onionSkin} onChange={(e) => setOnionSkin(e.target.checked)} size="sm" />
              </HStack>
            </FormControl>
          </HStack>
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
        >
          <canvas
            ref={previewCanvasRef}
            style={{
              imageRendering: 'pixelated',
            }}
          />
        </Box>
      </Box>
      
      {/* Save/Export */}
      <Flex gap={3} flexWrap="wrap" alignItems="flex-end" mb={6}>
        <FormControl maxW="200px">
          <FormLabel fontSize="xs" color="gray.400">Character name:</FormLabel>
          <Input
            value={charName}
            onChange={(e) => setCharName(e.target.value)}
            placeholder="e.g. knight, dragon..."
            bg="background.secondary"
            borderColor="gray.600"
            size="sm"
          />
        </FormControl>
        
        <Button onClick={handleSaveFrames} size="sm" variant="outline" colorScheme="brand">
          Save Frames
        </Button>
        
        <Button onClick={handleExportSheet} size="sm" variant="outline" colorScheme="brand">
          Export Sheet
        </Button>
        
        <Button onClick={handleLoad} size="sm" variant="outline" colorScheme="brand">
          Load
        </Button>
      </Flex>
      
      {/* Prompt Debug */}
      <Accordion allowToggle>
        <AccordionItem border="1px solid" borderColor="gray.700" borderRadius="md">
          <AccordionButton>
            <Box flex="1" textAlign="left" fontSize="xs" color="gray.500">
              Show Prompt Details
            </Box>
            <AccordionIcon />
          </AccordionButton>
          <AccordionPanel pb={4}>
            <VStack align="stretch" spacing={3}>
              <Box>
                <Text fontSize="xs" color="gray.600" textTransform="uppercase" mb={1}>
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
                  {lastRequest.prompt || '—'}
                </Code>
              </Box>
              
              <Box>
                <Text fontSize="xs" color="gray.600" textTransform="uppercase" mb={1}>
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
                  {lastRequest.negativePrompt || '(none)'}
                </Code>
              </Box>
              
              <Box>
                <Text fontSize="xs" color="gray.600" textTransform="uppercase" mb={1}>
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
                  {lastRequest.type === 'sheet' ? 'Sheet' : 'Single'} | {lastRequest.model} | {lastRequest.width}×{lastRequest.height}
                  {'\n'}{lastRequest.url}
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
                <Heading size="md" mb={2} color="brand.500">Request Inspector</Heading>
                <Text fontSize="sm" color="gray.400">
                  View raw model input and output from the last generation request.
                </Text>
              </Box>
              
              {/* Request Details */}
              <Box bg="background.secondary" p={5} borderRadius="md" borderWidth="1px" borderColor="gray.700">
                <Heading size="sm" mb={4} color="brand.500">Request Details</Heading>
                <VStack align="stretch" spacing={3}>
                  <Flex>
                    <Text fontSize="sm" fontWeight="bold" color="brand.500" minW="120px">Provider:</Text>
                    <Text fontSize="sm">{lastRequest.provider || '—'}</Text>
                  </Flex>
                  <Flex>
                    <Text fontSize="sm" fontWeight="bold" color="brand.500" minW="120px">Model:</Text>
                    <Text fontSize="sm">{lastRequest.model || '—'}</Text>
                  </Flex>
                  <Flex>
                    <Text fontSize="sm" fontWeight="bold" color="brand.500" minW="120px">Type:</Text>
                    <Text fontSize="sm">{lastRequest.type === 'sheet' ? 'Sprite Sheet' : lastRequest.type === 'single' ? 'Single Frame' : '—'}</Text>
                  </Flex>
                  <Flex>
                    <Text fontSize="sm" fontWeight="bold" color="brand.500" minW="120px">Dimensions:</Text>
                    <Text fontSize="sm">{lastRequest.width && lastRequest.height ? `${lastRequest.width} × ${lastRequest.height} px` : '—'}</Text>
                  </Flex>
                </VStack>
              </Box>
              
              {/* Enhanced Prompt */}
              <Box bg="background.secondary" p={5} borderRadius="md" borderWidth="1px" borderColor="gray.700">
                <Heading size="sm" mb={3} color="brand.500">Enhanced Prompt</Heading>
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
                  {lastRequest.prompt || '—'}
                </Code>
              </Box>
              
              {/* Negative Prompt */}
              <Box bg="background.secondary" p={5} borderRadius="md" borderWidth="1px" borderColor="gray.700">
                <Heading size="sm" mb={3} color="brand.500">Negative Prompt</Heading>
                <Code
                  display="block"
                  whiteSpace="pre-wrap"
                  p={3}
                  bg="gray.900"
                  fontSize="sm"
                  borderRadius="sm"
                >
                  {lastRequest.negativePrompt || '(none)'}
                </Code>
              </Box>
              
              {/* Request URL */}
              <Box bg="background.secondary" p={5} borderRadius="md" borderWidth="1px" borderColor="gray.700">
                <Heading size="sm" mb={3} color="brand.500">Request URL</Heading>
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
                  {lastRequest.url || '—'}
                </Code>
              </Box>
              
              {/* Configuration */}
              <Box bg="background.secondary" p={5} borderRadius="md" borderWidth="1px" borderColor="gray.700">
                <Heading size="sm" mb={3} color="brand.500">Configuration</Heading>
                <Code
                  display="block"
                  whiteSpace="pre"
                  p={3}
                  bg="gray.900"
                  fontSize="sm"
                  borderRadius="sm"
                >
                  {JSON.stringify({
                    console: consoleId,
                    spriteSize,
                    pipelineMode,
                    dithering: ditherMode || 'none',
                    outlines,
                    cleanup,
                    transparent: transparentBg,
                    seed: seed || 'random',
                  }, null, 2)}
                </Code>
              </Box>
            </VStack>
          </TabPanel>
        </TabPanels>
      </Tabs>
    </Container>
  )
}

export default App
