/** Wording for the /charts page, kept apart from the components so it can be tested. */

export type ChartView = 'songs' | 'artists';

/**
 * "3 listeners", or "3+ listeners" when some payments named no sender — those could be
 * any number of further people. Nothing at all when no payment named anyone.
 */
export function listenerText(listeners: number, unattributed: number): string | null {
  if (listeners === 0) return null;
  const plus = unattributed > 0 ? '+' : '';
  return `${listeners}${plus} ${listeners === 1 && !plus ? 'listener' : 'listeners'}`;
}

/** What a closed list says under its heading: how much is behind it. */
export function foldSummary(count: number, view: ChartView, newOnly: boolean): string {
  if (count === 0) return newOnly ? 'Nothing new' : 'Nothing yet';
  const noun = view === 'songs' ? 'song' : 'artist';
  return `${count} ${newOnly ? 'new ' : ''}${noun}${count === 1 ? '' : 's'}`;
}
