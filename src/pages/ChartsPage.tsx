import { useEffect, useMemo, useState } from 'react';
import { useNostr } from '../store/nostrStore';
import { createAdminAuthHeader } from '../utils/adminAuth';

/**
 * The music chart — admin-only for now, like its API (see api/boosts/chart.ts).
 * Until an admin signs in, the page shows nothing about the chart at all.
 *
 * Counts only — no sats appear here. The chart is about what people listened to, not
 * what anyone earned, and these are other people's feeds.
 *
 * The honesty note at the bottom is not decoration. MSP only sees a boost when its own
 * 1% split was actually paid, and small splits are frequently dropped by player apps.
 * Presenting a sample as a total would misrepresent every artist on the page.
 */

const mspLogo = '/msp-logo-192.png';

interface ChartRow {
  title: string;
  artist?: string;
  count: number;
  /** Other artist spellings the API merged into this row; shown so a wrong merge is visible. */
  mergedFrom?: string[];
}

interface MonthChart {
  month: string;
  label: string;
  streams: ChartRow[];
  boosts: ChartRow[];
  totalStreams: number;
  totalBoosts: number;
}

interface ChartResponse {
  generatedAt: number;
  months: MonthChart[];
  allTime: Omit<MonthChart, 'month' | 'label'>;
}

const ALL_TIME = 'all-time';

function ChartList({ title, blurb, rows, unit }: {
  title: string;
  blurb: string;
  rows: ChartRow[];
  unit: string;
}) {
  return (
    <section className="chart-panel">
      <h2 className="chart-panel-title">{title}</h2>
      <p className="chart-panel-blurb">{blurb}</p>

      {rows.length === 0 ? (
        <p className="chart-empty">Nothing charted for this period yet.</p>
      ) : (
        <ol className="chart-list">
          {rows.map((row, i) => (
            <li key={i} className="chart-row">
              <span className="chart-rank">{i + 1}</span>
              <span className="chart-track">
                <span className="chart-title">{row.title}</span>
                {row.artist && <span className="chart-artist">{row.artist}</span>}
                {row.mergedFrom && row.mergedFrom.length > 0 && (
                  <span className="chart-merged" title="Counted together: the same title under these artist spellings">
                    ⚭ merged: {row.mergedFrom.join(' · ')}
                  </span>
                )}
              </span>
              <span className="chart-count">
                {row.count}
                <span className="chart-unit">{row.count === 1 ? unit : `${unit}s`}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function ChartsPage() {
  const { state: nostrState, login } = useNostr();
  const [data, setData] = useState<ChartResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<string>(ALL_TIME);

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
              What listeners are playing and boosting on music feeds made with MSP,
              paid in Bitcoin over the Lightning Network.
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

            {current && (
              <>
                <p className="chart-summary">
                  <strong>{current.label}</strong> — {current.totalStreams} streams and{' '}
                  {current.totalBoosts} boosts
                </p>

                <div className="chart-grid">
                  <ChartList
                    title="Most boosted"
                    blurb="Sats sent at a moment in a track — both boosts someone sent by hand and the auto-boosts their app sent when they played it."
                    rows={current.boosts}
                    unit=" boost"
                  />
                  <ChartList
                    title="Most streamed"
                    blurb="Counted from streaming sats, with one listener's run on a track counted once."
                    rows={current.streams}
                    unit=" stream"
                  />
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
                Counts only. No earnings are published here.
              </p>
            </footer>
          </>
        )}
      </main>
    </div>
  );
}
