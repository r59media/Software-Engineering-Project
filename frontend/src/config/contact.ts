import photo1 from '../assets/mrphshImages/mrphsh_img01.webp'
import photo2 from '../assets/mrphshImages/mrphsh_img02.webp'
import photo3 from '../assets/mrphshImages/mrphsh_img08.webp'
import type { ContactPhoto } from '../types/contact'

// Replace through ContactSection's photos prop with published admin-managed content.
export const contactPhotos: readonly ContactPhoto[] = [
  { id: 'contact-01', imageUrl: photo1, alt: 'Studio portrait in a black blazer and white top.' },
  { id: 'contact-02', imageUrl: photo2, alt: 'Studio portrait with glasses and a patterned blouse.' },
  { id: 'contact-03', imageUrl: photo3, alt: 'Studio portrait in a white blouse and beige trousers.' },
]
