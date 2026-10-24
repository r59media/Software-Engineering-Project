import photo1 from '../assets/mrphshImages/mrphsh_img01.webp'
import photo2 from '../assets/mrphshImages/mrphsh_img02.webp'
import photo3 from '../assets/mrphshImages/mrphsh_img03.webp'
import photo4 from '../assets/mrphshImages/mrphsh_img04.webp'
import photo5 from '../assets/mrphshImages/mrphsh_img05.webp'
import photo6 from '../assets/mrphshImages/mrphsh_img06.webp'
import photo7 from '../assets/mrphshImages/mrphsh_img07.webp'
import photo8 from '../assets/mrphshImages/mrphsh_img08.webp'
import photo9 from '../assets/mrphshImages/mrphsh_img09.webp'
import type { PhotoshootPhoto } from '../types/recentPhotoshoot'

export const recentPhotos: readonly PhotoshootPhoto[] = [
  { id: 'recent-04', imageUrl: photo4, alt: 'Studio portrait in a black suit and patterned tie.', width: 720, height: 1020 },
  { id: 'recent-07', imageUrl: photo7, alt: 'Smiling studio portrait in a blue suit.', width: 720, height: 1020 },
  { id: 'recent-09', imageUrl: photo9, alt: 'Studio portrait in a black suit with hands clasped.', width: 720, height: 1020 },
  { id: 'recent-06', imageUrl: photo6, alt: 'Studio portrait in a white short-sleeved top.', width: 720, height: 1020 },
  { id: 'recent-08', imageUrl: photo8, alt: 'Studio portrait in a white blouse and beige trousers.', width: 720, height: 1020 },
  { id: 'recent-01', imageUrl: photo1, alt: 'Studio portrait in a black blazer and white top.', width: 720, height: 1020 },
  { id: 'recent-02', imageUrl: photo2, alt: 'Studio portrait with glasses, a patterned blouse, and black blazer.', width: 720, height: 1020 },
  { id: 'recent-03', imageUrl: photo3, alt: 'Studio portrait in a grey suit and black tie.', width: 720, height: 1020 },
  { id: 'recent-05', imageUrl: photo5, alt: 'Studio portrait with glasses, a white shirt, and black blazer.', width: 720, height: 1020 },
]

export const recentInitialPhotoId = 'recent-09'
export const recentMotionSettings = { pauseBetweenMovesMs: 1000 } as const
