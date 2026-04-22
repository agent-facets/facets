import { PACKED_COPY, PRIMITIVE_CARDS } from './explainer-content'
import styles from './MobileFacetStack.module.css'

const MINI_BOXES: ReadonlyArray<{ slug: 'skills' | 'agents' | 'cmds' | 'mcp'; icon: string; label: string }> = [
  { slug: 'skills', icon: 'S', label: 'skills/' },
  { slug: 'agents', icon: 'A', label: 'agents/' },
  { slug: 'cmds', icon: '/', label: 'commands/' },
  { slug: 'mcp', icon: 'M', label: 'mcp/' },
]

/**
 * The mobile counterpart to `FacetStage`. Static (no scroll-linked 3D
 * choreography) — instead, renders a single diamond visual with the 4
 * primitives stacked inside, followed by 4 primitive cards, followed
 * by the "packed" reveal.
 *
 * Shares copy with `FacetStage` via `explainer-content.tsx` so the two
 * components stay in sync.
 */
export function MobileFacetStack() {
  return (
    <>
      <div className={styles.facetHero} aria-hidden="true">
        <div className={styles.diamond} />
        <div className={styles.stack}>
          {MINI_BOXES.map((box) => (
            <div key={box.slug} className={`${styles.miniBox} ${styles[`mb-${box.slug}`]}`}>
              <div className={styles.miniIcon}>{box.icon}</div>
              <div className={styles.miniLabel}>{box.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className={styles.primitives}>
        {PRIMITIVE_CARDS.map((card) => (
          <article key={card.slug} className={`${styles.primCard} ${styles[`p-${card.slug}`]}`}>
            <div className={styles.primHead}>
              <span className={styles.primNum}>{card.num}</span>
              <span className={styles.primBadge}>{card.badge}</span>
            </div>
            <h3 className={styles.primTitle}>{card.title}</h3>
            <p className={styles.primBody}>{card.body}</p>
            <div className={styles.primTags}>
              {card.tags.map((tag) => (
                <span key={tag} className={styles.primTag}>
                  {tag}
                </span>
              ))}
            </div>
          </article>
        ))}
      </div>

      <div className={styles.packed}>
        <div className={styles.packedLabel}>{PACKED_COPY.label}</div>
        <h3 className={styles.packedTitle}>{PACKED_COPY.title}</h3>
        <p className={styles.packedBody}>{PACKED_COPY.body}</p>
        <code className={styles.packedCode}>{PACKED_COPY.code}</code>
      </div>
    </>
  )
}
