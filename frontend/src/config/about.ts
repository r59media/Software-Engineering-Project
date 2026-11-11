import yellowCard from '../assets/aboutMeImages/yellowCard_img.webp'
import redCard from '../assets/aboutMeImages/redCard_img.webp'
import portrait from "../assets/aboutMeImages/kevin'sPortrait.webp"
import portraitFrame from '../assets/aboutMeImages/aboutMe_portraitFrame_img.webp'
import signature from '../assets/aboutMeImages/kevin_Logo_IMG.webp'
import topLens from '../assets/aboutMeImages/r59media-large-lens.webp'
import rightLens from '../assets/aboutMeImages/smalLense_IMG.webp'
import camera from '../assets/aboutMeImages/r59media-dslr.webp'
import flash from '../assets/aboutMeImages/speedlight_IMG.webp'
import leftCard from '../assets/aboutMeImages/128MmrCard_IMG.webp'
import topCard from '../assets/aboutMeImages/32MmrCard_IMG.webp'
import bottomCard from '../assets/aboutMeImages/1TMmrCard_IMG.webp'
import paper from '../assets/aboutMeImages/about-paper.webp'
import type { AboutContent, AboutImage } from '../types/about'

export const aboutContent: AboutContent = {
  eyebrow: 'About me',
  heading: 'THE FACE',
  subheading: 'BEHIND THE CAMERA',
  // Temporary copy approved for the static layout.
  biography: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim',
}

export const aboutImages = {
  yellowCard: { id: 'yellow-card', imageUrl: yellowCard, alt: '', width: 717, height: 1121 },
  redCard: { id: 'red-card', imageUrl: redCard, alt: '', width: 717, height: 1121 },
  portrait: { id: 'portrait', imageUrl: portrait, alt: 'Kevin D Gonzalez holding his camera at an event.', width: 1199, height: 1318 },
  portraitFrame: { id: 'portrait-frame', imageUrl: portraitFrame, alt: '', width: 1158, height: 1358 },
  signature: { id: 'signature-seal', imageUrl: signature, alt: '', width: 1030, height: 1034 },
  paper: { id: 'paper-background', imageUrl: paper, alt: '', width: 2926, height: 4096 },
} satisfies Record<string, AboutImage>

export const aboutDecorations: readonly AboutImage[] = [
  { id: 'top-lens', imageUrl: topLens, alt: '', width: 1040, height: 1686 },
  { id: 'top-right-lens', imageUrl: rightLens, alt: '', width: 2070, height: 2072 },
  { id: 'bottom-right-camera', imageUrl: camera, alt: '', width: 1500, height: 1700 },
  { id: 'left-flash', imageUrl: flash, alt: '', width: 1208, height: 1856 },
  { id: 'left-memory-card', imageUrl: leftCard, alt: '', width: 1162, height: 1160 },
  { id: 'top-memory-card', imageUrl: topCard, alt: '', width: 1342, height: 1342 },
  { id: 'bottom-memory-card', imageUrl: bottomCard, alt: '', width: 1104, height: 1102 },
]
