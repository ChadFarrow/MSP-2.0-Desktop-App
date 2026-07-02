import { describe, it, expect } from 'vitest';
import { getValueRecipientErrors } from './valueValidation';
import type { ValueRecipient } from '../types/feed';

function rec(partial: Partial<ValueRecipient>): ValueRecipient {
  return { name: '', address: '', split: 0, type: 'lnaddress', ...partial };
}

describe('getValueRecipientErrors', () => {
  it('returns no errors for an empty or undefined list', () => {
    expect(getValueRecipientErrors([], 'Value recipient')).toEqual([]);
    expect(getValueRecipientErrors(undefined, 'Value recipient')).toEqual([]);
  });

  it('flags a recipient with a 0 split', () => {
    const errors = getValueRecipientErrors([rec({ name: 'Alice', address: 'alice@x.com', split: 0 })], 'Value recipient');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('Alice');
    expect(errors[0]).toContain('split');
  });

  it('flags an empty/NaN split', () => {
    const errors = getValueRecipientErrors([rec({ name: 'Bob', split: NaN })], 'Value recipient');
    expect(errors).toHaveLength(1);
  });

  it('flags a negative split', () => {
    expect(getValueRecipientErrors([rec({ name: 'Neg', split: -5 })], 'Value recipient')).toHaveLength(1);
  });

  it('passes a recipient with a positive split', () => {
    expect(getValueRecipientErrors([rec({ name: 'Alice', split: 94 })], 'Value recipient')).toEqual([]);
  });

  it('passes community-support recipients (split 1)', () => {
    const support = [
      rec({ name: 'MSP 2.0', address: 'chadf@getalby.com', split: 1 }),
      rec({ name: 'Podcastindex.org', address: 'podcastindex@getalby.com', split: 1 })
    ];
    expect(getValueRecipientErrors(support, 'Value recipient')).toEqual([]);
  });

  it('uses the label prefix in the message', () => {
    const errors = getValueRecipientErrors([rec({ name: 'Alice', split: 0 })], 'Track 2 value recipient');
    expect(errors[0]).toContain('Track 2 value recipient');
  });

  it('falls back to address, then to index, when the name is empty', () => {
    const byAddress = getValueRecipientErrors([rec({ name: '', address: 'zap@me.com', split: 0 })], 'Value recipient');
    expect(byAddress[0]).toContain('zap@me.com');
    const byIndex = getValueRecipientErrors([rec({ name: '', address: '', split: 0 })], 'Value recipient');
    expect(byIndex[0]).toContain('#1');
  });

  it('reports every offender', () => {
    const errors = getValueRecipientErrors([
      rec({ name: 'Good', split: 50 }),
      rec({ name: 'Bad1', split: 0 }),
      rec({ name: 'Bad2', split: NaN })
    ], 'Value recipient');
    expect(errors).toHaveLength(2);
  });
});
