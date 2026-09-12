import { isIP } from 'node:net';
/** Explicit proxy peers only. Never accept true, hop counts, hostnames, aliases or a catch-all network. */
export function trustedProxyPeers(raw: string | undefined): readonly string[] {
  if (!raw?.trim()) return [];
  const peers = raw.split(',').map((value) => value.trim());
  if (peers.length > 16) throw new Error('TRUSTED_PROXY_CIDRS accepts at most 16 explicit IP addresses or CIDRs.');
  for (const peer of peers) {
    const [address, prefix, extra] = peer.split('/');
    const family = isIP(address ?? '');
    if (!family || extra !== undefined || (prefix !== undefined && (!/^\d+$/.test(prefix) || Number(prefix) < 1 || Number(prefix) > (family === 4 ? 32 : 128))) || address === '0.0.0.0' || address === '::') throw new Error('TRUSTED_PROXY_CIDRS requires explicit IP addresses or nonzero CIDR networks; unrestricted trust is forbidden.');
  }
  return [...new Set(peers)];
}
