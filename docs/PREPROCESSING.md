# Image Preprocessing Guide

## Overview

The image preprocessing feature enhances AI-generated images before pixelation to produce better quality pixel art sprites. This addresses common issues like:

- **Noise and artifacts** from AI generation
- **Soft/blurry edges** that pixelate poorly  
- **Low contrast** that makes sprites look blob-like
- **Background color inconsistencies** causing flickering in animations

## Preprocessing Presets

### None
Disables all preprocessing. Use this when:
- You want the raw AI output pixelated directly
- The source image is already clean and high-contrast
- You're experiencing issues with preprocessing

### Standard (balanced) - **Default**
Balanced preprocessing suitable for most use cases:
- **Denoise strength:** 1 (light median filter)
- **Sharpen strength:** 1.2 (moderate edge enhancement)
- **Contrast boost:** 1.05 (5% increase)
- **Saturation boost:** 1.1 (10% increase)

Best for: General sprite generation, single frames

### Strong (crisp edges)
Aggressive preprocessing for maximum detail:
- **Denoise strength:** 2 (medium median filter)
- **Sharpen strength:** 2.0 (strong edge enhancement)
- **Contrast boost:** 1.15 (15% increase)
- **Saturation boost:** 1.2 (20% increase)

Best for: Small sprites (8×8, 16×16), detailed characters, when AI output is very soft/blurry

### Animation (consistent)
Optimized for multi-frame animations:
- **Denoise strength:** 1.5 (medium-light median filter)
- **Sharpen strength:** 1.5 (moderate-strong edge enhancement)
- **Contrast boost:** 1.1 (10% increase)
- **Saturation boost:** 1.15 (15% increase)
- **Color stabilization:** Enabled (histogram normalization)

Best for: Sprite sheets, animation sequences, when you need consistent color tones across frames

## How It Works

The preprocessing pipeline applies operations in this order:

1. **Denoise** - Median filter removes noise while preserving edges
2. **Contrast** - Stretches the dynamic range to make features more distinct
3. **Saturation** - Boosts color vibrancy for more appealing sprites
4. **Sharpen** - Unsharp mask enhances edges for crisper pixelation
5. **Stabilize** (animation preset only) - Normalizes color histograms for frame-to-frame consistency

## Technical Details

All preprocessing is done using pure JavaScript and Canvas API for browser compatibility. The implementation includes:

- **Median filtering** - Simple box approximation for edge-preserving noise reduction
- **Unsharp masking** - Gaussian blur + difference amplification for edge enhancement
- **Linear contrast adjustment** - Stretches pixel values around midpoint
- **Saturation adjustment** - Interpolates between grayscale and color
- **Histogram normalization** - Equalizes color distributions across images

## Best Practices

### For Single Sprites
- Start with "Standard" preset
- If the sprite looks too soft, try "Strong"
- If colors look oversaturated, switch to "None" or reduce the pipeline setting

### For Animations
- Always use "Animation" preset for consistency
- Generate all frames with the same settings
- Use "Gen Sheet" to process frames together with shared palette

### Troubleshooting

**Sprites look over-sharpened or have artifacts:**
- Switch to "Standard" or "None"
- The AI model may already produce clean output

**Animation frames flicker:**
- Use "Animation" preset with color stabilization
- Ensure all frames use the same preprocessing settings
- Consider using "Gen Sheet" instead of individual frames

**Colors don't match the palette well:**
- Try "None" preprocessing
- Some palettes work better with raw AI output
- Adjust the Pipeline setting (Enhanced vs Classic)

## Performance

Preprocessing adds minimal processing time:
- **Standard/Strong:** ~50-100ms per frame
- **Animation (with stabilization):** ~100-200ms per frame

The enhanced pipeline (OKLAB color space + mode downscaling) provides the best results when combined with preprocessing.
