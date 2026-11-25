import fs from 'node:fs';

const PUBLIC_HEADERS = `/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin

/assets/*.js
  Cache-Control: public, max-age=31536000, immutable

/assets/*.css
  Cache-Control: public, max-age=31536000, immutable

/assets/*.woff2
  Cache-Control: public, max-age=31536000, immutable

/assets/*.webp
  Cache-Control: public, max-age=31536000, immutable

/assets/*.glb
  Cache-Control: public, max-age=31536000, immutable

/models/*.glb
  Cache-Control: public, max-age=31536000, immutable

/r59Media_logo.svg
  Cache-Control: public, max-age=604800, stale-while-revalidate=86400

/r59Media_logo_white.svg
  Cache-Control: public, max-age=604800, stale-while-revalidate=86400

/favicon-*.png
  Cache-Control: public, max-age=604800, stale-while-revalidate=86400

/favicon-*.webp
  Cache-Control: public, max-age=604800, stale-while-revalidate=86400

/robots.txt
  Cache-Control: public, max-age=3600, stale-while-revalidate=86400

/sitemap.xml
  Cache-Control: public, max-age=3600, stale-while-revalidate=86400

/llms.txt
  Cache-Control: public, max-age=3600, stale-while-revalidate=86400
`;

if (fs.existsSync('../frontend/dist')) {
  if (fs.existsSync('public/assets')) {
    fs.rmSync('public/assets', { recursive: true, force: true });
  }
  fs.mkdirSync('public', { recursive: true });
  fs.cpSync('../frontend/dist', 'public', { recursive: true });
  fs.writeFileSync('public/_headers', PUBLIC_HEADERS, 'utf8');
}
