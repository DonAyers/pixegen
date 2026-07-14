/**
 * Image decode/encode for the Node adapter, via pngjs + jpeg-js (both pure
 * JS, no native build). Output is always PNG; input is PNG or JPEG because
 * the live Pollinations API serves image/jpeg for non-transparent models
 * (mock servers and OpenAI return PNG, which is how this stayed hidden).
 * Everything between decode and encode is portable core math.
 */

import { PNG } from "pngjs";
import jpeg from "jpeg-js";
import { rasterFrom } from "../core/raster.js";

/**
 * Decode a PNG buffer into a raster.
 * @param {Buffer|Uint8Array} buffer
 * @returns {{ data: Uint8ClampedArray, width: number, height: number }}
 */
export function decodePng(buffer) {
    const png = PNG.sync.read(
        Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer),
    );
    return rasterFrom(
        new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.length),
        png.width,
        png.height,
    );
}

/**
 * Decode a PNG or JPEG buffer into a raster, sniffing the magic bytes.
 * @param {Buffer|Uint8Array} buffer
 * @returns {{ data: Uint8ClampedArray, width: number, height: number }}
 */
export function decodeImage(buffer) {
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
        return decodePng(buf);
    }
    if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
        const decoded = jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 1024 });
        return rasterFrom(
            new Uint8ClampedArray(decoded.data.buffer, decoded.data.byteOffset, decoded.data.length),
            decoded.width,
            decoded.height,
        );
    }
    throw new Error("not a PNG or JPEG (unrecognized magic bytes)");
}

/**
 * File extension matching a provider image buffer's actual format.
 * Callers writing raw source bytes to disk should name them with this
 * instead of assuming ".png" (live Pollinations serves JPEG).
 * @param {Buffer|Uint8Array} buffer
 * @returns {"png"|"jpg"}
 */
export function imageExtension(buffer) {
    return buffer.length >= 3 &&
        buffer[0] === 0xff &&
        buffer[1] === 0xd8 &&
        buffer[2] === 0xff
        ? "jpg"
        : "png";
}

/**
 * Encode a raster as a PNG buffer.
 * @param {{ data: Uint8ClampedArray, width: number, height: number }} raster
 * @returns {Buffer}
 */
export function encodePng(raster) {
    const png = new PNG({ width: raster.width, height: raster.height });
    png.data = Buffer.from(
        raster.data.buffer,
        raster.data.byteOffset,
        raster.data.length,
    );
    return PNG.sync.write(png);
}
