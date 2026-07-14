/**
 * Post-generation validation gate (portable, deterministic).
 *
 * AI generation is stochastic and `seed` is only best-effort; nothing else
 * in the pipeline verifies a generation came out usable before it's
 * accepted. These checks run against the *processed* pixel output so an
 * unattended caller (CLI/MCP) can reject-and-retry a bad frame instead of
 * silently writing it to disk. See docs/Next-Phase.md §4.
 *
 * Every check returns issue strings; empty array = pass.
 */

const ALPHA_OPAQUE_THRESHOLD = 10;

function forEachOpaquePixel(raster, fn) {
    const { data, width, height } = raster;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            if (data[i + 3] >= ALPHA_OPAQUE_THRESHOLD) {
                fn(i, x, y);
            }
        }
    }
}

/**
 * A frame that is entirely one color (or entirely transparent) is a failed
 * generation, whatever the model claims. The outermost 1px ring is excluded
 * from the color count when the frame is big enough — the auto-outline pass
 * darkens border pixels, which would give even a flat failed frame a second
 * "color".
 */
export function checkNotBlank(raster) {
    const issues = [];
    const { data, width, height } = raster;
    const colors = new Set();
    let opaque = 0;

    const skipRing = width > 4 && height > 4 ? 1 : 0;

    forEachOpaquePixel(raster, (i, x, y) => {
        opaque++;
        const inInterior =
            x >= skipRing &&
            y >= skipRing &&
            x < width - skipRing &&
            y < height - skipRing;
        if (inInterior && colors.size < 4) {
            colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
        }
    });

    const total = width * height;
    if (opaque === 0) {
        issues.push("frame is fully transparent");
    } else if (colors.size < 2) {
        issues.push("frame is a single flat color (no subject visible)");
    } else if (opaque < total * 0.005) {
        issues.push(
            `only ${opaque} of ${total} pixels are opaque — subject likely missing`,
        );
    }
    return issues;
}

/**
 * When a transparent background was requested (and the model supports it),
 * verify it actually arrived: a meaningful transparent share, and corners
 * clear. Models ignoring `transparent=true` is a known failure mode.
 */
export function checkTransparency(raster) {
    const issues = [];
    const { data, width, height } = raster;

    let transparent = 0;
    const total = width * height;
    for (let i = 3; i < data.length; i += 4) {
        if (data[i] < ALPHA_OPAQUE_THRESHOLD) transparent++;
    }

    if (transparent < total * 0.02) {
        issues.push(
            "transparent background requested but frame has almost no transparent pixels",
        );
    }

    const corners = [
        0,
        (width - 1) * 4,
        (height - 1) * width * 4,
        ((height - 1) * width + (width - 1)) * 4,
    ];
    const opaqueCorners = corners.filter(
        (i) => data[i + 3] >= ALPHA_OPAQUE_THRESHOLD,
    ).length;
    if (opaqueCorners > 1) {
        issues.push(
            `${opaqueCorners}/4 corners are opaque — background probably wasn't removed`,
        );
    }

    return issues;
}

/**
 * For fixed-palette profiles, every opaque pixel must be a palette color or
 * its auto-outline darkened variant (generateOutlines multiplies channels
 * by 0.65, taking edge pixels off-palette by design).
 */
export function checkPaletteConformance(raster, profile, options = {}) {
    if (!profile || profile.quantizeMode !== "palette" || !profile.palette) {
        return [];
    }
    const { outlineDarkenFactor = 0.35 } = options;

    const allowed = new Set();
    for (const [r, g, b] of profile.palette) {
        allowed.add(`${r},${g},${b}`);
        allowed.add(
            `${Math.round(r * (1 - outlineDarkenFactor))},${Math.round(g * (1 - outlineDarkenFactor))},${Math.round(b * (1 - outlineDarkenFactor))}`,
        );
    }

    let offPalette = 0;
    const { data } = raster;
    forEachOpaquePixel(raster, (i) => {
        if (!allowed.has(`${data[i]},${data[i + 1]},${data[i + 2]}`)) {
            offPalette++;
        }
    });

    if (offPalette > 0) {
        return [
            `${offPalette} opaque pixels are outside the ${profile.name} palette`,
        ];
    }
    return [];
}

/**
 * Opaque-pixel bounding box + centroid of a frame, for drift comparison.
 * Returns null for fully transparent frames.
 */
export function frameFootprint(raster) {
    let minX = Infinity,
        minY = Infinity,
        maxX = -1,
        maxY = -1,
        sumX = 0,
        sumY = 0,
        count = 0;

    forEachOpaquePixel(raster, (_i, x, y) => {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        sumX += x;
        sumY += y;
        count++;
    });

    if (count === 0) return null;
    return {
        minX,
        minY,
        maxX,
        maxY,
        area: (maxX - minX + 1) * (maxY - minY + 1),
        cx: sumX / count,
        cy: sumY / count,
    };
}

/**
 * Cross-frame consistency for sheets/tiles of the same subject: large
 * centroid drift or bounding-box area swings between frames flag a likely
 * "different pose entirely" / "character drifted off-canvas" generation.
 *
 * Only meaningful when a transparent/clean background separates subject
 * from backdrop; with opaque backgrounds every pixel is "subject" and the
 * check trivially passes, which is the safe direction.
 */
export function checkFrameConsistency(rasters, options = {}) {
    const { maxCentroidDriftRatio = 0.35, maxAreaRatio = 4 } = options;
    const issues = [];

    const footprints = rasters.map(frameFootprint);
    const valid = footprints.filter(Boolean);
    if (valid.length < 2) return issues;

    const w = rasters[0].width;
    const h = rasters[0].height;

    for (let i = 1; i < footprints.length; i++) {
        const a = footprints[i - 1];
        const b = footprints[i];
        if (!a || !b) continue;

        const drift = Math.hypot((a.cx - b.cx) / w, (a.cy - b.cy) / h);
        if (drift > maxCentroidDriftRatio) {
            issues.push(
                `frames ${i - 1}→${i}: subject centroid drifted ${(drift * 100).toFixed(0)}% of the canvas`,
            );
        }

        const areaRatio = Math.max(a.area, b.area) / Math.max(1, Math.min(a.area, b.area));
        if (areaRatio > maxAreaRatio) {
            issues.push(
                `frames ${i - 1}→${i}: subject size changed ${areaRatio.toFixed(1)}x — likely inconsistent generation`,
            );
        }
    }

    return issues;
}

/**
 * Run all applicable checks against one processed frame.
 *
 * @param {{ data, width, height }} raster - Processed pixel output
 * @param {object} options
 * @param {object} [options.profile] - PALETTE_PROFILES entry used
 * @param {boolean} [options.transparentRequested] - Whether a transparent
 *   background was requested AND sent (i.e. the model supports it)
 * @returns {{ ok: boolean, issues: string[] }}
 */
export function validateFrame(raster, options = {}) {
    const { profile = null, transparentRequested = false } = options;

    const issues = [
        ...checkNotBlank(raster),
        ...(transparentRequested ? checkTransparency(raster) : []),
        ...checkPaletteConformance(raster, profile),
    ];

    return { ok: issues.length === 0, issues };
}

/**
 * Run per-frame checks plus cross-frame consistency over a set of frames.
 *
 * @param {Array<{ data, width, height }>} rasters
 * @param {object} options - Same as validateFrame
 * @returns {{ ok: boolean, issues: string[] }}
 */
export function validateFrameSet(rasters, options = {}) {
    const issues = [];
    rasters.forEach((raster, i) => {
        const { issues: frameIssues } = validateFrame(raster, options);
        issues.push(...frameIssues.map((msg) => `frame ${i}: ${msg}`));
    });
    if (options.transparentRequested) {
        issues.push(...checkFrameConsistency(rasters));
    }
    return { ok: issues.length === 0, issues };
}
