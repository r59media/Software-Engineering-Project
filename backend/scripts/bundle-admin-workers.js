const fs = require('fs');
const path = require('path');

// Locate esbuild from wrangler, local node_modules, or frontend
const esbuild = (() => {
  try { return require('esbuild'); } catch (e) {}
  try { return require('module').createRequire(require.resolve('wrangler'))('esbuild'); } catch (e) {}
  try { return require('../../frontend/node_modules/esbuild'); } catch (e) {}
  try { return require('../frontend/node_modules/esbuild'); } catch (e) {}
  return null;
})();

if (!esbuild) {
  console.error('esbuild could not be loaded');
  process.exit(1);
}

// Ensure target directories exist
fs.mkdirSync('../admin/assets/js', { recursive: true });
fs.mkdirSync('../admin/assets/js/utils', { recursive: true });
fs.mkdirSync('../admin/assets/wasm', { recursive: true });
fs.mkdirSync('public/admin/assets/js', { recursive: true });
fs.mkdirSync('public/admin/assets/js/utils', { recursive: true });
fs.mkdirSync('public/admin/assets/wasm', { recursive: true });

// 1. Bundle authWorker.ts
esbuild.buildSync({
  entryPoints: ['../admin/src/api/authWorker.ts'],
  outfile: '../admin/assets/js/authWorker.js',
  bundle: true,
  format: 'esm',
  target: 'es2022'
});

esbuild.buildSync({
  entryPoints: ['../admin/src/api/authWorker.ts'],
  outfile: 'public/admin/assets/js/authWorker.js',
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: true
});

// 2. Bundle webpEncoder.worker.ts to both root and utils locations
for (const out of [
  '../admin/assets/js/webpEncoder.worker.js',
  '../admin/assets/js/utils/webpEncoder.worker.js'
]) {
  esbuild.buildSync({
    entryPoints: ['../admin/src/utils/webpEncoder.worker.ts'],
    outfile: out,
    bundle: true,
    format: 'esm',
    target: 'es2022'
  });
}

for (const out of [
  'public/admin/assets/js/webpEncoder.worker.js',
  'public/admin/assets/js/utils/webpEncoder.worker.js'
]) {
  esbuild.buildSync({
    entryPoints: ['../admin/src/utils/webpEncoder.worker.ts'],
    outfile: out,
    bundle: true,
    format: 'esm',
    target: 'es2022',
    minify: true
  });
}

// 3. Copy wasm binaries from @jsquash packages to wasm assets
const adminNodeModules = path.resolve(__dirname, '../../admin/node_modules');
const wasmSources = [
  {
    src: path.join(adminNodeModules, '@jsquash/webp/codec/enc/webp_enc.wasm'),
    dest: 'webp_enc.wasm'
  },
  {
    src: path.join(adminNodeModules, '@jsquash/webp/codec/enc/webp_enc_simd.wasm'),
    dest: 'webp_enc_simd.wasm'
  },
  {
    src: path.join(adminNodeModules, '@jsquash/resize/lib/resize/pkg/squoosh_resize_bg.wasm'),
    dest: 'squoosh_resize_bg.wasm'
  }
];

for (const item of wasmSources) {
  if (fs.existsSync(item.src)) {
    fs.copyFileSync(item.src, path.join('../admin/assets/wasm', item.dest));
    fs.copyFileSync(item.src, path.join('public/admin/assets/wasm', item.dest));
    console.log(`Copied ${item.dest} (${fs.statSync(item.src).size} bytes)`);
  } else {
    console.warn(`Wasm source not found: ${item.src}`);
  }
}
console.log('Worker bundle and wasm assets complete.');
