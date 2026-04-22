import { Eyebrow } from './Eyebrow'
import styles from './Hero.module.css'
import { InstallBlock } from './InstallBlock'
import { OrbitFloaters } from './OrbitFloaters'
import { RegistryCta } from './RegistryCta'

export function Hero() {
  return (
    <section className={styles.hero}>
      <div className={styles.heroBg} />
      <div className={styles.heroGrid} />

      <OrbitFloaters />

      <div className={styles.eyebrowRow}>
        <Eyebrow>v{__APP_VERSION__} · pre-release alpha</Eyebrow>
      </div>

      <h1 className={styles.title}>
        The package manager
        <br />
        for <span className={styles.accent}>AI agents.</span>
      </h1>

      <p className={styles.sub}>
        Skills, sub-agents, slash commands, and MCP servers — bundled, versioned, installed with one line.
      </p>

      {/*
       * On desktop the install pill is the primary CTA; on mobile the
       * curl command isn't useful, so we show a Registry CTA card
       * pointing at facet.cafe instead. Both are mounted and CSS
       * toggles visibility at the bp-mobile breakpoint.
       */}
      <div className={styles.installWrap}>
        <InstallBlock />
      </div>
      <RegistryCta className={styles.mobileCta} />

      <div className={styles.installNote}>one-liner · macOS · Linux · works with Claude, Cursor, Codex &amp; more</div>
      <div className={styles.installNoteMobile}>Search 200+ facets · install from your desktop with one line</div>

      <div className={styles.ctaRow}>
        <a href="#demo">
          See it in action <span className={styles.arrow}>→</span>
        </a>
        <span className={styles.sep}>·</span>
        <a href="https://facet.cafe/" target="_blank" rel="noreferrer noopener">
          Browse the registry <span className={styles.arrow}>↗</span>
        </a>
        <span className={styles.sep}>·</span>
        <a href="https://docs.agentfacets.io">
          Learn more about facets <span className={styles.arrow}>↗</span>
        </a>
      </div>
    </section>
  )
}
