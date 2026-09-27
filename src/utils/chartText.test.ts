import { describe, it, expect } from 'vitest';
import { foldSummary, listenerText } from './chartText';

describe('foldSummary', () => {
  it('says how many songs or artists a closed list holds', () => {
    expect(foldSummary(62, 'songs', false)).toBe('62 songs');
    expect(foldSummary(27, 'artists', false)).toBe('27 artists');
  });

  it('uses the singular for one', () => {
    expect(foldSummary(1, 'songs', false)).toBe('1 song');
    expect(foldSummary(1, 'artists', false)).toBe('1 artist');
  });

  it('says "new" when only new rows are shown', () => {
    expect(foldSummary(3, 'songs', true)).toBe('3 new songs');
    expect(foldSummary(1, 'artists', true)).toBe('1 new artist');
  });

  it('says so when a list is empty, rather than "0 songs"', () => {
    expect(foldSummary(0, 'songs', false)).toBe('Nothing yet');
    expect(foldSummary(0, 'artists', true)).toBe('Nothing new');
  });
});

describe('listenerText', () => {
  it('counts listeners, with "+" when some payments named no sender', () => {
    expect(listenerText(3, 0)).toBe('3 listeners');
    expect(listenerText(3, 2)).toBe('3+ listeners');
    expect(listenerText(1, 0)).toBe('1 listener');
    expect(listenerText(1, 1)).toBe('1+ listeners');
  });

  it('says nothing when no payment named anyone', () => {
    expect(listenerText(0, 4)).toBeNull();
  });
});
