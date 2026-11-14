// @ts-nocheck
/**
 * R59 Media Admin — Universal WebP Converter Engine
 *
 * High-fidelity client-side image processing utility. Converts standard formats
 * (JPG, PNG, GIF, BMP, TIFF, AVIF), Apple HEIC/HEIF photos, and Camera RAW formats
 * (Canon CR2/CR3, Nikon NEF, Sony ARW, Adobe DNG, Fuji RAF, Olympus ORF, Panasonic RW2,
 * Pentax PEF, Samsung SRW) into maximum-fidelity, 92% quality WebP images
 * with automatic lanczos3 downscaling for images exceeding 2560px.
 *
 * Pipeline:
 * - 100% EXIF/GPS/metadata stripping via createImageBitmap({ premultiplyAlpha: 'none', colorSpaceConversion: 'default' })
 * - Off-main-thread C-Wasm libwebp and lanczos3 resize via webpEncoder.worker.js
 * - Graceful fallback to HTML5 <canvas> 0.92 encoding if WebAssembly/Worker is unavailable or fails
 */
(function () {
    'use strict';
    const SUPPORTED_EXTENSIONS = new Set([
        'jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif',
        'tif', 'tiff', 'heic', 'heif',
        'cr2', 'cr3', 'nef', 'arw', 'dng', 'raf', 'orf', 'rw2', 'pef', 'srw'
    ]);
    const RAW_EXTENSIONS = new Set([
        'cr2', 'cr3', 'nef', 'arw', 'dng', 'raf', 'orf', 'rw2', 'pef', 'srw'
    ]);
    const HEIC_EXTENSIONS = new Set(['heic', 'heif']);
    /**
     * Check if a File or Blob is a supported image type by MIME type or file extension.
     * @param {File|Blob} file
     * @returns {boolean}
     */
    function isSupportedImageFile(file) {
        if (!file)
            return false;
        if (file.type && file.type.startsWith('image/'))
            return true;
        const name = file.name || '';
        const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
        return SUPPORTED_EXTENSIONS.has(ext);
    }
    /**
     * Scan binary ArrayBuffer of a Camera RAW file for embedded full-resolution JPEG stream.
     * Looks for SOI markers (FF D8 FF) paired with EOI markers (FF D9).
     * Selects the largest slice (> 32 KB threshold) which represents the full preview.
     * @param {ArrayBuffer} arrayBuffer
     * @returns {Blob} JPEG Blob
     */
    function extractLargestEmbeddedJpeg(arrayBuffer) {
        const bytes = new Uint8Array(arrayBuffer);
        const len = bytes.length;
        let largestSlice = null;
        let maxSize = 0;
        // Scan for JPEG SOI markers (FF D8 FF)
        for (let i = 0; i < len - 4; i++) {
            if (bytes[i] === 0xFF && bytes[i + 1] === 0xD8 && bytes[i + 2] === 0xFF) {
                const soi = i;
                let eoi = -1;
                let j = soi + 2;
                while (j < len - 1) {
                    if (bytes[j] === 0xFF) {
                        const marker = bytes[j + 1];
                        // If a new SOI marker appears before EOI, break to avoid cross-boundary slices
                        if (marker === 0xD8 && j + 2 < len && bytes[j + 2] === 0xFF) {
                            break;
                        }
                        if (marker === 0xD9) {
                            eoi = j + 2;
                            const size = eoi - soi;
                            if (size > 32 * 1024 && size > maxSize) {
                                maxSize = size;
                                largestSlice = bytes.subarray(soi, eoi);
                            }
                            break;
                        }
                        // Optimization: skip standard JPEG segment lengths (APPn, DQT, DHT, SOFn)
                        if ((marker >= 0xE0 && marker <= 0xEF) ||
                            marker === 0xDB ||
                            marker === 0xC4 ||
                            (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC)) {
                            if (j + 3 < len) {
                                const segLen = (bytes[j + 2] << 8) | bytes[j + 3];
                                if (segLen > 1 && j + 2 + segLen < len) {
                                    j += 2 + segLen;
                                    continue;
                                }
                            }
                        }
                    }
                    j++;
                }
                if (eoi > soi) {
                    i = eoi - 1;
                }
            }
        }
        // Fallback: If no slice > 32KB was found, attempt to find any valid JPEG slice
        if (!largestSlice) {
            for (let i = 0; i < len - 4; i++) {
                if (bytes[i] === 0xFF && bytes[i + 1] === 0xD8 && bytes[i + 2] === 0xFF) {
                    const soi = i;
                    for (let j = soi + 2; j < len - 1; j++) {
                        if (bytes[j] === 0xFF && bytes[j + 1] === 0xD9) {
                            const eoi = j + 2;
                            const size = eoi - soi;
                            if (size > maxSize) {
                                maxSize = size;
                                largestSlice = bytes.subarray(soi, eoi);
                            }
                            i = eoi - 1;
                            break;
                        }
                    }
                }
            }
        }
        if (!largestSlice || largestSlice.length === 0) {
            throw new Error('Unable to extract embedded JPEG preview from RAW image');
        }
        return new Blob([largestSlice], { type: 'image/jpeg' });
    }
    let heic2anyLoadingPromise = null;
    /**
     * Lazy loader for heic2any library from CDN.
     */
    function loadHeic2Any() {
        if (typeof window !== 'undefined' && window.heic2any) {
            return Promise.resolve(window.heic2any);
        }
        if (!heic2anyLoadingPromise) {
            heic2anyLoadingPromise = new Promise((resolve, reject) => {
                if (typeof document === 'undefined') {
                    return reject(new Error('Document is undefined; cannot load heic2any in this environment'));
                }
                const existing = document.querySelector('script[data-lib="heic2any"]');
                if (existing) {
                    let attempts = 0;
                    const interval = setInterval(() => {
                        if (window.heic2any) {
                            clearInterval(interval);
                            resolve(window.heic2any);
                        }
                        else if (++attempts > 100) {
                            clearInterval(interval);
                            reject(new Error('Timed out waiting for heic2any to initialize'));
                        }
                    }, 50);
                    return;
                }
                const script = document.createElement('script');
                script.src = 'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js';
                script.setAttribute('data-lib', 'heic2any');
                script.async = true;
                script.onload = () => {
                    if (window.heic2any) {
                        resolve(window.heic2any);
                    }
                    else {
                        reject(new Error('heic2any loaded but window.heic2any is undefined'));
                    }
                };
                script.onerror = () => reject(new Error('Failed to load heic2any from CDN'));
                document.head.appendChild(script);
            });
        }
        return heic2anyLoadingPromise;
    }
    /**
     * Decode HEIC/HEIF files to a lossless PNG Blob.
     * Tries native createImageBitmap first (Safari / macOS), falling back to heic2any.
     * @param {File|Blob} file
     * @returns {Promise<Blob>}
     */
    async function decodeHeicToBlob(file) {
        if (typeof createImageBitmap === 'function') {
            try {
                const bitmap = await createImageBitmap(file);
                if (bitmap && bitmap.width > 0 && bitmap.height > 0) {
                    const canvas = document.createElement('canvas');
                    canvas.width = bitmap.width;
                    canvas.height = bitmap.height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(bitmap, 0, 0);
                    if (typeof bitmap.close === 'function')
                        bitmap.close();
                    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
                    if (blob)
                        return blob;
                }
            }
            catch {
                // Native decoding failed or unsupported; fall through to heic2any
            }
        }
        const heic2any = await loadHeic2Any();
        const result = await heic2any({
            blob: file,
            toType: 'image/png'
        });
        return Array.isArray(result) ? result[0] : result;
    }
    /**
     * Decode a File or Blob to raw RGBA ImageData buffer via createImageBitmap.
     * Uses { premultiplyAlpha: 'none', colorSpaceConversion: 'default' } to guarantee
     * 100% EXIF, GPS, and camera metadata stripping before WebP encoding.
     * Immediately calls bitmap.close() to free GPU/native resources.
     *
     * @param {Blob|File} blob
     * @returns {Promise<{ rgbaBuffer: ArrayBuffer, width: number, height: number }>}
     */
    async function decodeBlobToRawRgba(blob) {
        if (typeof createImageBitmap !== 'function') {
            throw new Error('createImageBitmap is not supported in this browser environment');
        }
        const bitmap = await createImageBitmap(blob, {
            premultiplyAlpha: 'none',
            colorSpaceConversion: 'default'
        });
        const width = bitmap.width;
        const height = bitmap.height;
        let imageData = null;
        if (typeof OffscreenCanvas !== 'undefined') {
            try {
                const offscreen = new OffscreenCanvas(width, height);
                const ctx = offscreen.getContext('2d', { willReadFrequently: true });
                if (ctx) {
                    ctx.drawImage(bitmap, 0, 0);
                    imageData = ctx.getImageData(0, 0, width, height);
                }
            }
            catch {
                // Fallback to DOM canvas
            }
        }
        if (!imageData) {
            if (typeof document === 'undefined') {
                if (typeof bitmap.close === 'function')
                    bitmap.close();
                throw new Error('DOM canvas not available to extract raw pixel data');
            }
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (!ctx) {
                if (typeof bitmap.close === 'function')
                    bitmap.close();
                throw new Error('Unable to create 2D canvas context');
            }
            ctx.drawImage(bitmap, 0, 0);
            imageData = ctx.getImageData(0, 0, width, height);
        }
        // Immediately close the bitmap to release memory/texture
        if (typeof bitmap.close === 'function') {
            bitmap.close();
        }
        return {
            rgbaBuffer: imageData.data.buffer,
            width,
            height
        };
    }
    // --- Web Worker WebP Pipeline Management ---
    let encoderWorker = null;
    if (typeof window !== 'undefined' && window.__r59_encoder_worker) {
        encoderWorker = window.__r59_encoder_worker;
    }
    let nextMessageId = 1;
    const pendingRequests = new Map();
    function getEncoderWorker() {
        if (!encoderWorker) {
            if (typeof window !== 'undefined' && window.__r59_encoder_worker) {
                encoderWorker = window.__r59_encoder_worker;
                return encoderWorker;
            }
            if (typeof Worker === 'undefined') {
                throw new Error('Web Workers are not supported in this environment');
            }
            const workerUrl = typeof window !== 'undefined' && window.location
                ? new URL('/admin/assets/js/webpEncoder.worker.js', window.location.origin).href
                : '/admin/assets/js/webpEncoder.worker.js';
            encoderWorker = new Worker(workerUrl, { type: 'module' });
            if (typeof window !== 'undefined') {
                window.__r59_encoder_worker = encoderWorker;
            }
            encoderWorker.onmessage = function (e) {
                const data = e.data;
                if (!data || typeof data !== 'object')
                    return;
                const { id, success, webpBuffer, width, height, error } = data;
                const pending = pendingRequests.get(id);
                if (pending) {
                    pendingRequests.delete(id);
                    if (success && webpBuffer) {
                        pending.resolve({ webpBuffer, width, height });
                    }
                    else {
                        pending.reject(new Error(error || 'Worker WebP encoding failed'));
                    }
                }
            };
            encoderWorker.onerror = function (err) {
                console.warn('[R59 Admin] Encoder worker error:', err);
                for (const [, pending] of pendingRequests.entries()) {
                    pending.reject(new Error(`Encoder worker terminated: ${err?.message || 'Worker error'}`));
                }
                pendingRequests.clear();
                try {
                    encoderWorker.terminate();
                }
                catch { }
                encoderWorker = null;
                if (typeof window !== 'undefined') {
                    delete window.__r59_encoder_worker;
                }
            };
        }
        return encoderWorker;
    }
    function encodeViaWorker(rgbaBuffer, width, height, targetWidth, targetHeight, timeoutMs = 60000, quality = 0.92) {
        const normalizedQuality = Math.max(1, Math.min(100, Math.round(quality <= 1 ? quality * 100 : quality)));
        return new Promise((resolve, reject) => {
            try {
                const worker = getEncoderWorker();
                const id = nextMessageId++;
                const timer = setTimeout(() => {
                    if (pendingRequests.has(id)) {
                        pendingRequests.delete(id);
                        reject(new Error(`WebP worker encoding timed out after ${timeoutMs}ms`));
                    }
                }, timeoutMs);
                pendingRequests.set(id, {
                    resolve: (data) => {
                        clearTimeout(timer);
                        resolve(data);
                    },
                    reject: (err) => {
                        clearTimeout(timer);
                        reject(err);
                    }
                });
                worker.postMessage({ id, rgbaBuffer, width, height, targetWidth, targetHeight, quality: normalizedQuality }, [rgbaBuffer]);
            }
            catch (err) {
                reject(err);
            }
        });
    }
    // --- Fallback Canvas Encoder ---
    /**
     * Graceful fallback to HTML5 Canvas 2D encoding at 0.92 quality.
     * Used if WebAssembly/Web Worker is blocked (e.g. strict CSP) or encounters a runtime fault.
     *
     * @param {Blob|File} blob
     * @param {number} [maxDimension=2560]
     * @param {number} [quality=0.92]
     * @returns {Promise<{ webpBlob: Blob, width: number, height: number, canvas: HTMLCanvasElement }>}
     */
    async function canvasFallbackEncode(blob, maxDimension = 2560, quality = 0.92) {
        let bitmap;
        if (typeof createImageBitmap === 'function') {
            bitmap = await createImageBitmap(blob);
        }
        else {
            bitmap = await new Promise((resolve, reject) => {
                if (typeof Image === 'undefined') {
                    return reject(new Error('Neither createImageBitmap nor Image is available for canvas fallback'));
                }
                const url = URL.createObjectURL(blob);
                const img = new Image();
                img.onload = () => {
                    URL.revokeObjectURL(url);
                    resolve(img);
                };
                img.onerror = () => {
                    URL.revokeObjectURL(url);
                    reject(new Error('Failed to decode image via HTMLImageElement'));
                };
                img.src = url;
            });
        }
        let width = bitmap.naturalWidth || bitmap.width;
        let height = bitmap.naturalHeight || bitmap.height;
        if (!width || !height) {
            if (typeof bitmap.close === 'function')
                bitmap.close();
            throw new Error('Invalid bitmap dimensions for canvas fallback');
        }
        if (Number.isFinite(maxDimension) && Math.max(width, height) > maxDimension) {
            const scale = maxDimension / Math.max(width, height);
            width = Math.round(width * scale);
            height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(bitmap, 0, 0, width, height);
        }
        if (typeof bitmap.close === 'function') {
            bitmap.close();
        }
        const webpBlob = await new Promise((resolve, reject) => {
            canvas.toBlob(b => {
                if (b)
                    resolve(b);
                else
                    reject(new Error('Canvas failed to encode image to WebP'));
            }, 'image/webp', quality);
        });
        return { webpBlob, width, height, canvas };
    }
    /**
     * Backwards-compatible bitmap-to-webp helper.
     */
    async function bitmapToWebPBlob(bitmap, maxDimension = 2560, quality = 0.92) {
        let width = bitmap.naturalWidth || bitmap.width;
        let height = bitmap.naturalHeight || bitmap.height;
        if (Number.isFinite(maxDimension) && Math.max(width, height) > maxDimension) {
            const scale = maxDimension / Math.max(width, height);
            width = Math.round(width * scale);
            height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(bitmap, 0, 0, width, height);
        }
        if (typeof bitmap.close === 'function') {
            bitmap.close();
        }
        const webpBlob = await new Promise((resolve, reject) => {
            canvas.toBlob(blob => {
                if (blob)
                    resolve(blob);
                else
                    reject(new Error('Canvas failed to encode image to WebP'));
            }, 'image/webp', quality);
        });
        return { webpBlob, width, height, canvas };
    }
    /**
     * Convert any supported image (JPG, PNG, WebP, GIF, AVIF, BMP, HEIC, Camera RAW, etc.)
     * into a visually lossless WebP File (quality = 0.92, max 2560px on longest edge).
     *
     * Uses C-Wasm libwebp & lanczos3 pipeline via dedicated Web Worker with graceful
     * canvas 2D fallback.
     *
     * @param {File} file - Source file
     * @param {number|Object} [options] - Quality number (e.g. 0.92) or options object
     * @param {number} [options.maxDimension=2560] - Max dimension on longest edge (default 2560px)
     * @param {number} [options.quality=0.92] - WebP encoding quality (default 0.92)
     * @returns {Promise<{
     *   file: File,
     *   blob: Blob,
     *   originalSize: number,
     *   convertedSize: number,
     *   width: number,
     *   height: number,
     *   sourceFormat: string
     * }>}
     */
    async function convertToWebP(file, options = {}) {
        const opts = typeof options === 'number' ? { quality: options } : (options || {});
        const maxDimension = opts.maxDimension !== undefined ? opts.maxDimension : 2560;
        const requestedQuality = opts.quality !== undefined ? opts.quality : 0.92;
        const name = file.name || 'image';
        const lastDot = name.lastIndexOf('.');
        const baseName = lastDot > 0 ? name.slice(0, lastDot) : name;
        const ext = (lastDot > 0 ? name.slice(lastDot + 1) : '').toLowerCase();
        let sourceFormat = ext || (file.type ? file.type.replace('image/', '') : 'unknown');
        let workingBlob = file;
        // 1. Format-specific preprocessing (RAW embedded JPEG extraction, HEIC decoding)
        if (RAW_EXTENSIONS.has(ext)) {
            sourceFormat = `raw (${ext.toUpperCase()})`;
            const arrayBuffer = await file.arrayBuffer();
            workingBlob = extractLargestEmbeddedJpeg(arrayBuffer);
        }
        else if (HEIC_EXTENSIONS.has(ext) || file.type === 'image/heic' || file.type === 'image/heif') {
            sourceFormat = ext || 'heic';
            workingBlob = await decodeHeicToBlob(file);
        }
        let webpBlob = null;
        let finalWidth = 0;
        let finalHeight = 0;
        // 2. Primary Path: Decode via createImageBitmap (100% EXIF/GPS stripping) and encode via C-Wasm Worker
        try {
            const { rgbaBuffer, width, height } = await decodeBlobToRawRgba(workingBlob);
            let targetWidth = width;
            let targetHeight = height;
            if (Number.isFinite(maxDimension) && Math.max(width, height) > maxDimension) {
                const scale = maxDimension / Math.max(width, height);
                targetWidth = Math.round(width * scale);
                targetHeight = Math.round(height * scale);
            }
            const workerRes = await encodeViaWorker(rgbaBuffer, width, height, targetWidth, targetHeight, 60000, requestedQuality);
            webpBlob = new Blob([workerRes.webpBuffer], { type: 'image/webp' });
            finalWidth = workerRes.width;
            finalHeight = workerRes.height;
        }
        catch (wasmErr) {
            console.warn('[R59 Admin] C-Wasm WebP Worker pipeline unavailable or failed; executing Canvas fallback:', wasmErr);
            // 3. Graceful fallback: HTML5 <canvas> 0.92 encoding
            const fallbackRes = await canvasFallbackEncode(workingBlob, maxDimension, requestedQuality);
            webpBlob = fallbackRes.webpBlob;
            finalWidth = fallbackRes.width;
            finalHeight = fallbackRes.height;
        }
        const webpFile = new File([webpBlob], `${baseName}.webp`, {
            type: 'image/webp',
            lastModified: Date.now()
        });
        const result = {
            file: webpFile,
            blob: webpBlob,
            originalSize: file.size || workingBlob.size || 0,
            convertedSize: webpFile.size,
            width: finalWidth,
            height: finalHeight,
            sourceFormat
        };
        // Attach properties to File and Blob for universal caller interoperability
        Object.assign(webpFile, result);
        Object.assign(webpBlob, result);
        return result;
    }
    /**
     * Public signature: fileToWebp(file, options)
     * Alias / wrapper matching existing exported contract.
     *
     * @param {File} file
     * @param {Object} [options]
     * @returns {Promise<File>} File object augmented with conversion metadata
     */
    async function fileToWebp(file, options = {}) {
        const res = await convertToWebP(file, options);
        return res.file;
    }
    /**
     * Public signature: blobToWebp(blob, options)
     * Converts a Blob to WebP.
     *
     * @param {Blob} blob
     * @param {Object} [options]
     * @returns {Promise<Blob>} Blob object augmented with conversion metadata
     */
    async function blobToWebp(blob, options = {}) {
        const file = blob instanceof File
            ? blob
            : new File([blob], 'image.blob', { type: blob.type || 'image/png' });
        const res = await convertToWebP(file, options);
        return res.blob;
    }
    const webpConverter = {
        SUPPORTED_EXTENSIONS,
        RAW_EXTENSIONS,
        HEIC_EXTENSIONS,
        isSupportedImageFile,
        extractLargestEmbeddedJpeg,
        decodeHeicToBlob,
        decodeBlobToRawRgba,
        bitmapToWebPBlob,
        canvasFallbackEncode,
        convertToWebP,
        fileToWebp,
        blobToWebp
    };
    // Window global registration for zero-build script environments
    if (typeof window !== 'undefined') {
        window.R59 = window.R59 || {};
        window.R59.webpConverter = webpConverter;
    }
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = webpConverter;
    }
})();
