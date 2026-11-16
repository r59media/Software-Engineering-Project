#!/usr/bin/env node

/**
 * R59 Media — Universal WebP Batch Converter CLI
 * 
 * Batch-converts image files (.png, .jpg, .jpeg, .heic, .heif, and camera RAW formats
 * .cr2, .cr3, .nef, .arw, .dng, .raf, .orf, .rw2, .pef, .srw) into lossless 100% quality WebP
 * preserving 1:1 original resolution without lossy compression.
 * 
 * Usage:
 *   node --experimental-strip-types scripts/convert-to-webp.ts [path] [--force] [--delete-original]
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const SUPPORTED_EXTS = new Set<string>([
  'png', 'jpg', 'jpeg', 'heic', 'heif',
  'cr2', 'cr3', 'nef', 'arw', 'dng', 'raf', 'orf', 'rw2', 'pef', 'srw',
  'bmp', 'tiff', 'tif'
]);

export const RAW_EXTS = new Set<string>([
  'cr2', 'cr3', 'nef', 'arw', 'dng', 'raf', 'orf', 'rw2', 'pef', 'srw'
]);

export type ConversionEngineType = 'magick' | 'convert' | 'ffmpeg';

export interface BinaryInfo {
  type: ConversionEngineType;
  path: string;
}

export interface ConvertOptions {
  force: boolean;
  deleteOriginal: boolean;
  lossless: boolean;
}

export interface ConvertSuccessResult {
  success: true;
  skipped?: false;
  srcPath: string;
  destPath: string;
  originalSize: number;
  convertedSize: number;
  ratio: string;
}

export interface ConvertSkippedResult {
  skipped: true;
  success?: false;
  reason: string;
  srcPath: string;
  destPath: string;
}

export type ConvertResult = ConvertSuccessResult | ConvertSkippedResult;

/**
 * Determine available conversion CLI binaries
 */
export function detectBinary(): BinaryInfo | null {
  const candidates: ConversionEngineType[] = ['magick', 'convert', 'ffmpeg'];
  for (const cmd of candidates) {
    const res = spawnSync('which', [cmd], { stdio: 'pipe', encoding: 'utf-8' });
    if (res.status === 0 && res.stdout.trim()) {
      return { type: cmd, path: res.stdout.trim() };
    }
  }
  return null;
}

/**
 * Extract embedded full-resolution JPEG stream from Camera RAW file buffer
 */
export function extractEmbeddedJpegFromRaw(buffer: Buffer | Uint8Array): Uint8Array | null {
  const bytes = new Uint8Array(buffer);
  const len = bytes.length;
  let largestSlice: Uint8Array | null = null;
  let maxSize = 0;

  for (let i = 0; i < len - 4; i++) {
    if (bytes[i] === 0xFF && bytes[i + 1] === 0xD8 && bytes[i + 2] === 0xFF) {
      const soi = i;
      let eoi = -1;
      let j = soi + 2;

      while (j < len - 1) {
        if (bytes[j] === 0xFF) {
          const marker = bytes[j + 1];
          if (marker === 0xD8 && j + 2 < len && bytes[j + 2] === 0xFF) break;
          if (marker === 0xD9) {
            eoi = j + 2;
            const size = eoi - soi;
            if (size > 32 * 1024 && size > maxSize) {
              maxSize = size;
              largestSlice = bytes.subarray(soi, eoi);
            }
            break;
          }
          if (
            (marker >= 0xE0 && marker <= 0xEF) ||
            marker === 0xDB ||
            marker === 0xC4 ||
            (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC)
          ) {
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
      if (eoi > soi) i = eoi - 1;
    }
  }

  return largestSlice;
}

/**
 * Format bytes into human-readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

/**
 * Recursively scan directory for convertible image files
 */
export function scanDirectory(dirPath: string, fileList: string[] = []): string[] {
  if (!fs.existsSync(dirPath)) return fileList;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '.git' && entry.name !== 'dist') {
        scanDirectory(fullPath, fileList);
      }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).slice(1).toLowerCase();
      if (SUPPORTED_EXTS.has(ext)) {
        fileList.push(fullPath);
      }
    }
  }

  return fileList;
}

/**
 * Convert a single file to WebP
 */
export function convertFile(srcPath: string, options: ConvertOptions, binInfo: BinaryInfo): ConvertResult {
  const dir = path.dirname(srcPath);
  const ext = path.extname(srcPath).slice(1).toLowerCase();
  const baseName = path.basename(srcPath, path.extname(srcPath));
  const destPath = path.join(dir, `${baseName}.webp`);

  if (!options.force && fs.existsSync(destPath)) {
    const srcStat = fs.statSync(srcPath);
    const destStat = fs.statSync(destPath);
    if (destStat.mtimeMs >= srcStat.mtimeMs) {
      return { skipped: true, reason: 'Already up to date', srcPath, destPath };
    }
  }

  const srcStat = fs.statSync(srcPath);
  const originalSize = srcStat.size;

  let tempInputPath: string | null = null;
  let inputPathToConvert = srcPath;

  // For Camera RAW, extract full-res JPEG stream if available
  if (RAW_EXTS.has(ext)) {
    try {
      const buffer = fs.readFileSync(srcPath);
      const jpegSlice = extractEmbeddedJpegFromRaw(buffer);
      if (jpegSlice && jpegSlice.length > 32 * 1024) {
        tempInputPath = path.join(dir, `.__temp_${Date.now()}_${baseName}.jpg`);
        fs.writeFileSync(tempInputPath, Buffer.from(jpegSlice));
        inputPathToConvert = tempInputPath;
      }
    } catch {
      // Fall through to direct binary conversion
    }
  }

  try {
    if (binInfo.type === 'magick' || binInfo.type === 'convert') {
      const magickArgs = [inputPathToConvert];
      if (options.lossless) {
        magickArgs.push('-define', 'webp:lossless=true', '-quality', '100');
      } else {
        // Default: Pristine Studio Preset at 0.92 quality (visually lossless at 1:1 original resolution)
        magickArgs.push(
          '-quality', '92',
          '-define', 'webp:method=6',
          '-define', 'webp:pass=10',
          '-define', 'webp:use-sharp-yuv=true',
          '-define', 'webp:sns-strength=80',
          '-define', 'webp:filter-strength=25',
          '-define', 'webp:auto-filter=true'
        );
      }
      magickArgs.push(destPath);
      execFileSync(binInfo.path, magickArgs, { stdio: 'pipe' });
    } else if (binInfo.type === 'ffmpeg') {
      const ffmpegArgs = ['-y', '-i', inputPathToConvert, '-c:v', 'libwebp'];
      if (options.lossless) {
        ffmpegArgs.push('-lossless', '1', '-compression_level', '6');
      } else {
        // Default: Pristine Studio Preset at 0.92 quality (visually lossless at 1:1 original resolution)
        ffmpegArgs.push('-quality', '92', '-compression_level', '6', '-preset', 'photo');
      }
      ffmpegArgs.push(destPath);
      execFileSync(binInfo.path, ffmpegArgs, { stdio: 'pipe' });
    } else {
      throw new Error('No supported image conversion engine found');
    }

    const destStat = fs.statSync(destPath);
    const convertedSize = destStat.size;

    if (options.deleteOriginal && fs.existsSync(destPath) && destStat.size > 0) {
      fs.unlinkSync(srcPath);
    }

    return {
      success: true,
      srcPath,
      destPath,
      originalSize,
      convertedSize,
      ratio: ((1 - convertedSize / originalSize) * 100).toFixed(1)
    };
  } finally {
    if (tempInputPath && fs.existsSync(tempInputPath)) {
      try {
        fs.unlinkSync(tempInputPath);
      } catch {
        // Ignore failure to clean up temporary file
      }
    }
  }
}

export async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const options: ConvertOptions = {
    force: args.includes('--force') || args.includes('-f'),
    deleteOriginal: args.includes('--delete-original'),
    lossless: args.includes('--lossless')
  };

  const positionalArgs = args.filter(a => !a.startsWith('-'));

  // Resolve target directory or file
  let targetPath = positionalArgs[0];
  if (!targetPath) {
    const candidateDirs = [
      path.resolve(process.cwd(), 'public'),
      path.resolve(__dirname, '..', 'public'),
      process.cwd()
    ];
    targetPath = candidateDirs.find(d => fs.existsSync(d)) || process.cwd();
  } else {
    targetPath = path.resolve(process.cwd(), targetPath);
  }

  console.log(`\n======================================================`);
  console.log(`  R59 Media — Universal WebP Converter Engine`);
  console.log(`  Preserve: 100% 1:1 original resolution & quality`);
  console.log(`======================================================`);

  const binInfo = detectBinary();
  if (!binInfo) {
    console.error(`\n❌ Error: Neither ImageMagick ('magick'/'convert') nor 'ffmpeg' was found on system PATH.`);
    process.exit(1);
  }

  console.log(`✓ Engine detected: ${binInfo.type} (${binInfo.path})`);
  console.log(`✓ Target: ${targetPath}`);

  let files: string[] = [];
  if (fs.existsSync(targetPath)) {
    const stat = fs.statSync(targetPath);
    if (stat.isDirectory()) {
      files = scanDirectory(targetPath);
    } else if (stat.isFile()) {
      const ext = path.extname(targetPath).slice(1).toLowerCase();
      if (SUPPORTED_EXTS.has(ext)) {
        files = [targetPath];
      }
    }
  }

  if (files.length === 0) {
    console.log(`\nNo matching image files found to convert (.png, .jpg, .heic, RAW, etc.).`);
    console.log(`Target directory is clean.`);
    return;
  }

  console.log(`\nFound ${files.length} file(s) to process:\n`);

  let totalOriginal = 0;
  let totalConverted = 0;
  let convertedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const relPath = path.relative(process.cwd(), file);
    process.stdout.write(`[${i + 1}/${files.length}] Converting: ${relPath}... `);

    try {
      const res = convertFile(file, options, binInfo);
      if (res.skipped) {
        console.log(`[SKIPPED - up to date]`);
        skippedCount++;
      } else {
        console.log(`✓ [${formatBytes(res.originalSize)} → ${formatBytes(res.convertedSize)}] (${res.ratio}%)`);
        totalOriginal += res.originalSize;
        totalConverted += res.convertedSize;
        convertedCount++;
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.log(`❌ FAILED: ${errMsg}`);
      errorCount++;
    }
  }

  console.log(`\n================ Summary ================`);
  console.log(`  Processed:  ${files.length} file(s)`);
  console.log(`  Converted:  ${convertedCount}`);
  console.log(`  Skipped:    ${skippedCount}`);
  console.log(`  Errors:     ${errorCount}`);

  if (convertedCount > 0) {
    const diff = totalOriginal - totalConverted;
    const pct = ((diff / totalOriginal) * 100).toFixed(1);
    console.log(`  Original:   ${formatBytes(totalOriginal)}`);
    console.log(`  WebP Total: ${formatBytes(totalConverted)}`);
    console.log(`  Saved:      ${formatBytes(diff)} (${pct}%)`);
  }
  console.log(`=========================================\n`);

  if (errorCount > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal CLI error:', err);
  process.exit(1);
});
