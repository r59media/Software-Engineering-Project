import fs from 'node:fs';

if (fs.existsSync('../frontend/dist')) {
  if (fs.existsSync('public/assets')) {
    fs.rmSync('public/assets', { recursive: true, force: true });
  }
  fs.mkdirSync('public', { recursive: true });
  fs.cpSync('../frontend/dist', 'public', { recursive: true });
}
