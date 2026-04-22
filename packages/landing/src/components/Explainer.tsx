import styles from './Explainer.module.css'
import { FacetStage } from './FacetStage'
import { LinkCard } from './LinkCard'
import { MobileFacetStack } from './MobileFacetStack'

const BOOK_ICON = (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <title>book</title>
    <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5a2.5 2.5 0 0 0 0 5H20" />
    <path d="M4 4.5v15A2.5 2.5 0 0 0 6.5 22" />
  </svg>
)

export function Explainer() {
  return (
    <section className={styles.explainer}>
      <div id="what" className={styles.intro}>
        <div className={styles.label}>The Idea</div>
        <h2 className={styles.title}>
          So what&apos;s a <em>facet</em>?
        </h2>
        <p className={styles.sub}>
          Think npm, but the packages are the things that make your agents useful. Four primitives, one bundle.
        </p>
        <LinkCard
          className={styles.learnCard}
          href="https://docs.agentfacets.io"
          label="Learn about facets"
          value="docs.agentfacets.io"
          icon={BOOK_ICON}
        />
      </div>
      {/*
       * Desktop: the scroll-linked 3D choreography of FacetStage.
       * Mobile: a static stack of primitive cards. The two are
       * toggled via CSS at the bp-mobile breakpoint; both sit in
       * the DOM but only one lays out at a time.
       */}
      <div className={styles.desktopStage}>
        <FacetStage />
      </div>
      <div className={styles.mobileStack}>
        <MobileFacetStack />
      </div>
    </section>
  )
}
