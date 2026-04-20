/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: 'agent-facets',
      removal: input?.stage === 'main' ? 'retain' : 'remove',
      protect: ['main'].includes(input?.stage),
      home: 'aws',
      providers: {
        aws: {
          profile: process.env.SST_LIVE ? 'facet-cafe' : undefined,
          version: '7.20.0',
        },
      },
    }
  },
  async run() {
    const { readdirSync } = await import('node:fs')

    const outputs = {}

    for (const entry of readdirSync('./infra/', { withFileTypes: true })) {
      if (!entry.isFile()) continue // skip directories
      if (!entry.name.endsWith('.ts')) continue // skip non-TS files

      const result = await import(`./infra/${entry.name}`)

      if (result.outputs) Object.assign(outputs, result.outputs)
    }

    return outputs
  },
})
