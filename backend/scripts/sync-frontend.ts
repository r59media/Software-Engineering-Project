import fs from 'node:fs';

const PUBLIC_HEADERS = `/assets/*.js
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
`;

if (fs.existsSync('../frontend/dist')) {
  if (fs.existsSync('public/assets')) {
    fs.rmSync('public/assets', { recursive: true, force: true });
  }
  fs.mkdirSync('public', { recursive: true });
  fs.cpSync('../frontend/dist', 'public', { recursive: true });
  fs.writeFileSync('public/_headers', PUBLIC_HEADERS, 'utf8');
}
