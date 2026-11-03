/**
 * backend/scripts/sync-defaults.mjs
 * 
 * Synchronizes default Main Page images (hero, recent photoshoot, gallery, about portrait)
 * into backend/src/defaultPortfolioSeed.json with their compiled Vite content-hashed assets.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Locate project root
const backendDir = path.resolve(__dirname, '..');
const projectRootDir = path.resolve(backendDir, '..');
const frontendDir = path.resolve(projectRootDir, 'frontend');
const publicAssetsDir = path.resolve(backendDir, 'public/assets');
const outputFile = path.resolve(backendDir, 'src/defaultPortfolioSeed.json');

function getSha256(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const buffer = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

// Build map of sha256 -> public asset URL (/assets/<name>)
const hashMap = new Map();
if (fs.existsSync(publicAssetsDir)) {
  const files = fs.readdirSync(publicAssetsDir);
  for (const file of files) {
    if (file.endsWith('.webp')) {
      const fullPath = path.join(publicAssetsDir, file);
      const hash = getSha256(fullPath);
      if (hash) {
        hashMap.set(hash, `/assets/${file}`);
      }
    }
  }
}

function resolveAssetUrl(sourceRelativePath, fallbackHashName) {
  const fullPath = path.resolve(frontendDir, 'src/assets', sourceRelativePath);
  const hash = getSha256(fullPath);
  if (hash && hashMap.has(hash)) {
    return hashMap.get(hash);
  }
  // If public assets not yet compiled or hash not found, use fallback
  return fallbackHashName ? `/assets/${fallbackHashName}` : `/assets/${path.basename(sourceRelativePath)}`;
}

// 1. Hero slides (5 slides)
const heroAssets = [
  { file: 'heroImages/heroImg1.webp', fallback: 'CdWg9zPd.webp', title: 'Twilight Highway Rolling Shot', alt: 'High-contrast automotive rolling shot on the open highway at twilight.' },
  { file: 'heroImages/heroImg2.webp', fallback: 'Sd96gpHk.webp', title: 'Studio Automotive Silhouette', alt: 'Dramatic studio automotive detail capturing reflections and sleek body lines.' },
  { file: 'heroImages/heroImg3.webp', fallback: 'D2thO5N_.webp', title: 'Cinematic Ambient Portrait', alt: 'Atmospheric portrait photography with warm cinematic lighting.' },
  { file: 'heroImages/heroImg4.webp', fallback: 'agEA14ZU.webp', title: 'Sunset Automotive Portrait', alt: 'Artistic urban automotive portrait during sunset in New Jersey.' },
  { file: 'heroImages/heroImg1.webp', fallback: 'CdWg9zPd.webp', title: 'Twilight Highway Rolling Shot II', alt: 'Atmospheric automotive perspective at dusk.' }
];

const hero = heroAssets.map((item, idx) => ({
  section: 'hero',
  category: 'hero',
  title: item.title,
  alt_text: item.alt,
  display_order: idx + 1,
  order: idx + 1,
  media_key: resolveAssetUrl(item.file, item.fallback),
  seed_key: `hero-${idx + 1}`,
  is_featured: 1,
  is_active: 1
}));

// 2. Recent photoshoot images (9 images)
const recentPhotosData = [
  { file: 'mrphshImages/mrphsh_img04.webp', fallback: 'D4wMHJae.webp', alt: 'Studio portrait in a black suit and patterned tie.' },
  { file: 'mrphshImages/mrphsh_img07.webp', fallback: 'CcvhJ4K9.webp', alt: 'Smiling studio portrait in a blue suit.' },
  { file: 'mrphshImages/mrphsh_img09.webp', fallback: 'Dw5-qK75.webp', alt: 'Studio portrait in a black suit with hands clasped.' },
  { file: 'mrphshImages/mrphsh_img06.webp', fallback: 'BUO1aQbc.webp', alt: 'Studio portrait in a white short-sleeved top.' },
  { file: 'mrphshImages/mrphsh_img08.webp', fallback: 'BW89yckM.webp', alt: 'Studio portrait in a white blouse and beige trousers.' },
  { file: 'mrphshImages/mrphsh_img01.webp', fallback: 'Dhi-pdrR.webp', alt: 'Studio portrait in a black blazer and white top.' },
  { file: 'mrphshImages/mrphsh_img02.webp', fallback: 'CsJVCPMF.webp', alt: 'Studio portrait with glasses, a patterned blouse, and black blazer.' },
  { file: 'mrphshImages/mrphsh_img03.webp', fallback: 'BL_DFc6O.webp', alt: 'Studio portrait in a grey suit and black tie.' },
  { file: 'mrphshImages/mrphsh_img05.webp', fallback: 'MIyZqOug.webp', alt: 'Studio portrait with glasses, a white shirt, and black blazer.' }
];

const recent = recentPhotosData.map((item, idx) => ({
  section: 'recent',
  category: 'Portrait',
  title: `Recent Look ${idx + 1}`,
  alt_text: item.alt,
  display_order: idx + 1,
  order: idx + 1,
  media_key: resolveAssetUrl(item.file, item.fallback),
  seed_key: `recent-${idx + 1}`,
  is_featured: 0,
  is_active: 1
}));

// 3. Gallery portfolio images (9 images cycling across Portrait, Editorial, Commercial, Events)
const galleryCategories = ['Portrait', 'Editorial', 'Commercial', 'Events'];
const galleryPhotosData = [
  { file: 'mrphshImages/mrphsh_img01.webp', fallback: 'Dhi-pdrR.webp', alt: 'Studio series portrait in black blazer.' },
  { file: 'mrphshImages/mrphsh_img02.webp', fallback: 'CsJVCPMF.webp', alt: 'Editorial series portrait with glasses.' },
  { file: 'mrphshImages/mrphsh_img03.webp', fallback: 'BL_DFc6O.webp', alt: 'Commercial series portrait in grey suit.' },
  { file: 'mrphshImages/mrphsh_img04.webp', fallback: 'D4wMHJae.webp', alt: 'Events series portrait in black suit.' },
  { file: 'mrphshImages/mrphsh_img05.webp', fallback: 'MIyZqOug.webp', alt: 'Studio series portrait in white shirt.' },
  { file: 'mrphshImages/mrphsh_img06.webp', fallback: 'BUO1aQbc.webp', alt: 'Editorial series portrait in white top.' },
  { file: 'mrphshImages/mrphsh_img07.webp', fallback: 'CcvhJ4K9.webp', alt: 'Commercial series portrait in blue suit.' },
  { file: 'mrphshImages/mrphsh_img08.webp', fallback: 'BW89yckM.webp', alt: 'Events series portrait in beige trousers.' },
  { file: 'mrphshImages/mrphsh_img09.webp', fallback: 'Dw5-qK75.webp', alt: 'Studio series portrait with hands clasped.' }
];

const gallery = galleryPhotosData.map((item, idx) => ({
  section: 'gallery',
  category: galleryCategories[idx % galleryCategories.length],
  title: `Studio Series ${idx + 1}`,
  alt_text: item.alt,
  display_order: idx + 1,
  order: idx + 1,
  media_key: resolveAssetUrl(item.file, item.fallback),
  seed_key: `gallery-${idx + 1}`,
  is_featured: 0,
  is_active: 1
}));

// 4. About portrait (1 portrait)
const about = [
  {
    section: 'about',
    category: 'Portrait',
    title: 'About Portrait',
    alt_text: 'Portrait of the photographer behind R59',
    display_order: 1,
    order: 1,
    media_key: resolveAssetUrl("aboutMeImages/kevin'sPortrait.webp", 'Bw-T4hID.webp'),
    seed_key: 'about-1',
    is_featured: 0,
    is_active: 1
  }
];

const seedPayload = {
  hero,
  recent,
  gallery,
  about
};

fs.writeFileSync(outputFile, JSON.stringify(seedPayload, null, 2) + '\n');
console.log(`[sync-defaults] Successfully wrote ${hero.length} hero, ${recent.length} recent, ${gallery.length} gallery, and ${about.length} about defaults to ${outputFile}`);
