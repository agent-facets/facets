import { CliDemo } from './components/CliDemo'
import { Closer } from './components/Closer'
import { Explainer } from './components/Explainer'
import { Hero } from './components/Hero'
import { Nav } from './components/Nav'
import { useSilentAnchorScroll } from './hooks/useSilentAnchorScroll'

export function App() {
  useSilentAnchorScroll()
  return (
    <>
      <Nav />
      <Hero />
      <Explainer />
      <CliDemo />
      <Closer />
    </>
  )
}
