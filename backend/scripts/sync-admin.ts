import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import { createRequire } from 'node:module';

interface EsbuildTransformOptions {
  loader: 'css' | 'js';
  minify: boolean;
  legalComments: 'none' | 'inline' | 'eof' | 'linked' | 'external';
}

interface EsbuildTransformResult {
  code: string;
}

interface EsbuildModule {
  transformSync(code: string, options: EsbuildTransformOptions): EsbuildTransformResult;
}

const require = createRequire(import.meta.url);

if (!fs.existsSync('node_modules')) {
  try {
    cp.execSync('pnpm install', { stdio: 'inherit' });
  } catch { /* ignore */ }
}

fs.mkdirSync('public/admin', { recursive: true });
fs.cpSync('../admin', 'public/admin', {
  recursive: true,
  filter: (src: string): boolean =>
    !src.endsWith('.md') &&
    !src.includes('/src') &&
    !src.includes('node_modules') &&
    !src.endsWith('tsconfig.json') &&
    !src.endsWith('package.json') &&
    !src.endsWith('pnpm-lock.yaml')
});

const esbuild: EsbuildModule | null = (() => {
  try { return require('esbuild') as EsbuildModule; } catch { /* ignore */ }
  try { return createRequire(require.resolve('wrangler'))('esbuild') as EsbuildModule; } catch { /* ignore */ }
  try { return require('../frontend/node_modules/esbuild') as EsbuildModule; } catch { /* ignore */ }
  return null;
})();

function minifyDir(dir: string): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      minifyDir(filePath);
    } else if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
      const content = fs.readFileSync(filePath, 'utf8');
      if (esbuild) {
        const res = esbuild.transformSync(content, {
          loader: filePath.endsWith('.css') ? 'css' : 'js',
          minify: true,
          legalComments: 'none'
        });
        fs.writeFileSync(filePath, res.code);
      }
    }
  }
}

if (fs.existsSync('public/admin/assets')) {
  minifyDir('public/admin/assets');
}
