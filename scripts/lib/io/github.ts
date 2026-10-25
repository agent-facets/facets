/**
 * GitHub CLI operations.
 */

import { $ } from 'bun'
import { GITHUB_REPO } from '../constants'

async function runGh(
  executable: string,
  args: string[],
): Promise<{ exitCode: number; stdout: Buffer; stderr: Buffer }> {
  const child = Bun.spawn({ cmd: [executable, ...args], env: process.env, stdout: 'pipe', stderr: 'pipe' })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).arrayBuffer(),
    new Response(child.stderr).arrayBuffer(),
  ])
  return { exitCode, stdout: Buffer.from(stdout), stderr: Buffer.from(stderr) }
}

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
  /** Creates an unpublished Release. GitHub permits asset changes only while it remains a draft. */
  releaseCreateDraft: (tag: string, title: string, notes: string) =>
    $`gh release create ${tag} --draft --verify-tag --title ${title} --notes ${notes}`.text(),
  /** Reads release state and assets. A missing release has a nonzero exit code. */
  releaseView: (tag: string) => $`gh release view ${tag} --json tagName,isDraft,isImmutable,url,assets`.nothrow(),
  /** Uploads assets to a GitHub Release, replacing any existing asset with the same name. */
  releaseUpload: (tag: string, assets: string[]) => $`gh release upload ${tag} ${assets} --clobber`,
  /** Publishes an existing draft Release after its assets have been verified. */
  releasePublish: (tag: string) => $`gh release edit ${tag} --draft=false`.text(),
  workflowDispatch: (workflow: string, ref: string, tag: string, executable = 'gh') =>
    runGh(executable, [
      'api',
      '--method',
      'POST',
      `repos/${GITHUB_REPO}/actions/workflows/${workflow}/dispatches`,
      '-f',
      `ref=${ref}`,
      '-f',
      `inputs[tag]=${tag}`,
      '-F',
      'return_run_details=true',
    ]),
  workflowWatch: (runId: string) => $`gh run watch ${runId} --repo ${GITHUB_REPO} --exit-status`.nothrow(),
}
