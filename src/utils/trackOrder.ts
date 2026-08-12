// Track ordering helpers.
//
// RSS consumers overwhelmingly sort <item> elements newest-first, so an album only plays in
// the right order if track 1 carries the *newest* pubDate. Nothing else in the feed pipeline
// staggers or sorts item dates — the generator emits album.tracks verbatim — so these helpers
// are the single place that keeps "position in the editor list" and "pubDate" agreeing.

import type { Track } from '../types/feed';
import { formatRFC822Date } from './dateUtils';

// Gap between consecutive tracks when we have to invent dates.
export const TRACK_DATE_STEP_MS = 60_000;

const parseTime = (value: string | undefined): number | null => {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
};

/**
 * pubDate for a track appended to the end of the list: one step older than the current
 * oldest track, so tracks added in order come out strictly descending with no extra work.
 * Falls back to the album's own pubDate for the first track, then to now.
 */
export function nextTrackPubDate(tracks: Track[], albumPubDate: string): string {
  const times = tracks.map(t => parseTime(t.pubDate)).filter((n): n is number => n !== null);

  if (times.length > 0) {
    return formatRFC822Date(new Date(Math.min(...times) - TRACK_DATE_STEP_MS));
  }

  const albumTime = parseTime(albumPubDate);
  return formatRFC822Date(new Date(albumTime ?? Date.now()));
}

/**
 * Reassign pubDates so they descend strictly down the list.
 *
 * The existing dates are preserved as a multiset — sorted descending and handed back out by
 * index — so an episodic feed's real publish dates survive a reorder instead of being
 * collapsed into one-minute steps. Ties and unparseable dates are spread by
 * TRACK_DATE_STEP_MS; a list with no usable dates at all is laddered from albumPubDate.
 *
 * Idempotent: input that already descends strictly comes back unchanged.
 */
export function resequenceTrackDates(tracks: Track[], albumPubDate: string): Track[] {
  if (tracks.length === 0) return tracks;

  const times = tracks
    .map(t => parseTime(t.pubDate))
    .filter((n): n is number => n !== null)
    .sort((a, b) => b - a);

  const anchor = times[0] ?? parseTime(albumPubDate) ?? Date.now();

  let previous = Infinity;
  return tracks.map((track, i) => {
    let time = times[i] ?? anchor - i * TRACK_DATE_STEP_MS;
    if (time >= previous) time = previous - TRACK_DATE_STEP_MS;
    previous = time;

    const pubDate = formatRFC822Date(new Date(time));
    return pubDate === track.pubDate ? track : { ...track, pubDate };
  });
}

/**
 * Detect a track list whose order won't survive the trip through a podcast app.
 *
 * 'reversed' — every track carries an episode number and they descend down the list, i.e. an
 *              imported newest-first feed where track 1 sits at the bottom.
 * 'dates'    — pubDates don't descend strictly. Includes the all-identical case an import
 *              with no <pubDate> produces, since a tie leaves the order up to the app.
 */
export function trackOrderIssue(tracks: Track[]): 'reversed' | 'dates' | null {
  if (tracks.length < 2) return null;

  const episodes: (number | undefined)[] = tracks.map(t => t.episode);
  const allNumbered = episodes.every(e => typeof e === 'number');
  const episodesDescend = episodes.every((episode, i) => {
    if (i === 0) return true;
    const previous = episodes[i - 1];
    return episode !== undefined && previous !== undefined && episode < previous;
  });
  if (allNumbered && episodesDescend) return 'reversed';

  const times = tracks.map(t => parseTime(t.pubDate));
  const descends = times.every((time, i) => {
    if (i === 0) return true;
    const previous = times[i - 1];
    return time !== null && previous !== null && time < previous;
  });

  return descends ? null : 'dates';
}
