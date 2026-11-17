#!/usr/bin/env node --experimental-strip-types

/**
 * Phase 4: Static Photographic Asset Re-Optimization
 *
 * Re-encodes photographic assets across frontend/src/assets/ using
 * @jsquash/webp and @jsquash/resize with the Pristine Studio Preset:
 * - quality: 92
 * - method: 6
 * - pass: 10
 * - use_sharp_yuv: 1
 * - sns_strength: 80
 * - filter_sharpness: 4
 * - filter_strength: 25
 * - autofilter: 1
 * - preprocessing: 4
 * - alpha_compression: 1
 * - max dimension: 2560px (Lanczos3 downscaling with linear-light premultiplication)
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

interface WebpEncodeOptions {
  quality: number;
  method: number;
  pass: number;
  use_sharp_yuv: number;
  sns_strength: number;
  filter_sharpness: number;
  filter_strength: number;
  autofilter: number;
  preprocessing: number;
  alpha_compression: number;
}

interface ResizeOptions {
  width: number;
  height: number;
  method: string;
  premultiply: boolean;
  linearRGB: boolean;
}

interface ProcessResult {
  filePath: string;
  destPath: string;
  origW: number;
  origH: number;
  newW: number;
  newH: number;
  origSize: number;
  newSize: number;
}

type DecodeWebpFn = (buffer: ArrayBuffer | Uint8Array) => Promise<ImageData>;
type EncodeWebpFn = (data: ImageData, options: WebpEncodeOptions) => Promise<ArrayBuffer>;
type ResizeFn = (data: ImageData, options: ResizeOptions) => Promise<ImageData>;
type InitWasmFn = (module: WebAssembly.Module) => Promise<unknown>;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Import jsquash modules from admin/node_modules
const { init: initDecode, default: decodeWebp } = (await import(
  path.join(rootDir, 'admin/node_modules/@jsquash/webp/decode.js')
)) as { init: InitWasmFn; default: DecodeWebpFn };
const { init: initEncode, default: encodeWebp } = (await import(
  path.join(rootDir, 'admin/node_modules/@jsquash/webp/encode.js')
)) as { init: InitWasmFn; default: EncodeWebpFn };
const { initResize, default: resize } = (await import(
  path.join(rootDir, 'admin/node_modules/@jsquash/resize/index.js')
)) as { initResize: InitWasmFn; default: ResizeFn };

// Pristine Studio Preset WebP configuration
const PRISTINE_STUDIO_PRESET: WebpEncodeOptions = {
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

// Initialize wasm modules using compiled WebAssembly modules from disk
async function initModules(): Promise<void> {
  const decWasmBytes = fs.readFileSync(
    path.join(rootDir, 'admin/node_modules/@jsquash/webp/codec/dec/webp_dec.wasm')
  );
  const encWasmBytes = fs.readFileSync(
    path.join(rootDir, 'admin/node_modules/@jsquash/webp/codec/enc/webp_enc_simd.wasm')
  );
  const resizeWasmBytes = fs.readFileSync(
    path.join(rootDir, 'admin/node_modules/@jsquash/resize/lib/resize/pkg/squoosh_resize_bg.wasm')
  );

  const [decMod, encMod, resizeMod] = await Promise.all([
    WebAssembly.compile(decWasmBytes),
    WebAssembly.compile(encWasmBytes),
    WebAssembly.compile(resizeWasmBytes),
  ]);

  await Promise.all([
    initDecode(decMod),
    initEncode(encMod),
    initResize(resizeMod),
  ]);
}

/**
 * Load an image file into ImageData { data, width, height }
 */
async function loadImageData(filePath: string): Promise<ImageData> {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.webp') {
    const buf = fs.readFileSync(filePath);
    return await decodeWebp(buf);
  }

  // For JPEG or PNG, decode to raw RGBA via magick
  const rawRgba = execFileSync('magick', [filePath, '-depth', '8', 'rgba:-'], {
    maxBuffer: 100 * 1024 * 1024,
  });
  const sizeStr = execFileSync('magick', ['identify', '-format', '%w %h', filePath], {
    encoding: 'utf8',
  });
  const [width, height] = sizeStr.trim().split(' ').map(Number);
  return new ImageData(
    new Uint8ClampedArray(rawRgba.buffer, rawRgba.byteOffset, rawRgba.byteLength),
    width,
    height
  );
}

/**
 * Process a single image file
 */
async function processImage(filePath: string, destPath: string = filePath): Promise<ProcessResult> {
  const relPath = path.relative(rootDir, filePath);
  const initialStat = fs.existsSync(destPath) ? fs.statSync(destPath).size : fs.statSync(filePath).size;

  const imgData = await loadImageData(filePath);
  const origW = imgData.width;
  const origH = imgData.height;

  let finalW = origW;
  let finalH = origH;
  if (origW > MAX_DIMENSION || origH > MAX_DIMENSION) {
    const scale = MAX_DIMENSION / Math.max(origW, origH);
    finalW = Math.round(origW * scale);
    finalH = Math.round(origH * scale);
  }

  let prepared = imgData;
  if (finalW !== origW || finalH !== origH) {
    prepared = await resize(imgData, {
      width: finalW,
      height: finalH,
      method: 'lanczos3',
      premultiply: true,
      linearRGB: true,
    });
  }

  const encoded = await encodeWebp(prepared, PRISTINE_STUDIO_PRESET);
  fs.writeFileSync(destPath, Buffer.from(encoded));

  const newStat = fs.statSync(destPath).size;
  const saved = initialStat - newStat;
  const pct = initialStat > 0 ? ((saved / initialStat) * 100).toFixed(1) : '0';

  console.log(
    `✓ ${relPath} [${origW}x${origH} → ${prepared.width}x${prepared.height}] ${(initialStat / 1024).toFixed(1)}KB → ${(newStat / 1024).toFixed(1)}KB (${pct}% saved)`
  );

  return {
    filePath,
    destPath,
    origW,
    origH,
    newW: prepared.width,
    newH: prepared.height,
    origSize: initialStat,
    newSize: newStat,
  };
}

async function main(): Promise<void> {
  console.log('Initializing Pristine Studio Re-Encoder via @jsquash/webp and @jsquash/resize...');
  await initModules();
  console.log('Modules initialized successfully.\n');

  // Photographic asset targets
  const targets: string[] = [
    // Hero images
    'frontend/src/assets/heroImages/heroImg1.webp',
    'frontend/src/assets/heroImages/heroImg2.webp',
    'frontend/src/assets/heroImages/heroImg3.webp',
    'frontend/src/assets/heroImages/heroImg4.webp',

    // Recent photoshoot photos
    'frontend/src/assets/mrphshImages/mrphsh_img01.webp',
    'frontend/src/assets/mrphshImages/mrphsh_img02.webp',
    'frontend/src/assets/mrphshImages/mrphsh_img03.webp',
    'frontend/src/assets/mrphshImages/mrphsh_img04.webp',
    'frontend/src/assets/mrphshImages/mrphsh_img05.webp',
    'frontend/src/assets/mrphshImages/mrphsh_img06.webp',
    'frontend/src/assets/mrphshImages/mrphsh_img07.webp',
    'frontend/src/assets/mrphshImages/mrphsh_img08.webp',
    'frontend/src/assets/mrphshImages/mrphsh_img09.webp',

    // About me photographic assets
    'frontend/src/assets/aboutMeImages/128MmrCard_IMG.webp',
    'frontend/src/assets/aboutMeImages/1TMmrCard_IMG.webp',
    'frontend/src/assets/aboutMeImages/r59media-32memCard.webp',
    'frontend/src/assets/aboutMeImages/EOS-90D-top-w-lens 2.webp',
    'frontend/src/assets/aboutMeImages/about-paper.webp',
    'frontend/src/assets/aboutMeImages/aboutMe_portraitFrame_img.webp',
    'frontend/src/assets/aboutMeImages/bigLense_IMG.webp',
    "frontend/src/assets/aboutMeImages/kevin'sPortrait.webp",
    'frontend/src/assets/aboutMeImages/kevin_Logo_IMG.webp',
    'frontend/src/assets/aboutMeImages/r59media-dslr.webp',
    'frontend/src/assets/aboutMeImages/r59media-large-lens.webp',
    'frontend/src/assets/aboutMeImages/r59media-medium-lens.webp',
    'frontend/src/assets/aboutMeImages/redCard_img.webp',
    'frontend/src/assets/aboutMeImages/r59media-speedlight.webp',
    'frontend/src/assets/aboutMeImages/yellowCard_img.webp',
  ];

  let totalOrigSize = 0;
  let totalNewSize = 0;

  for (const rel of targets) {
    const full = path.join(rootDir, rel);
    if (fs.existsSync(full)) {
      const res = await processImage(full, full);
      totalOrigSize += res.origSize;
      totalNewSize += res.newSize;
    }
  }

  // Also convert booking/session-paper.jpeg -> session-paper.webp (and optimize session-paper.jpeg)
  const sessionPaperJpeg = path.join(rootDir, 'frontend/src/assets/booking/session-paper.jpeg');
  const sessionPaperWebp = path.join(rootDir, 'frontend/src/assets/booking/session-paper.webp');
  if (fs.existsSync(sessionPaperJpeg)) {
    console.log('\nProcessing booking session paper texture:');
    const resWebp = await processImage(sessionPaperJpeg, sessionPaperWebp);
    totalOrigSize += resWebp.origSize;
    totalNewSize += resWebp.newSize;

    // Also optimize session-paper.jpeg in-place to max 2560px for complete link safety
    const origJpegSize = fs.statSync(sessionPaperJpeg).size;
    execFileSync('magick', [
      sessionPaperJpeg,
      '-resize', '2560x2560>',
      '-quality', '92',
      sessionPaperJpeg,
    ]);
    const newJpegSize = fs.statSync(sessionPaperJpeg).size;
    console.log(
      `✓ frontend/src/assets/booking/session-paper.jpeg [resized <= 2560px] ${(origJpegSize / 1024).toFixed(1)}KB → ${(newJpegSize / 1024).toFixed(1)}KB`
    );
  }

  console.log('\n================ Re-Optimization Summary ================');
  console.log(`Original total:  ${(totalOrigSize / (1024 * 1024)).toFixed(2)} MB`);
  console.log(`Optimized total: ${(totalNewSize / (1024 * 1024)).toFixed(2)} MB`);
  const saved = totalOrigSize - totalNewSize;
  console.log(`Total saved:     ${(saved / (1024 * 1024)).toFixed(2)} MB (${((saved / totalOrigSize) * 100).toFixed(1)}%)`);
  console.log('=========================================================\n');
}

main().catch((err: unknown) => {
  console.error('Fatal error during asset re-optimization:', err);
  process.exit(1);
});
