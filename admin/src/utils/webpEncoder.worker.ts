/// <reference lib="webworker" />
/**
 * R59 Admin — Dedicated C-Wasm WebP Encoder Worker
 * 
 * Off-main-thread image processing pipeline:
 * - Fetches wasm binaries strictly from 'self' (/admin/assets/wasm/)
 * - Lanczos3 high-fidelity downscaling with linear-light premultiplication via @jsquash/resize
 * - C-Wasm libwebp encoding using Pristine Studio Preset via @jsquash/webp
 * - Zero-copy Transferable ArrayBuffer responses
 */

import encode, { init as initWebp } from '@jsquash/webp/encode.js';
import resize, { initResize } from '@jsquash/resize';

// Pristine Studio Preset WebP configuration
const PRISTINE_STUDIO_PRESET = {
  quality: 92,
  method: 6,
  pass: 10,
  use_sharp_yuv: 1,
  sns_strength: 80,
  filter_sharpness: 4,
  filter_strength: 25,
  autofilter: 1,
  preprocessing: 4,
  alpha_compression: 1,
};

const MAX_DIMENSION = 2560;

let initPromise: Promise<void> | null = null;

/**
 * Detect WebAssembly 128-bit SIMD support via binary validation.
 */
async function supportsWasmSimd(): Promise<boolean> {
  try {
    return WebAssembly.validate(
      new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11])
    );
  } catch {
    return false;
  }
}

/**
 * Initialize WebAssembly modules by fetching binaries locally from self (/admin/assets/wasm/).
 * Never loads from external CDNs.
 */
async function initModules(): Promise<void> {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const hasSimd = await supportsWasmSimd();
    const webpWasmPath = hasSimd
      ? '/admin/assets/wasm/webp_enc_simd.wasm'
      : '/admin/assets/wasm/webp_enc.wasm';
    const resizeWasmPath = '/admin/assets/wasm/squoosh_resize_bg.wasm';

    const [webpRes, resizeRes] = await Promise.all([
      fetch(webpWasmPath, { credentials: 'omit' }),
      fetch(resizeWasmPath, { credentials: 'omit' })
    ]);

    if (!webpRes.ok) {
      throw new Error(`Failed to load WebP wasm binary from ${webpWasmPath} (HTTP ${webpRes.status})`);
    }
    if (!resizeRes.ok) {
      throw new Error(`Failed to load Resize wasm binary from ${resizeWasmPath} (HTTP ${resizeRes.status})`);
    }

    const [webpBytes, resizeBytes] = await Promise.all([
      webpRes.arrayBuffer(),
      resizeRes.arrayBuffer()
    ]);

    const [webpModule, resizeModule] = await Promise.all([
      WebAssembly.compile(webpBytes),
      WebAssembly.compile(resizeBytes)
    ]);

    await Promise.all([
      initWebp(webpModule),
      initResize(resizeModule)
    ]);
  })();

  return initPromise;
}

export interface WorkerInputPayload {
  id?: number | string;
  rgbaBuffer: ArrayBuffer;
  width: number;
  height: number;
  targetWidth?: number;
  targetHeight?: number;
}

self.onmessage = async (e: MessageEvent<WorkerInputPayload>) => {
  const { id, rgbaBuffer, width, height, targetWidth, targetHeight } = e.data;

  try {
    if (!rgbaBuffer || !width || !height) {
      throw new Error('Invalid worker input: rgbaBuffer, width, and height are required');
    }

    await initModules();

    // Determine target dimensions
    let finalWidth = targetWidth;
    let finalHeight = targetHeight;

    if (!finalWidth || !finalHeight) {
      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        const scale = MAX_DIMENSION / Math.max(width, height);
        finalWidth = Math.round(width * scale);
        finalHeight = Math.round(height * scale);
      } else {
        finalWidth = width;
        finalHeight = height;
      }
    }

    const needsResize = (width > MAX_DIMENSION || height > MAX_DIMENSION) ||
      (finalWidth !== width || finalHeight !== height);

    const initialImageData = new ImageData(
      new Uint8ClampedArray(rgbaBuffer),
      width,
      height
    );

    let preparedImageData: ImageData;

    if (needsResize && (finalWidth !== width || finalHeight !== height)) {
      // Lanczos3 resize with linear-light premultiplication
      preparedImageData = await resize(initialImageData, {
        width: finalWidth,
        height: finalHeight,
        method: 'lanczos3',
        premultiply: true,
        linearRGB: true
      });
    } else {
      preparedImageData = initialImageData;
    }

    // Encode via @jsquash/webp using the Pristine Studio Preset
    const webpBuffer = await encode(preparedImageData, PRISTINE_STUDIO_PRESET);

    // Return compressed WebP ArrayBuffer via Transferable postMessage
    (self as unknown as Worker).postMessage(
      {
        id,
        success: true,
        webpBuffer,
        width: preparedImageData.width,
        height: preparedImageData.height
      },
      [webpBuffer]
    );
  } catch (err: any) {
    (self as unknown as Worker).postMessage({
      id,
      success: false,
      error: err?.message || String(err)
    });
  }
};
