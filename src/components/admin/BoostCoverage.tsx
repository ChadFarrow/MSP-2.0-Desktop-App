import { useCallback, useEffect, useState } from 'react';
import { fetchBoostCoverage } from '../../utils/adminAuth';
import type { BoostCoverageResponse, BoostCoverageSummary } from '../../utils/adminAuth';

/**
 * The phase 1 question, answered: what share of captured boosts can be resolved to a
 * real track, and by which signal?
 *
 * Deliberately a table and not a chart. Until this report says a Top 10 is buildable,
 * there is nothing worth charting — and a chart library would be dead weight on a
 * bundle this repo keeps a close eye on.
 */

/** Best first. The order is the resolution ladder in api/_utils/boostRecord.ts. */
const SOURCE_ROWS: { key: string; label: string; note: string }[] = [
  { key: 'remote-guid', label: 'Remote guids', note: 'Canonical. Joins to a feed and a track.' },
  { key: 'remote-title', label: 'Remote titles', note: 'Helipad resolved the guids for us.' },
  { key: 'boost-link', label: 'Boost link', note: "The app's own song URL. Stable, but only within that app." },
  { key: 'timesplit', label: 'Playback position', note: 'Needs the show feed fetched to resolve. Not done yet.' },
  { key: 'message', label: 'Message text', note: 'Scraped from free text. Least reliable.' },
  { key: 'none', label: 'Nothing', note: 'No track signal at all.' }
];

function pct(part: number, whole: number): string {
  if (whole === 0) return '—';
  return `${Math.round((part / whole) * 100)}%`;
}

function Summary({ summary }: { summary: BoostCoverageSummary }) {
  if (summary.boosts === 0) {
    return <p className="text-muted">No boosts captured yet for this view.</p>;
  }

  return (
    <>
      <p className="text-muted">
        {summary.boosts} boosts · {summary.distinctTracks} distinct tracks ·{' '}
        {summary.satsTotal.toLocaleString()} sats sent by listeners ·{' '}
        {summary.satsReceived.toLocaleString()} sats received
      </p>

      <h4>How the track was identified</h4>
      <table className="admin-table">
        <thead>
          <tr><th>Signal</th><th>Boosts</th><th>Share</th><th>What it means</th></tr>
        </thead>
        <tbody>
          {SOURCE_ROWS.map(row => (
            <tr key={row.key}>
              <td>{row.label}</td>
              <td>{summary.bySource[row.key] ?? 0}</td>
              <td>{pct(summary.bySource[row.key] ?? 0, summary.boosts)}</td>
              <td className="text-muted">{row.note}</td>
            </tr>
          ))}
          <tr>
            <td><strong>Has a usable track key</strong></td>
            <td><strong>{summary.keyed}</strong></td>
            <td><strong>{pct(summary.keyed, summary.boosts)}</strong></td>
            <td className="text-muted">A weekly Top 10 can only count these.</td>
          </tr>
          <tr>
            <td>Has a readable title</td>
            <td>{summary.named}</td>
            <td>{pct(summary.named, summary.boosts)}</td>
            <td className="text-muted">
              {summary.withMessageTitle} of these came from the message text.
            </td>
          </tr>
        </tbody>
      </table>

      <h4>By week</h4>
      <table className="admin-table">
        <thead>
          <tr><th>Week</th><th>Boosts</th><th>Distinct tracks</th><th>Sats sent</th></tr>
        </thead>
        <tbody>
          {summary.byWeek.map(week => (
            <tr key={week.week}>
              <td>{week.week}</td>
              <td>{week.boosts}</td>
              <td>{week.tracks}</td>
              <td>{week.satsTotal.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h4>By app</h4>
      <table className="admin-table">
        <thead>
          <tr><th>App</th><th>Boosts</th><th>Share</th></tr>
        </thead>
        <tbody>
          {summary.byApp.map(app => (
            <tr key={app.app}>
              <td>{app.app}</td>
              <td>{app.boosts}</td>
              <td>{pct(app.boosts, summary.boosts)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export function BoostCoverage({ onError }: { onError: (message: string | null) => void }) {
  const [data, setData] = useState<BoostCoverageResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [scope, setScope] = useState<'msp' | 'everything'>('msp');

  const load = useCallback(async () => {
    setLoading(true);
    onError(null);
    try {
      setData(await fetchBoostCoverage());
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Failed to load boost coverage');
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="admin-feed-list">
      <div className="admin-feed-header">
        <h3>Boost coverage</h3>
        <button className="btn btn-secondary btn-small" onClick={() => void load()} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {!data && loading && <div className="admin-loading">Loading boosts…</div>}

      {data && (
        <>
          <p className="text-muted">
            {data.totals.mspSplit} of {data.totals.all} captured boosts paid the MSP 2.0 split.
            The other {data.totals.other} went to a different recipient on the same node.
          </p>

          <div className="admin-feed-header">
            <button
              className={`btn btn-small ${scope === 'msp' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setScope('msp')}
            >
              MSP splits
            </button>
            <button
              className={`btn btn-small ${scope === 'everything' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setScope('everything')}
            >
              Everything on the node
            </button>
          </div>

          <Summary summary={scope === 'msp' ? data.msp : data.everything} />
        </>
      )}
    </div>
  );
}
