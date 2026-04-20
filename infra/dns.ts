/**
 * Standalone Route53 records for agentfacets.io that aren't owned by
 * an SST resource's own `domain:` field.
 *
 * - docs.agentfacets.io → Mintlify. Mintlify serves the docs content;
 *   we just point the subdomain at their CNAME target.
 */

const isMain = $app.stage === 'main'

if (isMain) {
  const zone = aws.route53.getZoneOutput({
    name: 'agentfacets.io',
    privateZone: false,
  })

  new aws.route53.Record('DocsMintlifyCname', {
    zoneId: zone.zoneId,
    name: 'docs.agentfacets.io',
    type: 'CNAME',
    ttl: 300,
    records: ['cname.mintlify-dns.com'],
  })
}
