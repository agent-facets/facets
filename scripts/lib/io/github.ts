/**
 * GitHub CLI operations.
 */

import { $ } from 'bun'
import { GITHUB_REPO } from '../constants'

export const githubIo = {
  authSetupGit: () => $`gh auth setup-git`,
  prList: (head: string) => $`gh pr list --head ${head} --state open --json number --jq .[0].number`.text(),
  prCreate: (base: string, head: string, title: string, body: string) =>
    $`gh pr create --base ${base} --head ${head} --title ${title} --body ${body}`,
  prUpdate: (prNumber: string, title: string, body: string) =>
    $`gh pr edit ${prNumber} --title ${title} --body ${body}`,
  getPrForCommit: async (sha: string): Promise<Array<{ number: number; headRefName: string; headRefOid: string }>> => {
    const result =
      await $`gh api repos/${GITHUB_REPO}/commits/${sha}/pulls --jq '[.[] | {number, headRefName: .head.ref, headRefOid: .head.sha}]'`.text()
    return JSON.parse(result.trim() || '[]')
  },
  releaseCreate: (tag: string, title: string, notes: string) =>
    $`gh release create ${tag} --title ${title} --notes ${notes}`.text(),
}
