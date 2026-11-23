import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import crypto from 'node:crypto';
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

function sha256Short(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 8);
}

function bundleAdminHtml(): void {
  const indexHtmlPath = 'public/admin/index.html';
  if (!fs.existsSync(indexHtmlPath)) {
    throw new Error(`[sync-admin] Missing ${indexHtmlPath}`);
  }

  let html = fs.readFileSync(indexHtmlPath, 'utf8');

  const cssLinkRegex = /^[ \t]*<link\s+rel="stylesheet"\s+href="assets\/css\/([^"]+)">\r?\n?/gm;
  const cssMatches = Array.from(html.matchAll(cssLinkRegex));
  if (cssMatches.length !== 10) {
    throw new Error(`[sync-admin] Expected 10 admin stylesheet links, found ${cssMatches.length}`);
  }
  const cssBundleContent = cssMatches
    .map((m) => fs.readFileSync(path.join('public/admin/assets/css', m[1]), 'utf8'))
    .join('\n');
  fs.writeFileSync('public/admin/assets/css/admin-bundle.css', cssBundleContent);
  const cssHash = sha256Short(cssBundleContent);
  let cssReplaced = false;
  html = html.replace(cssLinkRegex, (match) => {
    if (!cssReplaced) {
      cssReplaced = true;
      const indent = match.match(/^[ \t]*/)?.[0] ?? '';
      return `${indent}<link rel="stylesheet" href="assets/css/admin-bundle.css?v=${cssHash}">\n`;
    }
    return '';
  });

  const bootScriptRegex = /^[ \t]*<script\s+src="assets\/js\/(?!theme-init\.js")([^"]+)"><\/script>\r?\n?/gm;
  const bootMatches = Array.from(html.matchAll(bootScriptRegex));
  if (bootMatches.length !== 11) {
    throw new Error(`[sync-admin] Expected 11 admin boot scripts, found ${bootMatches.length}`);
  }
  if (bootMatches[0][1] !== 'state.js' || bootMatches[10][1] !== 'app.js') {
    throw new Error(`[sync-admin] Unexpected boot script range: ${bootMatches[0][1]}..${bootMatches[10][1]}`);
  }
  const bootBundleContent = bootMatches
    .map((m) => fs.readFileSync(path.join('public/admin/assets/js', m[1]), 'utf8'))
    .join(';\n');
  fs.writeFileSync('public/admin/assets/js/admin-boot.js', bootBundleContent);
  const bootHash = sha256Short(bootBundleContent);
  let bootReplaced = false;
  html = html.replace(bootScriptRegex, (match) => {
    if (!bootReplaced) {
      bootReplaced = true;
      const indent = match.match(/^[ \t]*/)?.[0] ?? '';
      return `${indent}<script src="assets/js/admin-boot.js?v=${bootHash}" defer></script>\n`;
    }
    return '';
  });

  const themeInitPath = 'public/admin/assets/js/theme-init.js';
  const themeInitHash = sha256Short(fs.readFileSync(themeInitPath, 'utf8'));
  const themeTag = '<script src="assets/js/theme-init.js"></script>';
  if (!html.includes(themeTag)) {
    throw new Error('[sync-admin] Expected theme-init.js script tag in public/admin/index.html');
  }
  html = html.replace(themeTag, `<script src="assets/js/theme-init.js?v=${themeInitHash}"></script>`);

  fs.writeFileSync(indexHtmlPath, html);
}

bundleAdminHtml();
