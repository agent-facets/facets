/**
 * GitHub CLI operations.
 */

import { $ } from 'bun'
import { GITHUB_REPO } from '../constants'

export const githubIo = {
  ghAuthSetupGit: () => $`gh auth setup-git`,
  ghPrList: (head: string) => $`gh pr list --head ${head} --state open --json number --jq .[0].number`.text(),
  ghPrCreate: (base: string, head: string, title: string, body: string) =>
    $`gh pr create --base ${base} --head ${head} --title ${title} --body ${body}`,
  ghPrUpdate: (prNumber: string, title: string, body: string) =>
    $`gh pr edit ${prNumber} --title ${title} --body ${body}`,
  ghGetPrForCommit: async (
    sha: string,
  ): Promise<Array<{ number: number; headRefName: string; headRefOid: string }>> => {
    const result =
      await $`gh api repos/${GITHUB_REPO}/commits/${sha}/pulls --jq '[.[] | {number, headRefName: .head.ref, headRefOid: .head.sha}]'`.text()
    return JSON.parse(result.trim() || '[]')
  },
  ghReleaseCreate: (tag: string, title: string, notes: string) =>
    $`gh release create ${tag} --title ${title} --notes ${notes}`.text(),
}
