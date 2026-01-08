// Shared comparison utilities for MSP 2.0
import type { ValueBlock, Person, PersonRole } from '../types/feed';

/**
 * Compare two value blocks for equality by checking recipient addresses
 * Uses Set-based comparison for order-independent matching
 */
export function areValueBlocksEqual(a: ValueBlock, b: ValueBlock): boolean {
  if (a.recipients.length !== b.recipients.length) return false;

  const aAddresses = new Set(a.recipients.map(r => r.address));
  const bAddresses = new Set(b.recipients.map(r => r.address));

  if (aAddresses.size !== bAddresses.size) return false;

  for (const addr of aAddresses) {
    if (!bAddresses.has(addr)) return false;
  }

  return true;
}

/**
 * Compare two value blocks by index for strict equality
 * Checks name, address, split, and type in order
 */
export function areValueBlocksStrictEqual(a: ValueBlock, b: ValueBlock): boolean {
  if (a.recipients.length !== b.recipients.length) return false;

  for (let i = 0; i < a.recipients.length; i++) {
    const ra = a.recipients[i];
    const rb = b.recipients[i];
    if (ra.name !== rb.name || ra.address !== rb.address ||
        ra.split !== rb.split || ra.type !== rb.type) {
      return false;
    }
  }
  return true;
}

/**
 * Compare two role arrays for equality (order-independent)
 */
function areRolesEqual(a: PersonRole[], b: PersonRole[]): boolean {
  if (a.length !== b.length) return false;

  // Create a set of role keys for comparison
  const aKeys = new Set(a.map(r => `${r.group}|${r.role}`));
  const bKeys = new Set(b.map(r => `${r.group}|${r.role}`));

  if (aKeys.size !== bKeys.size) return false;

  for (const key of aKeys) {
    if (!bKeys.has(key)) return false;
  }

  return true;
}

/**
 * Compare two person arrays for equality
 * Checks name and roles (order-independent for roles)
 */
export function arePersonsEqual(a: Person[], b: Person[]): boolean {
  if (a.length !== b.length) return false;

  for (let i = 0; i < a.length; i++) {
    if (a[i].name !== b[i].name) return false;
    if (!areRolesEqual(a[i].roles, b[i].roles)) return false;
  }
  return true;
}
