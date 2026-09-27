import { useEffect, useMemo, useRef, useState } from 'react';
import { useNostr } from '../store/nostrStore';
import { createAdminAuthHeader } from '../utils/adminAuth';
import { Sparkline, SupportPerMonth } from '../components/charts/TrendGraphs';
import type { Trend } from '../components/charts/TrendGraphs';
import { foldSummary, listenerText } from '../utils/chartText';
import type { ChartView } from '../utils/chartText';

/**
 * The music chart — admin-only for now, like its API (see api/boosts/chart.ts).
 * Until an admin signs in, the page shows nothing about the chart at all.
 *
 * It is written for people new to Value for Value music: every term on the page is
 * explained where it appears, because "boost", "stream" and "sats" mean nothing yet to
 * the reader it is for.
 *
 * Counts only — no sats appear here. The chart is about what people listened to, not
 * what anyone earned, and these are other people's feeds. Listener counts are counts too:
 * the API never sends the keys behind them.
 *
 * The honesty note at the bottom is not decoration. MSP only sees a boost when its own
 * 1% split was actually paid, and small splits are frequently dropped by player apps.
 * Presenting a sample as a total would misrepresent every artist on the page.
 */

const mspLogo = '/msp-logo-192.png';

interface SongRow {
  title: string;
  artist?: string;
  count: number;
  /** Distinct listeners: one sender in one app. */
  listeners: number;
  /** Payments in the row that named no sender, so they reach no listener count. */
  unattributed: number;
  /** Other artist spellings the API merged into this row; shown so a wrong merge is visible. */
  mergedFrom?: string[];
  /** First supported in this month. Month views only. */
  isNew?: true;
  /** Count per month along `trend.months`. All time only. */
  trend?: number[];
}

interface ArtistRow {
  artist: string;
  count: number;
  songs: number;
  listeners: number;
  unattributed: number;
  /** Album-only names the API gave to this artist; shown so a wrong join is visible. */
  mergedFrom?: string[];
  isNew?: true;
  trend?: number[];
}

interface PeriodChart {
  streams: SongRow[];
  boosts: SongRow[];
  artistStreams: ArtistRow[];
  artistBoosts: ArtistRow[];
  totalStreams: number;
  totalBoosts: number;
  listeners: number;
  unattributed: number;
}

interface MonthChart extends PeriodChart {
  month: string;
  label: string;
}

interface ChartResponse {
  generatedAt: number;
  months: MonthChart[];
  allTime: PeriodChart;
  trend: Trend;
}

/** What one line of a list shows, whether it is a song or an artist. */
interface ListRow {
  title: string;
  subtitle?: string;
  count: number;
  listeners: number;
  unattributed: number;
  mergedFrom?: string[];
  isNew?: true;
  trend?: number[];
}

const ALL_TIME = 'all-time';

function fromSongs(rows: SongRow[]): ListRow[] {
  return rows.map(row => ({ ...row, subtitle: row.artist }));
}

function fromArtists(rows: ArtistRow[]): ListRow[] {
  return rows.map(row => ({
    ...row,
    title: row.artist,
    subtitle: row.songs === 1 ? '1 song' : `${row.songs} songs`
  }));
}

/** The UTC month (`YYYY-MM`) of a time in milliseconds, as the API buckets it. */
function monthOf(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * One ranked list, folded shut until the reader opens it: the full lists run to dozens of
 * rows, and on a phone two of them bury everything below. The heading says how much is
 * behind it, and a native <details> gives the fold its keyboard and screen-reader
 * behaviour for free. It stays mounted across periods and views, so a list the reader
 * opened stays open while they browse.
 */
function ChartList({ title, blurb, rows, unit, empty, summary, months, thisMonth }: {
  title: string;
  blurb: string;
  rows: ListRow[];
  unit: string;
  empty: string;
  /** What the closed list says under its heading, e.g. "62 songs". */
  summary: string;
  /** The trend's months, when the rows carry a trend (all time only). */
  months?: string[];
  thisMonth: string;
}) {
  const panel = useRef<HTMLElement>(null);
  const fold = useRef<HTMLDetailsElement>(null);

  // Closing from the bottom of a long list would leave the reader far below the panel.
  const hide = () => {
    if (fold.current) fold.current.open = false;
    if (panel.current && panel.current.getBoundingClientRect().top < 0) {
      panel.current.scrollIntoView({ block: 'start' });
    }
  };

  return (
    <section ref={panel} className="chart-panel">
      <details ref={fold} className="chart-fold">
        <summary className="chart-fold-summary">
          <h2 className="chart-panel-title">{title}</h2>
          <span className="chart-fold-count">{summary}</span>
        </summary>
        <p className="chart-panel-blurb">{blurb}</p>

        {rows.length === 0 ? (
          <p className="chart-empty">{empty}</p>
        ) : (
          <ol className="chart-list">
            {rows.map((row, i) => {
              const listeners = listenerText(row.listeners, row.unattributed);
              return (
                <li key={i} className="chart-row">
                  <span className="chart-rank">{i + 1}</span>
                  <span className="chart-track">
                    <span className="chart-title">
                      {row.title}
                      {row.isNew && <span className="chart-new">New</span>}
                    </span>
                    {row.subtitle && <span className="chart-artist">{row.subtitle}</span>}
                    {row.mergedFrom && row.mergedFrom.length > 0 && (
                      <span className="chart-merged" title="Counted together: these names were read as the same artist">
                        ⚭ merged: {row.mergedFrom.join(' · ')}
                      </span>
                    )}
                  </span>
                  <span className="chart-count">
                    {months && row.trend && (
                      <Sparkline months={months} values={row.trend} unit={unit.trim()} thisMonth={thisMonth} />
                    )}
                    {row.count}
                    <span className="chart-unit">{row.count === 1 ? unit : `${unit}s`}</span>
                    {listeners && <span className="chart-listeners">{listeners}</span>}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
        {rows.length > 0 && (
          <button type="button" className="chart-fold-hide" onClick={hide}>Hide list</button>
        )}
      </details>
    </section>
  );
}

export function ChartsPage() {
  const { state: nostrState, login } = useNostr();
  const [data, setData] = useState<ChartResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<string>(ALL_TIME);
  const [view, setView] = useState<ChartView>('songs');
  const [onlyNew, setOnlyNew] = useState(false);

  // Same gate as AdminPage, and for the same reason: wait for isLoading, or the
  // 500ms NIP-07 injection wait flashes "no extension" on every load.
  const signedIn = !nostrState.isLoading && nostrState.hasExtension && nostrState.isLoggedIn;

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    (async () => {
      try {
        const url = `${window.location.origin}/api/boosts/chart`;
        const response = await fetch('/api/boosts/chart', {
          headers: { 'Authorization': await createAdminAuthHeader(url, 'GET') }
        });
        if (response.status === 401) throw new Error('This chart is private for now.');
        if (!response.ok) throw new Error('Could not load the chart');
        const json = await response.json();
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load the chart');
      }
    })();
    return () => { cancelled = true; };
  }, [signedIn]);

  const current = useMemo(() => {
    if (!data) return null;
    if (period === ALL_TIME) return { ...data.allTime, label: 'All time' };
    const month = data.months.find(m => m.month === period);
    return month ?? null;
  }, [data, period]);

  // "New" only means something inside one month; all time has no "new".
  const newOnly = onlyNew && period !== ALL_TIME;

  const lists = useMemo(() => {
    if (!current) return null;
    const boosts = view === 'songs' ? fromSongs(current.boosts) : fromArtists(current.artistBoosts);
    const streams = view === 'songs' ? fromSongs(current.streams) : fromArtists(current.artistStreams);
    const keep = (rows: ListRow[]) => (newOnly ? rows.filter(r => r.isNew) : rows);
    return { boosts: keep(boosts), streams: keep(streams) };
  }, [current, view, newOnly]);

  const periodListeners = current ? listenerText(current.listeners, current.unattributed) : null;
  const thisMonth = data ? monthOf(data.generatedAt) : '';
  const trendMonths = period === ALL_TIME ? data?.trend.months : undefined;
  const empty = newOnly ? 'Nothing new in this list this month.' : 'Nothing charted for this period yet.';

  return (
    <div className="charts-page">
      <header className="header">
        <div className="header-title">
          <img src={mspLogo} alt="MSP Logo" className="header-logo" />
          <h1>MSP Charts</h1>
        </div>
        <div className="header-actions">
          <a href="/" className="btn btn-secondary btn-small">Make a feed</a>
        </div>
      </header>

      <main className="charts-main">
        {nostrState.isLoading && <div className="charts-loading">Checking sign-in…</div>}
        {!nostrState.isLoading && !signedIn && (
          <div className="charts-loading">
            <p>This chart is private for now.</p>
            {nostrState.hasExtension && (
              <button className="btn btn-primary btn-small" onClick={() => login()}>
                Sign in with Nostr
              </button>
            )}
          </div>
        )}

        {error && <div className="charts-error">{error}</div>}
        {signedIn && !data && !error && <div className="charts-loading">Loading the chart…</div>}

        {data && (
          <>
            <p className="charts-intro">
              What people are listening to and supporting on music feeds made with MSP. In
              podcast apps that support Value for Value, listeners pay artists directly in
              sats — small amounts of bitcoin — while they listen. These charts count those
              payments.
            </p>

            <div className="chart-periods">
              <button
                className={`chart-period ${period === ALL_TIME ? 'is-active' : ''}`}
                onClick={() => setPeriod(ALL_TIME)}
              >
                All time
              </button>
              {data.months.map(m => (
                <button
                  key={m.month}
                  className={`chart-period ${period === m.month ? 'is-active' : ''}`}
                  onClick={() => setPeriod(m.month)}
                >
                  {m.label}
                </button>
              ))}
            </div>

            <div className="chart-views">
              <div className="chart-view-switch" role="group" aria-label="Show">
                {(['songs', 'artists'] as const).map(v => (
                  <button
                    key={v}
                    className={`chart-period ${view === v ? 'is-active' : ''}`}
                    aria-pressed={view === v}
                    onClick={() => setView(v)}
                  >
                    {v === 'songs' ? 'Songs' : 'Artists'}
                  </button>
                ))}
              </div>
              {period !== ALL_TIME && (
                <button
                  className={`chart-period ${onlyNew ? 'is-active' : ''}`}
                  aria-pressed={onlyNew}
                  onClick={() => setOnlyNew(!onlyNew)}
                >
                  Only new
                </button>
              )}
            </div>

            {current && lists && (
              <>
                <p className="chart-summary">
                  <strong>{current.label}</strong> — {current.totalStreams} streams and{' '}
                  {current.totalBoosts} boosts{periodListeners && <> from {periodListeners}</>}
                </p>

                <div className="chart-grid">
                  <ChartList
                    title="Most boosted"
                    blurb="A boost is a payment a listener sends while a song plays, often with a message. This counts both the boosts people send by hand and the automatic boosts some apps send for each song played."
                    rows={lists.boosts}
                    unit=" boost"
                    empty={empty}
                    summary={foldSummary(lists.boosts.length, view, newOnly)}
                    months={trendMonths}
                    thisMonth={thisMonth}
                  />
                  <ChartList
                    title="Most streamed"
                    blurb="Streaming pays a few sats for each minute of listening. One listener's time on a song counts once."
                    rows={lists.streams}
                    unit=" stream"
                    empty={empty}
                    summary={foldSummary(lists.streams.length, view, newOnly)}
                    months={trendMonths}
                    thisMonth={thisMonth}
                  />
                  {period === ALL_TIME && data.trend.months.length > 0 && (
                    <SupportPerMonth trend={data.trend} thisMonth={thisMonth} />
                  )}
                </div>
              </>
            )}

            <footer className="charts-note">
              <p>
                <strong>This is a sample, not a total.</strong> MSP only sees a payment when the
                small support split on a feed it generated is actually paid, and player apps
                routinely drop splits too small to send. Real listening is higher than these
                numbers, and an artist who removed the split does not appear here at all.
              </p>
              <p>
                <strong>Listeners.</strong> A listener is one person in one app, so the same
                person in two apps counts twice. Some apps do not say who sent a payment; a
                "+" means some payments in that row came without a name.
              </p>
              <p>
                <strong>Trends.</strong> In All time, the small graph beside each count shows
                its last twelve months, on its own scale, so you can see what is rising. The
                last, fainter column is this month so far.
              </p>
              <p>
                <strong>New.</strong> Marks a song or artist whose first payment MSP has seen
                came in that month.
              </p>
              <p>
                <strong>Artists</strong> are read from the names the apps send. When a name is
                only an album, it joins the artist another payment names for that album, and
                the "⚭ merged" line shows it.
              </p>
              <p>
                Counts only. No earnings are published here.
              </p>
            </footer>
          </>
        )}
      </main>
    </div>
  );
}
