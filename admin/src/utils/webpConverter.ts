// @ts-nocheck
/**
 * R59 Media Admin — Universal WebP Converter Engine
 * 
 * Zero-build-step client-side image processing utility. Converts standard formats
 * (JPG, PNG, GIF, BMP, TIFF, AVIF), Apple HEIC/HEIF photos, and Camera RAW formats
 * (Canon CR2/CR3, Nikon NEF, Sony ARW, Adobe DNG, Fuji RAF, Olympus ORF, Panasonic RW2,
 * Pentax PEF, Samsung SRW) into maximum-fidelity, lossless/100% quality WebP images
 * preserving 1:1 original sensor/image resolution.
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
    if (!file) return false;
    if (file.type && file.type.startsWith('image/')) return true;
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
            } else if (++attempts > 100) {
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
          } else {
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
   * Decode HEIC/HEIF files to a standard Blob (JPEG).
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
          if (typeof bitmap.close === 'function') bitmap.close();
          const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 1.0));
          if (blob) return blob;
        }
      } catch {
        // Native decoding failed or unsupported; fall through to heic2any
      }
    }

    const heic2any = await loadHeic2Any();
    const result = await heic2any({
      blob: file,
      toType: 'image/jpeg',
      quality: 1.0
    });
    return Array.isArray(result) ? result[0] : result;
  }

  /**
   * Decodes a File or Blob into an ImageBitmap or HTMLImageElement.
   * @param {File|Blob} fileOrBlob
   * @returns {Promise<ImageBitmap|HTMLImageElement>}
   */
  async function decodeToBitmap(fileOrBlob) {
    if (typeof createImageBitmap === 'function') {
      try {
        return await createImageBitmap(fileOrBlob);
      } catch {
        // Fallback to Image element
      }
    }

    return new Promise((resolve, reject) => {
      if (typeof Image === 'undefined') {
        return reject(new Error('Neither createImageBitmap nor Image is available'));
      }
      const url = URL.createObjectURL(fileOrBlob);
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

  /**
   * Draw an ImageBitmap/Image to an HTMLCanvasElement at 100% 1:1 original resolution
   * (unless a finite maxDimension is explicitly supplied) and encode to WebP with visually lossless 92% quality.
   * @param {ImageBitmap|HTMLImageElement} bitmap
   * @param {number} [maxDimension=Infinity]
   * @param {number} [quality=0.92]
   * @returns {Promise<{ webpBlob: Blob, width: number, height: number, canvas: HTMLCanvasElement }>}
   */
  async function bitmapToWebPBlob(bitmap, maxDimension = 2560, quality = 0.92) {
    let width = bitmap.naturalWidth || bitmap.width;
    let height = bitmap.naturalHeight || bitmap.height;

    if (!width || !height) {
      throw new Error('Invalid bitmap dimensions for WebP conversion');
    }

    // Scale down proportionally if longest edge exceeds maxDimension (2560px)
    if (Number.isFinite(maxDimension) && Math.max(width, height) > maxDimension) {
      const scale = maxDimension / Math.max(width, height);
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, width, height);

    if (typeof bitmap.close === 'function') {
      bitmap.close();
    }

    const webpBlob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        blob => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Canvas failed to encode image to WebP'));
          }
        },
        'image/webp',
        quality
      );
    });

    return { webpBlob, width, height, canvas };
  }

  /**
   * Convert any supported image (JPG, PNG, WebP, GIF, AVIF, BMP, HEIC, Camera RAW, etc.)
   * into a visually lossless WebP File (quality = 0.92, max 2560px on longest edge).
   * 
   * @param {File} file - Source file
   * @param {number|Object} [options] - Quality number (e.g. 0.92) or options object
   * @param {number} [options.maxDimension=2560] - Max dimension on longest edge (default 2560px)
   * @param {number} [options.quality=0.92] - WebP encoding quality (default 0.92)
   * @returns {Promise<{
   *   file: File,
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

    // If already WebP, verify resolution doesn't exceed maxDimension
    if (file.type === 'image/webp' || ext === 'webp') {
      let width = 0;
      let height = 0;
      let bitmap = null;
      try {
        bitmap = await decodeToBitmap(file);
        width = bitmap.naturalWidth || bitmap.width;
        height = bitmap.naturalHeight || bitmap.height;
      } catch {
        // Dimensions probe optional
      }

      // If dimensions are within 2560px, pass through
      if (!bitmap || Math.max(width, height) <= maxDimension) {
        if (bitmap && typeof bitmap.close === 'function') bitmap.close();
        const webpFile = file.name.endsWith('.webp') && file.type === 'image/webp'
          ? file
          : new File([file], `${baseName}.webp`, { type: 'image/webp', lastModified: Date.now() });

        return {
          file: webpFile,
          originalSize: file.size,
          convertedSize: webpFile.size,
          width,
          height,
          sourceFormat: 'webp'
        };
      }

      // Re-encode WebP that exceeds 2560px
      const { webpBlob, width: newW, height: newH } = await bitmapToWebPBlob(bitmap, maxDimension, requestedQuality);
      const webpFile = new File([webpBlob], `${baseName}.webp`, { type: 'image/webp', lastModified: Date.now() });
      return {
        file: webpFile,
        originalSize: file.size,
        convertedSize: webpFile.size,
        width: newW,
        height: newH,
        sourceFormat: 'webp (downscaled)'
      };
    }

    let bitmap;
    if (RAW_EXTENSIONS.has(ext)) {
      sourceFormat = `raw (${ext.toUpperCase()})`;
      const arrayBuffer = await file.arrayBuffer();
      const jpegBlob = extractLargestEmbeddedJpeg(arrayBuffer);
      bitmap = await decodeToBitmap(jpegBlob);
    } else if (HEIC_EXTENSIONS.has(ext) || file.type === 'image/heic' || file.type === 'image/heif') {
      sourceFormat = ext || 'heic';
      const decodedBlob = await decodeHeicToBlob(file);
      bitmap = await decodeToBitmap(decodedBlob);
    } else {
      bitmap = await decodeToBitmap(file);
    }

    let { webpBlob, width, height, canvas } = await bitmapToWebPBlob(bitmap, maxDimension, requestedQuality);

    // If converted WebP equals or exceeds original file size (e.g. converting an already compressed JPEG),
    // attempt slightly tighter quality (0.88, visually lossless) and pick the smaller blob.
    if (opts.quality === undefined && file.size && webpBlob.size >= file.size && canvas) {
      try {
        const fallbackBlob = await new Promise((resolve, reject) => {
          canvas.toBlob(
            blob => {
              if (blob) resolve(blob);
              else reject(new Error('Canvas failed to encode image to WebP at quality 0.88'));
            },
            'image/webp',
            0.88
          );
        });
        if (fallbackBlob && fallbackBlob.size < webpBlob.size) {
          webpBlob = fallbackBlob;
        }
      } catch {
        // Retain initial blob if fallback fails
      }
    }

    const webpFile = new File([webpBlob], `${baseName}.webp`, { type: 'image/webp', lastModified: Date.now() });

    return {
      file: webpFile,
      originalSize: file.size,
      convertedSize: webpFile.size,
      width,
      height,
      sourceFormat
    };
  }

  // Window global registration for zero-build script environments
  if (typeof window !== 'undefined') {
    window.R59 = window.R59 || {};
    window.R59.webpConverter = {
      SUPPORTED_EXTENSIONS,
      RAW_EXTENSIONS,
      HEIC_EXTENSIONS,
      isSupportedImageFile,
      extractLargestEmbeddedJpeg,
      decodeHeicToBlob,
      bitmapToWebPBlob,
      convertToWebP
    };
  }
})();
