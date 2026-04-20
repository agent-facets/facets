/**
 * Lambda handler for https://agentfacets.io/install
 *
 * Serves the bash installer script from packages/landing/scripts/install.sh.
 * The script file is bundled with the Lambda via `copyFiles` in infra/site.ts.
 *
 * All requests return 200 with the script body — there is no routing, no
 * query-string handling, and no body parsing. One URL, one response.
 *
 * Path resolution:
 *   - In Lambda: LAMBDA_TASK_ROOT is set by AWS (/var/task). copyFiles places
 *     the script at <task-root>/scripts/install.sh.
 *   - In tests: the test harness sets LAMBDA_TASK_ROOT to a directory that
 *     contains scripts/install.sh before importing this module so the same
 *     resolution works.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { APIGatewayProxyHandlerV2 } from 'aws-lambda'

function resolveScriptPath(): string {
  const taskRoot = process.env.LAMBDA_TASK_ROOT
  if (!taskRoot) {
    throw new Error(
      'LAMBDA_TASK_ROOT is not set. This handler expects to run inside AWS Lambda, ' +
        'or in a test harness that sets LAMBDA_TASK_ROOT appropriately.',
    )
  }
  return join(taskRoot, 'scripts', 'install.sh')
}

// Read the script once at cold-start.
const SCRIPT_BODY = readFileSync(resolveScriptPath(), 'utf8')

export const handler: APIGatewayProxyHandlerV2 = async () => {
  return {
    statusCode: 200,
    headers: {
      'content-type': 'text/x-shellscript; charset=utf-8',
      // 5 minutes: short enough that script fixes propagate quickly,
      // long enough to avoid thundering-herd against the Lambda during spikes.
      'cache-control': 'public, max-age=300',
    },
    body: SCRIPT_BODY,
  }
}
