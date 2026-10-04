import { useMemo, useState } from 'react';
import { useFeed } from '../store/feedStore';
import { checkFeed, issueLocationLabel, type FeedIssue, type FeedSnapshot } from '../utils/feedChecks';
import { LINK_CHECK_LIMIT, type LinkSummary } from '../utils/linkCheck';

// A feed with thousands of tracks can produce thousands of items; past this many a
// group says how many more there are instead of rendering them all.
const MAX_ITEMS_SHOWN = 100;

/**
 * The Feed check panel at the top of the editor. Opens by itself after an
 * import; otherwise "Check feed" opens it for whatever feed is loaded. Every
 * group is recomputed from the current feed on each render, so an item goes
 * away the moment the user fixes it. Advisory only — nothing here blocks.
 */
export function FeedCheckPanel() {
  const { state, dispatch } = useFeed();
  const [showOutdated, setShowOutdated] = useState(false);
  const check = state.feedCheck;
  const isOpen = check.open && check.feedType === state.feedType;

  const album = state.feedType === 'video' && state.videoFeed ? state.videoFeed : state.album;
  const feed: FeedSnapshot = useMemo(
    () => ({ feedType: state.feedType, album, publisherFeed: state.publisherFeed }),
    [state.feedType, album, state.publisherFeed]
  );
  const report = useMemo(
    () => (isOpen ? checkFeed(feed, check.sourceFindings, check.links) : null),
    [isOpen, feed, check.sourceFindings, check.links]
  );

  if (!report) {
    return (
      <div className="feed-check-launcher">
        <button
          type="button"
          className="btn btn-secondary btn-small"
          onClick={() => dispatch({ type: 'OPEN_FEED_CHECK' })}
          title="Check this feed for problems and outdated tags"
        >
          Check feed
        </button>
      </div>
    );
  }

  const checking = !!check.linkRun?.targets.some(target => !(target.url in check.links));
  const nothingToFix = report.must.length === 0 && report.should.length === 0;

  return (
    <section className="feed-check" aria-label="Feed check">
      <div className="feed-check-header">
        <h2>Feed check</h2>
        <div className="feed-check-actions">
          <button
            type="button"
            className="btn btn-secondary btn-small"
            onClick={() => dispatch({ type: 'RUN_LINK_CHECK' })}
            disabled={checking}
          >
            Check links again
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-small"
            onClick={() => dispatch({ type: 'CLOSE_FEED_CHECK' })}
            aria-label="Close feed check"
          >
            &#10005;
          </button>
        </div>
      </div>

      <p className="feed-check-links" aria-live="polite">{linkLine(report.links, checking)}</p>

      {nothingToFix && <p className="feed-check-clean">&#10003; Nothing to fix.</p>}

      <IssueGroup tone="error" title={'✖ Must fix before publishing'} issues={report.must} feed={feed} />
      <IssueGroup tone="warning" title={'⚠ Should fix'} issues={report.should} feed={feed} />

      {report.outdated.length > 0 && (
        <div className="feed-check-group feed-check-group--info">
          <button
            type="button"
            className="feed-check-toggle"
            aria-expanded={showOutdated}
            onClick={() => setShowOutdated(open => !open)}
          >
            {showOutdated ? '▾' : '▸'} &#8635; Updated by MSP when you save ({report.outdated.length})
          </button>
          {showOutdated && <IssueList issues={report.outdated} feed={feed} />}
        </div>
      )}
    </section>
  );
}

function linkLine(links: LinkSummary, checking: boolean): string {
  if (links.total === 0) return 'No links to check.';
  const parts = [`Links checked: ${links.checked} of ${links.total}`];
  if (links.broken > 0) parts.push(`${links.broken} couldn't load`);
  if (links.httpSkipped > 0) parts.push(`${links.httpSkipped} use http:// (not checked)`);
  if (links.limited) parts.push(`MSP checks the first ${LINK_CHECK_LIMIT}`);
  return parts.join(' — ') + (checking ? ' · checking…' : '');
}

function IssueGroup({ tone, title, issues, feed }: { tone: 'error' | 'warning'; title: string; issues: FeedIssue[]; feed: FeedSnapshot }) {
  if (issues.length === 0) return null;
  return (
    <div className={`feed-check-group feed-check-group--${tone}`}>
      <h3>{title} ({issues.length})</h3>
      <IssueList issues={issues} feed={feed} />
    </div>
  );
}

function IssueList({ issues, feed }: { issues: FeedIssue[]; feed: FeedSnapshot }) {
  const hidden = issues.length - MAX_ITEMS_SHOWN;
  return (
    <ul>
      {issues.slice(0, MAX_ITEMS_SHOWN).map((issue, i) => (
        <li key={`${issue.code}-${issue.trackId ?? issue.area}-${i}`}>
          <span className="feed-check-where">{issueLocationLabel(issue, feed)}:</span> {issue.message}
        </li>
      ))}
      {hidden > 0 && <li>…and {hidden} more.</li>}
    </ul>
  );
}
