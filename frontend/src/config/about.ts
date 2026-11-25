import yellowCard from '../assets/aboutMeImages/yellowCard_img.webp'
import redCard from '../assets/aboutMeImages/redCard_img.webp'
import portrait from "../assets/aboutMeImages/kevin'sPortrait.webp"
import portraitFrame from '../assets/aboutMeImages/aboutMe_portraitFrame_img.webp'
import topLens from '../assets/aboutMeImages/r59media-large-lens.webp'
import rightLens from '../assets/aboutMeImages/r59media-medium-lens.webp'
import camera from '../assets/aboutMeImages/r59media-dslr.webp'
import flash from '../assets/aboutMeImages/r59media-speedlight.webp'
import sdCard32 from '../assets/aboutMeImages/R59_SD_32gb.webp'
import sdCard128 from '../assets/aboutMeImages/R59_SD_128gb.webp'
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
  paper: { id: 'paper-background', imageUrl: paper, alt: '', width: 1829, height: 2560 },
} satisfies Record<string, AboutImage>

export const aboutDecorations: readonly AboutImage[] = [
  { id: 'top-lens', imageUrl: topLens, alt: '', width: 640, height: 1038 },
  { id: 'top-right-lens', imageUrl: rightLens, alt: '', width: 760, height: 760 },
  { id: 'bottom-right-camera', imageUrl: camera, alt: '', width: 1100, height: 1247 },
  { id: 'left-flash', imageUrl: flash, alt: '', width: 520, height: 803 },
  { id: 'left-memory-card', imageUrl: sdCard32, alt: '', width: 935, height: 1311 },
  { id: 'top-memory-card', imageUrl: sdCard128, alt: '', width: 920, height: 1203 },
  { id: 'bottom-memory-card', imageUrl: sdCard128, alt: '', width: 920, height: 1203 },
]
