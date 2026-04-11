/**
 * Git CLI operations.
 */

import { $ } from 'bun'

export const gitIo = {
  gitDiff: () => $`git diff --quiet`.nothrow(),
  gitDiffCached: () => $`git diff --cached --quiet`.nothrow(),
  gitConfig: (key: string, value: string) => $`git config ${key} ${value}`,
  gitCheckout: (branch: string) => $`git checkout -B ${branch}`,
  gitAdd: () => $`git add -A`,
  gitCommit: (message: string) => $`git commit -m ${message}`,
  gitPush: (remote: string, ref: string, force = false) =>
    force ? $`git push ${remote} ${ref} --force` : $`git push ${remote} ${ref}`,
  gitPushTags: (remote: string, ref: string) => $`git push --follow-tags ${remote} ${ref}`,
  gitFetch: (remote: string, branch: string) => $`git fetch ${remote} ${branch}`,
  gitFetchSha: (remote: string, sha: string) => $`git fetch ${remote} ${sha}`,
  gitTagAt: (tag: string, sha: string) => $`git tag ${tag} -m ${tag} ${sha}`,
  gitPushAllTags: (remote: string) => $`git push ${remote} --tags`,
}
