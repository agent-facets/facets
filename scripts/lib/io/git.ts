/**
 * Git CLI operations.
 */

import { $ } from 'bun'

export const gitIo = {
  diff: () => $`git diff --quiet`.nothrow(),
  diffCached: () => $`git diff --cached --quiet`.nothrow(),
  config: (key: string, value: string) => $`git config ${key} ${value}`,
  checkout: (branch: string) => $`git checkout -B ${branch}`,
  add: () => $`git add -A`,
  commit: (message: string) => $`git commit -m ${message}`,
  push: (remote: string, ref: string, force = false) =>
    force ? $`git push ${remote} ${ref} --force` : $`git push ${remote} ${ref}`,
  pushTags: (remote: string, ref: string) => $`git push --follow-tags ${remote} ${ref}`,
  fetch: (remote: string, branch: string) => $`git fetch ${remote} ${branch}`,
  fetchSha: (remote: string, sha: string) => $`git fetch ${remote} ${sha}`,
  tagAt: (tag: string, sha: string) => $`git tag ${tag} -m ${tag} ${sha}`,
  pushAllTags: (remote: string) => $`git push ${remote} --tags`,
}
