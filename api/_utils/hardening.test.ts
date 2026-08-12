import { describe, it, expect } from 'vitest';
import { timingSafeEqualString } from './feedUtils';

describe('timingSafeEqualString', () => {
  it('matches identical strings and rejects different ones', () => {
    expect(timingSafeEqualString('super-secret-admin-key', 'super-secret-admin-key')).toBe(true);
    expect(timingSafeEqualString('super-secret-admin-key', 'super-secret-admin-keX')).toBe(false);
  });

  it('rejects on length difference without throwing', () => {
    expect(timingSafeEqualString('short', 'considerably-longer')).toBe(false);
    expect(timingSafeEqualString('', 'x')).toBe(false);
    expect(timingSafeEqualString('', '')).toBe(true);
  });

  it('handles non-hex secrets, which timingSafeEqualHex cannot', () => {
    // The reason this helper exists: timingSafeEqualHex does Buffer.from(x, 'hex'),
    // which silently truncates anything non-hex — 'zz' and 'zq' both become an empty
    // buffer and compare EQUAL. MSP_ADMIN_KEY is free-form, so it needs this instead.
    expect(timingSafeEqualString('zz', 'zq')).toBe(false);
    expect(timingSafeEqualString('admin key with spaces!', 'admin key with spaces!')).toBe(true);
  });

  it('is not fooled by type confusion', () => {
    expect(timingSafeEqualString(undefined as unknown as string, 'x')).toBe(false);
    expect(timingSafeEqualString('x', null as unknown as string)).toBe(false);
  });
});
