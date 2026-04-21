import styles from './Footer.module.css'

const YEAR = new Date().getFullYear()

export function Footer() {
  return (
    <footer className={styles.footer}>
      <div>© {YEAR} · Agent Facets</div>
      <div className={styles.links}>
        <a href="https://docs.agentfacets.io" target="_blank" rel="noreferrer noopener">
          docs
        </a>
        <a href="https://facet.cafe/" target="_blank" rel="noreferrer noopener">
          registry
        </a>
        <a href="https://github.com/agent-facets/facets" target="_blank" rel="noreferrer noopener">
          github
        </a>
        <a href="https://discord.gg/qXQYaYna5w" target="_blank" rel="noreferrer noopener">
          discord
        </a>
      </div>
    </footer>
  )
}
