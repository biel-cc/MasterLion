import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export const isPrivateAddress = (address: string): boolean => {
  if (address === '::1' || address === '0:0:0:0:0:0:0:1') return true;
  if (address.startsWith('fe80:') || address.startsWith('fc') || address.startsWith('fd')) return true;
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) || a >= 224;
};

export const assertPublicHostname = async (hostname: string): Promise<void> => {
  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw new Error('ssrf_target_rejected');
    return;
  }
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new Error('ssrf_target_rejected');
  }
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error('ssrf_target_rejected');
  }
};
