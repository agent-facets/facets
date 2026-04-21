import { useCallback, useEffect, useRef } from 'react'
import styles from './CliDemo.module.css'

type PromptEntry = { kind: 'prompt'; text: string; cursor?: boolean }
type OutEntry = { kind: 'out'; delay?: number; html: string }
type Entry = PromptEntry | OutEntry

/**
 * The CLI demo script. Content is copied verbatim from the mockup — the
 * HTML inside `out` entries is static source we control (no user input),
 * so `dangerouslySetInnerHTML` is safe here.
 */
const CLI_SCRIPT: readonly Entry[] = [
  { kind: 'prompt', text: 'facet search viper' },
  {
    kind: 'out',
    delay: 300,
    html: '<span class="dim">Searching registry… found 3 matches.</span>\n<span class="violet">viper-plans</span>        <span class="dim">v1.4.0 · by @acme · 12.4k installs · 4 skills, 2 agents, 3 cmds, 1 mcp</span>\n<span class="violet">viper-reviews</span>      <span class="dim">v0.8.1 · by @acme · 3.1k installs  · 3 skills, 1 agent, 2 cmds</span>\n<span class="violet">viper-shipit</span>       <span class="dim">v2.0.0 · by @acme · 9.7k installs  · 5 skills, 1 agent, 4 cmds, 2 mcp</span>\n',
  },
  { kind: 'prompt', text: 'facet add viper-plans' },
  {
    kind: 'out',
    delay: 400,
    html: '<span class="dim">Resolving viper-plans@latest…</span>\n<span class="ok">✓</span> viper-plans@1.4.0 <span class="dim">(42 KB)</span>\n<span class="dim">Bundle contains:</span>\n  <span class="violet">skills/</span>     4 files   <span class="dim">plan-writer, risk-scan, scope-trim, delta-log</span>\n  <span class="pink">agents/</span>     2 files   <span class="dim">planner, skeptic</span>\n  <span class="ok">commands/</span>   3 files   <span class="dim">/plan /risk /ship</span>\n  <span class="warn">mcp/</span>        1 server  <span class="dim">linear (oauth required)</span>\n',
  },
  {
    kind: 'out',
    delay: 200,
    html: '<span class="dim">Installing to ~/.facets/viper-plans …</span>  <span class="bar"><i style="width:100%"></i></span> <span class="ok">done</span>\n<span class="dim">Authenticating linear MCP…</span>  <span class="ok">✓</span>\n<span class="dim">Registering slash commands with 3 editors…</span>  <span class="ok">✓</span>\n',
  },
  {
    kind: 'out',
    delay: 300,
    html: '<span class="ok">✓ viper-plans installed.</span>  <span class="dim">Try </span><span class="violet">/viper-plan "Q2 migration"</span><span class="dim"> in your editor.</span>\n\n',
  },
  { kind: 'prompt', text: 'facet list' },
  {
    kind: 'out',
    delay: 200,
    html: '<span class="violet">viper-plans</span>       <span class="dim">1.4.0</span>\n<span class="violet">ship-it</span>           <span class="dim">2.0.0</span>\n<span class="violet">designer-kit</span>      <span class="dim">0.9.3</span>  <span class="warn">(update: 1.0.0)</span>\n',
  },
  { kind: 'prompt', text: '', cursor: true },
]

/**
 * Cancellable sleep — resolves after `ms` ms or when the consumer sets the
 * ref returned by `isAborted` to true, whichever comes first.
 */
function sleep(ms: number, isAborted: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    const start = performance.now()
    const tick = () => {
      if (isAborted() || performance.now() - start >= ms) {
        resolve()
        return
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
}

export function CliDemo() {
  const bodyRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef(false)
  const hasRunRef = useRef(false)

  const renderInstant = useCallback(() => {
    const body = bodyRef.current
    if (!body) return
    body.innerHTML = ''
    for (const entry of CLI_SCRIPT) {
      if (entry.kind === 'prompt') {
        const line = document.createElement('div')
        const cursorHtml = entry.cursor ? `<span class="${styles.blink}"></span>` : ''
        line.innerHTML = `<span class="prompt">❯</span> <span class="cmd">${entry.text}${cursorHtml}</span>`
        body.appendChild(line)
      } else {
        const pre = document.createElement('div')
        pre.innerHTML = entry.html
        body.appendChild(pre)
      }
    }
  }, [])

  const runTypewriter = useCallback(async () => {
    const body = bodyRef.current
    if (!body) return
    abortRef.current = false
    body.innerHTML = ''

    const typewrite = async (text: string, target: HTMLElement) => {
      for (const ch of text) {
        if (abortRef.current) return
        target.textContent = (target.textContent ?? '') + ch
        await sleep(18 + Math.random() * 30, () => abortRef.current)
      }
    }

    for (const entry of CLI_SCRIPT) {
      if (abortRef.current) return
      if (entry.kind === 'prompt') {
        const line = document.createElement('div')
        line.innerHTML = '<span class="prompt">❯</span> <span class="cmd"></span>'
        body.appendChild(line)
        const cmd = line.querySelector('.cmd') as HTMLElement | null
        if (entry.text && cmd) await typewrite(entry.text, cmd)
        if (entry.cursor && cmd) {
          cmd.insertAdjacentHTML('beforeend', `<span class="${styles.blink}"></span>`)
        }
        await sleep(200, () => abortRef.current)
      } else {
        await sleep(entry.delay ?? 200, () => abortRef.current)
        if (abortRef.current) return
        const pre = document.createElement('div')
        pre.innerHTML = entry.html
        body.appendChild(pre)
        body.scrollTop = body.scrollHeight
      }
    }
  }, [])

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleReplay = useCallback(() => {
    abortRef.current = true
    const prefersReducedMotion =
      typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (prefersReducedMotion) return renderInstant()

    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => {
      void runTypewriter()
    }, 100)
  }, [runTypewriter, renderInstant])

  const handleSkip = useCallback(() => {
    abortRef.current = true
    renderInstant()
  }, [renderInstant])

  useEffect(() => {
    const section = document.getElementById('demo')
    if (!section) return

    const prefersReducedMotion =
      typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !hasRunRef.current) {
            hasRunRef.current = true
            if (prefersReducedMotion) {
              renderInstant()
            } else {
              void runTypewriter()
            }
          }
        }
      },
      { threshold: 0.3 },
    )
    observer.observe(section)
    return () => observer.disconnect()
  }, [renderInstant, runTypewriter])

  useEffect(
    () => () => {
      abortRef.current = true
    },
    [],
  )

  return (
    <section id="demo" className={styles.section}>
      <div className={styles.wrap}>
        <div className={styles.head}>
          <div className={styles.label}>Like npm, but for agents</div>
          <h2 className={styles.title}>
            Install a facet in <em>six seconds.</em>
          </h2>
          <p className={styles.sub}>
            One command adds skills, sub-agents, slash commands, and MCP servers to your editor — all at once.
          </p>
        </div>

        <div className={styles.window}>
          <div className={styles.titlebar}>
            <div className={styles.dots}>
              <span />
              <span />
              <span />
            </div>
            <div className={styles.tab}>~/projects/acme · zsh</div>
          </div>
          <div ref={bodyRef} className={styles.body} />
        </div>
        <div className={styles.controls}>
          <button type="button" onClick={handleReplay}>
            ↻ replay
          </button>
          <button type="button" onClick={handleSkip}>
            ⇥ skip
          </button>
        </div>
      </div>
    </section>
  )
}
