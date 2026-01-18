// Address type detection for Lightning payments

export type AddressType = 'lnaddress' | 'node';

/**
 * Detects whether an address is a Lightning address (user@domain) or a node pubkey
 */
export function detectAddressType(address: string): AddressType {
  return address.includes('@') ? 'lnaddress' : 'node';
}
