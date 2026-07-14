/**
 * Raster primitives — the portable core's image type.
 *
 * A "raster" is a plain `{ data: Uint8ClampedArray, width, height }` object
 * holding RGBA pixels, structurally compatible with the browser's ImageData
 * (an ImageData can be passed anywhere a raster is accepted). Core modules
 * never construct ImageData or touch a canvas, so they run identically in
 * the browser and in Node.
 */

/**
 * Create an empty (transparent black) raster.
 * @param {number} width
 * @param {number} height
 * @returns {{ data: Uint8ClampedArray, width: number, height: number }}
 */
export function createRaster(width, height) {
    return {
        data: new Uint8ClampedArray(width * height * 4),
        width,
        height,
    };
}

/**
 * Wrap existing RGBA bytes as a raster (no copy).
 * @param {Uint8ClampedArray|Uint8Array} data - RGBA bytes, length = w*h*4
 * @param {number} width
 * @param {number} height
 */
export function rasterFrom(data, width, height) {
    if (data.length !== width * height * 4) {
        throw new Error(
            `Raster data length ${data.length} doesn't match ${width}x${height} RGBA`,
        );
    }
    const clamped =
        data instanceof Uint8ClampedArray
            ? data
            : new Uint8ClampedArray(data.buffer, data.byteOffset, data.length);
    return { data: clamped, width, height };
}

/**
 * Deep-copy a raster (or ImageData) into a fresh raster.
 */
export function cloneRaster(src) {
    return {
        data: new Uint8ClampedArray(src.data),
        width: src.width,
        height: src.height,
    };
}

/**
 * Copy a rectangular region out of a raster into a new raster.
 * Used to slice batched sheet/grid generations into frames/tiles without
 * any canvas drawImage.
 */
export function cropRaster(src, x, y, width, height) {
    const out = createRaster(width, height);
    for (let row = 0; row < height; row++) {
        const srcStart = ((y + row) * src.width + x) * 4;
        const dstStart = row * width * 4;
        out.data.set(
            src.data.subarray(srcStart, srcStart + width * 4),
            dstStart,
        );
    }
    return out;
}

/**
 * Crop a raster to its subject's bounding box (plus margin), so a
 * small-in-frame character uses the full pixel budget when downscaled —
 * the biggest quality lever the eval loop found for models that leave
 * lots of empty background (docs/Next-Phase.md §2).
 *
 * Background detection: border-pixel mode color (or transparency when the
 * border is mostly alpha-0). Subject = pixels differing from it beyond
 * `threshold`. Returns the input unchanged when the subject already fills
 * the frame, or when nothing (or everything) looks like subject.
 *
 * Only meaningful for single sprites — cropping sheet frames independently
 * would misalign the animation.
 *
 * @param {{ data, width, height }} src
 * @param {object} [options]
 * @param {number} [options.threshold=48] - Max per-channel distance from the
 *   background color that still counts as background
 * @param {number} [options.margin=0.08] - Padding around the bbox, as a
 *   fraction of its larger side
 * @param {number} [options.targetAspect] - Desired w/h; the crop box is
 *   expanded (never shrunk) to match, so downscale doesn't distort
 * @returns {{ data, width, height }}
 */
export function autoCropSubject(src, options = {}) {
    const { threshold = 48, margin = 0.08, targetAspect } = options;
    const { data, width, height } = src;

    // Sample the border to find the background: alpha-transparent, or the
    // most common quantized border color.
    let transparentCount = 0;
    const counts = new Map();
    let borderTotal = 0;
    const sampleBorder = (x, y) => {
        const i = (y * width + x) * 4;
        borderTotal++;
        if (data[i + 3] < 16) {
            transparentCount++;
            return;
        }
        // Quantize to 16-steps per channel so slight gradients bucket together.
        const key =
            ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
        counts.set(key, (counts.get(key) || 0) + 1);
    };
    for (let x = 0; x < width; x++) {
        sampleBorder(x, 0);
        sampleBorder(x, height - 1);
    }
    for (let y = 1; y < height - 1; y++) {
        sampleBorder(0, y);
        sampleBorder(width - 1, y);
    }

    const transparentBg = transparentCount > borderTotal / 2;
    let bgR = 0;
    let bgG = 0;
    let bgB = 0;
    if (!transparentBg) {
        let bestKey = -1;
        let bestCount = -1;
        for (const [key, count] of counts) {
            if (count > bestCount) {
                bestKey = key;
                bestCount = count;
            }
        }
        if (bestKey < 0) return src;
        bgR = ((bestKey >> 8) & 0xf) * 16 + 8;
        bgG = ((bestKey >> 4) & 0xf) * 16 + 8;
        bgB = (bestKey & 0xf) * 16 + 8;
    }

    const isSubject = (i) => {
        if (transparentBg) return data[i + 3] >= 16;
        if (data[i + 3] < 16) return false;
        return (
            Math.abs(data[i] - bgR) > threshold ||
            Math.abs(data[i + 1] - bgG) > threshold ||
            Math.abs(data[i + 2] - bgB) > threshold
        );
    };

    // Histogram subject mass per column/row, then trim a small percentile
    // off each side: an exact bbox is defeated by stray background speckles
    // (common in AI output), which would inflate it to the full frame.
    const colMass = new Uint32Array(width);
    const rowMass = new Uint32Array(height);
    let totalMass = 0;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (isSubject((y * width + x) * 4)) {
                colMass[x]++;
                rowMass[y]++;
                totalMass++;
            }
        }
    }
    if (totalMass === 0) return src; // nothing but background

    const trim = totalMass * 0.02;
    const trimmedBounds = (mass, size) => {
        let lo = 0;
        let acc = 0;
        while (lo < size && acc + mass[lo] <= trim) acc += mass[lo++];
        let hi = size - 1;
        acc = 0;
        while (hi > lo && acc + mass[hi] <= trim) acc += mass[hi--];
        return [lo, hi];
    };
    let [minX, maxX] = trimmedBounds(colMass, width);
    let [minY, maxY] = trimmedBounds(rowMass, height);

    let boxW = maxX - minX + 1;
    let boxH = maxY - minY + 1;
    // Subject already (nearly) fills the frame — leave it alone.
    if (boxW >= width * 0.92 && boxH >= height * 0.92) return src;

    const pad = Math.round(Math.max(boxW, boxH) * margin);
    minX -= pad;
    minY -= pad;
    maxX += pad;
    maxY += pad;
    boxW = maxX - minX + 1;
    boxH = maxY - minY + 1;

    // Expand (never shrink) to the target aspect so downscale keeps shape.
    if (targetAspect > 0) {
        if (boxW / boxH < targetAspect) {
            const want = Math.round(boxH * targetAspect);
            minX -= Math.floor((want - boxW) / 2);
            maxX = minX + want - 1;
        } else if (boxW / boxH > targetAspect) {
            const want = Math.round(boxW / targetAspect);
            minY -= Math.floor((want - boxH) / 2);
            maxY = minY + want - 1;
        }
    }

    // Clamp by sliding the box back inside the frame, then trimming.
    if (minX < 0) {
        maxX -= minX;
        minX = 0;
    }
    if (minY < 0) {
        maxY -= minY;
        minY = 0;
    }
    if (maxX >= width) {
        minX = Math.max(0, minX - (maxX - width + 1));
        maxX = width - 1;
    }
    if (maxY >= height) {
        minY = Math.max(0, minY - (maxY - height + 1));
        maxY = height - 1;
    }

    return cropRaster(src, minX, minY, maxX - minX + 1, maxY - minY + 1);
}

/**
 * Nearest-neighbor integer upscale — for previews of small pixel-art
 * rasters (a 32×32 sprite is unjudgeable at native size).
 * @param {{ data, width, height }} src
 * @param {number} factor - Integer scale factor ≥ 1
 */
export function upscaleRaster(src, factor) {
    const f = Math.max(1, Math.floor(factor));
    if (f === 1) return cloneRaster(src);
    const out = createRaster(src.width * f, src.height * f);
    for (let y = 0; y < out.height; y++) {
        const sy = (y / f) | 0;
        for (let x = 0; x < out.width; x++) {
            const si = (sy * src.width + ((x / f) | 0)) * 4;
            const di = (y * out.width + x) * 4;
            out.data[di] = src.data[si];
            out.data[di + 1] = src.data[si + 1];
            out.data[di + 2] = src.data[si + 2];
            out.data[di + 3] = src.data[si + 3];
        }
    }
    return out;
}

/**
 * Copy an entire source raster into a destination raster at (x, y).
 * Used for sheet assembly (the reverse of cropRaster).
 */
export function blitRaster(dst, src, x, y) {
    for (let row = 0; row < src.height; row++) {
        const dstStart = ((y + row) * dst.width + x) * 4;
        const srcStart = row * src.width * 4;
        dst.data.set(
            src.data.subarray(srcStart, srcStart + src.width * 4),
            dstStart,
        );
    }
    return dst;
}
