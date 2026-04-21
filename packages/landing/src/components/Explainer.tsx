import styles from './Explainer.module.css'
import { FacetStage } from './FacetStage'

export function Explainer() {
  return (
    <section id="what" className={styles.explainer}>
      <div className={styles.intro}>
        <div className={styles.label}>The Idea</div>
        <h2 className={styles.title}>
          So what&apos;s a <em>facet</em>?
        </h2>
        <p className={styles.sub}>
          Think npm, but the packages are the things that make your agents useful. Four primitives, one bundle.
        </p>
      </div>
      <FacetStage />
    </section>
  )
}
