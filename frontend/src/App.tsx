import './styles/global.css'
import { SiteHeader } from './components/SiteHeader'
import { Hero } from './sections/hero/Hero'
import { heroDestinations, heroSlides } from './config/hero'

function App() {
  return <div className="site-shell">
    <a className="skip-link" href="#hero">Skip to content</a>
    <SiteHeader destinations={heroDestinations} />
    <main><Hero slides={heroSlides} destinations={heroDestinations} /></main>
  </div>
}

export default App
