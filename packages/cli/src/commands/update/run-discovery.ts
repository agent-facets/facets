import { render } from 'ink'
import { createElement } from 'react'
import { UpdateDiscoveryView } from '../../tui/views/update/discovery-view.tsx'

export interface DiscoveryProgressOptions {
  /**
   * Whether to draw the indicator at all.
   *
   * Defaults to "stdout is a terminal". An animated frame is a terminal
   * affordance: piped into a file or a CI log it becomes twenty lines a
   * second of comet frames in front of the output someone actually
   * wanted. A non-terminal run does the same work and prints nothing
   * extra.
   */
  enabled?: boolean
}

/**
 * Run `work` with the discovery indicator on screen, and take it back
 * down however `work` ends.
 *
 * The indicator is torn down in a `finally`, so a rejected promise, a
 * structured failure, and a successful plan all leave the same clean
 * screen for whatever the command renders next. `clear()` precedes
 * `unmount()` so the frame is erased rather than left sitting above the
 * picker.
 */
export async function withUpdateDiscovery<T>(
  work: () => Promise<T>,
  options: DiscoveryProgressOptions = {},
): Promise<T> {
  const enabled = options.enabled ?? process.stdout.isTTY === true
  if (!enabled) return work()

  const instance = render(createElement(UpdateDiscoveryView), { exitOnCtrlC: false })
  try {
    return await work()
  } finally {
    instance.clear()
    instance.unmount()
  }
}
