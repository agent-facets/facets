import { useIsMobile } from '../hooks/useIsMobile'
import styles from './Closer.module.css'
import { Footer } from './Footer'
import { InstallBlock } from './InstallBlock'
import { RegistryCta } from './RegistryCta'

export function Closer() {
  const isMobile = useIsMobile()
  return (
    <section className={styles.closer}>
      <div className={styles.glow} />
      <div className={styles.content}>
        <h2 className={styles.title}>
          Go <em>install</em> something.
        </h2>
        <p className={styles.sub}>
          Public facets — <strong>free, forever.</strong> Private registries for teams, enterprise agreements on
          request. Just like npm — but for agents.
        </p>
        <div className={styles.installWrap}>
          <InstallBlock />
        </div>
        {isMobile && <RegistryCta className={styles.mobileCta} />}
      </div>
      <Footer />
    </section>
  )
}
