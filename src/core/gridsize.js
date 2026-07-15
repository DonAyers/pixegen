/**
 * Pixel grid detection — recovers the native pixel size of an upscaled or
 * JPEG-softened pixel-art image, so a source that was drawn (or generated)
 * at a smaller resolution and scaled up can be downscaled back to its true
 * grid instead of an arbitrary target size.
 * Ported from Astropulse/pixeldetector (MIT).
 *
 * Algorithm: sum the RGB distance between each pixel and its right/below
 * neighbor into a 1-D "edge energy" profile per axis (columns for
 * vertical grid lines, rows for horizontal ones). A true pixel-art upscale
 * has near-zero energy *within* a source pixel's block and a spike at every
 * block boundary, so peak-finding on each profile recovers the grid: the
 * median gap between consecutive peaks is the spacing, and
 * width/height divided by spacing recovers the native resolution.
 */

/**
 * Local-maxima peak finder with prominence and minimum-distance filtering
 * (a hand-rolled subset of scipy.signal.find_peaks — only what
 * detectPixelGrid needs).
 *
 * @param {ArrayLike<number>} values
 * @param {object} [options]
 * @param {number} [options.minProminence=0] - Minimum height above the
 *   higher of the peak's two bounding valleys
 * @param {number} [options.minDistance=1] - Minimum index gap between
 *   returned peaks; when candidates conflict, the taller one wins
 * @returns {number[]} Peak indices, ascending
 */
export function findPeaks(values, { minProminence = 0, minDistance = 1 } = {}) {
    const n = values.length;
    if (n < 3) return [];

    const candidates = [];
    for (let i = 1; i < n - 1; i++) {
        if (values[i] > values[i - 1] && values[i] > values[i + 1]) {
            candidates.push(i);
        }
    }

    const withProminence = candidates
        .map((i) => ({ i, value: values[i], prominence: peakProminence(values, i) }))
        .filter((p) => p.prominence >= minProminence);

    // Greedy non-max suppression: tallest peaks win ties for a shared
    // neighborhood within minDistance.
    withProminence.sort((a, b) => b.value - a.value);
    const selected = [];
    for (const p of withProminence) {
        if (selected.every((s) => Math.abs(s - p.i) >= minDistance)) {
            selected.push(p.i);
        }
    }

    return selected.sort((a, b) => a - b);
}

/**
 * Prominence of the peak at index i: its height above the higher of the
 * two nearest valleys reached before the profile rises above the peak's
 * own value on each side (scipy's prominence definition).
 */
function peakProminence(values, i) {
    const peak = values[i];

    let leftMin = peak;
    for (let j = i - 1; j >= 0; j--) {
        if (values[j] > peak) break;
        if (values[j] < leftMin) leftMin = values[j];
    }

    let rightMin = peak;
    for (let j = i + 1; j < values.length; j++) {
        if (values[j] > peak) break;
        if (values[j] < rightMin) rightMin = values[j];
    }

    return peak - Math.max(leftMin, rightMin);
}

/**
 * Per-axis edge-energy profiles: colEnergy[x] is the total RGB distance
 * between column x and column x+1 summed over every row; rowEnergy[y] is
 * the equivalent for row y vs. row y+1.
 */
function buildEdgeProfiles({ width, height, data }) {
    const colEnergy = new Float64Array(Math.max(0, width - 1));
    for (let x = 0; x < width - 1; x++) {
        let sum = 0;
        for (let y = 0; y < height; y++) {
            const i0 = (y * width + x) * 4;
            const i1 = i0 + 4;
            sum +=
                Math.abs(data[i0] - data[i1]) +
                Math.abs(data[i0 + 1] - data[i1 + 1]) +
                Math.abs(data[i0 + 2] - data[i1 + 2]);
        }
        colEnergy[x] = sum;
    }

    const rowEnergy = new Float64Array(Math.max(0, height - 1));
    for (let y = 0; y < height - 1; y++) {
        let sum = 0;
        const rowStart = y * width;
        const nextRowStart = rowStart + width;
        for (let x = 0; x < width; x++) {
            const i0 = (rowStart + x) * 4;
            const i1 = (nextRowStart + x) * 4;
            sum +=
                Math.abs(data[i0] - data[i1]) +
                Math.abs(data[i0 + 1] - data[i1 + 1]) +
                Math.abs(data[i0 + 2] - data[i1 + 2]);
        }
        rowEnergy[y] = sum;
    }

    return { colEnergy, rowEnergy };
}

/**
 * Recover one axis's grid spacing + confidence from its edge-energy
 * profile. Confidence is the fraction of consecutive peak gaps within ±1
 * of the median gap — a photo or flat image has no consistent periodicity
 * and scores 0.
 */
function analyzeAxis(energy) {
    const max = energy.length ? Math.max(...energy) : 0;
    if (max <= 0) return { spacing: 1, confidence: 0 };

    const mean = energy.reduce((a, b) => a + b, 0) / energy.length;
    // Relative threshold: a real grid line stands well above both the
    // profile's average and a fraction of its tallest spike; plain
    // noise/photos have no such standout peaks.
    const minProminence = Math.max(max * 0.15, mean * 0.5);
    const peaks = findPeaks(energy, { minProminence, minDistance: 2 });
    if (peaks.length < 2) return { spacing: 1, confidence: 0 };

    const gaps = [];
    for (let i = 1; i < peaks.length; i++) gaps.push(peaks[i] - peaks[i - 1]);
    const sortedGaps = [...gaps].sort((a, b) => a - b);
    const median = sortedGaps[Math.floor(sortedGaps.length / 2)];
    if (!(median >= 1)) return { spacing: 1, confidence: 0 };

    const withinTolerance = gaps.filter((g) => Math.abs(g - median) <= 1).length;
    const confidence = withinTolerance / gaps.length;

    return { spacing: median, confidence };
}

/**
 * Detect the native pixel grid of a (possibly upscaled/softened) raster.
 *
 * @param {{ data, width, height }} raster
 * @returns {{ spacingX: number, spacingY: number, nativeW: number, nativeH: number, confidence: number }}
 */
export function detectPixelGrid(raster) {
    const { width, height } = raster;
    const { colEnergy, rowEnergy } = buildEdgeProfiles(raster);

    const x = analyzeAxis(colEnergy);
    const y = analyzeAxis(rowEnergy);

    return {
        spacingX: x.spacing,
        spacingY: y.spacing,
        nativeW: Math.max(1, Math.round(width / x.spacing)),
        nativeH: Math.max(1, Math.round(height / y.spacing)),
        // Callers should ignore detections below a confidence threshold
        // (photos, flat/noisy images) rather than treat either axis alone.
        confidence: Math.min(x.confidence, y.confidence),
    };
}
