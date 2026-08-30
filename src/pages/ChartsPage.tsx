import { useEffect, useMemo, useState } from 'react';

/**
 * The public music chart.
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
            <li key={`${row.title}-${row.artist ?? ''}`} className="chart-row">
              <span className="chart-rank">{i + 1}</span>
              <span className="chart-track">
                <span className="chart-title">{row.title}</span>
                {row.artist && <span className="chart-artist">{row.artist}</span>}
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
  const [data, setData] = useState<ChartResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<string>(ALL_TIME);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/boosts/chart')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('Could not load the chart'))))
      .then(json => { if (!cancelled) setData(json); })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load the chart'); });
    return () => { cancelled = true; };
  }, []);

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
        <p className="charts-intro">
          What listeners are playing and boosting on music feeds made with MSP,
          paid in Bitcoin over the Lightning Network.
        </p>

        {error && <div className="charts-error">{error}</div>}
        {!data && !error && <div className="charts-loading">Loading the chart…</div>}

        {data && (
          <>
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
      </main>
    </div>
  );
}
