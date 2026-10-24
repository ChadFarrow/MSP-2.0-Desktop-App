import { useState } from 'react';
import type { PublisherReference } from '../../types/feed';
import { getFeedUrlError, normalizeFeedUrl } from '../../utils/urlValidation';
import { isUsableParty, samePublisher, urlKey } from '../../utils/publisherParties';
import { lookupPublisherFeed } from '../../utils/publisherLookup';
import { withRole } from '../../utils/publisherRole';
import { BetaTag } from '../BetaTag';
import { InfoIcon } from '../InfoIcon';
import { FIELD_INFO } from '../../data/fieldInfo';
import { RolePicker } from '../RolePicker';

type LookupState = { loading: boolean; error: string | null; title: string | null };

const note = (color: string) => ({ color, fontSize: '12px', marginTop: '6px', marginBottom: 0 });

/**
 * The publishers after the primary one (album.additionalPublishers,
 * podcast-namespace PR #793). Each row gives a feed URL, looks up its GUID in
 * Podcast Index, and states a role.
 *
 * Beta: the Editor shows this list with "Show Beta Features" on, or when the
 * album already names other publishers, and only `canAdd` shows the way to add
 * one. An existing party stays editable either way, because MSP still writes it.
 *
 * A lookup answers after a network round trip, so its result is set by URL
 * (`onGuidFound` → SET_PUBLISHER_GUID) and its status is kept by URL too: a row
 * that was edited, moved by "Make primary" or removed meanwhile is never
 * written over, and never shows another publisher's result.
 */
export function AdditionalPublishers({
  primary,
  parties,
  canAdd,
  showRoles,
  onChange,
  onMakePrimary,
  onGuidFound,
}: {
  primary?: PublisherReference;
  parties: PublisherReference[];
  canAdd: boolean;
  showRoles: boolean;
  onChange: (parties: PublisherReference[]) => void;
  onMakePrimary: (index: number) => void;
  onGuidFound: (feedUrl: string, feedGuid: string) => void;
}) {
  const [lookups, setLookups] = useState<Record<string, LookupState>>({});

  const update = (index: number, party: PublisherReference) => {
    onChange(parties.map((existing, i) => (i === index ? party : existing)));
  };

  const lookup = async (feedUrl: string) => {
    const key = urlKey(feedUrl);
    setLookups(prev => ({ ...prev, [key]: { loading: true, error: null, title: null } }));
    const result = await lookupPublisherFeed(feedUrl);
    if (result.ok) onGuidFound(feedUrl, result.feed.feedGuid);
    setLookups(prev => ({
      ...prev,
      [key]: result.ok
        ? { loading: false, error: null, title: result.feed.title }
        : { loading: false, error: result.error, title: null }
    }));
  };

  const primaryUsable = isUsableParty(primary);

  return (
    <div className="form-group beta-field" style={{ marginTop: '20px' }}>
      <label className="form-label">Other publishers <BetaTag /><InfoIcon text={FIELD_INFO.otherPublishers} /></label>
      {!primaryUsable && parties.length > 0 && (
        <p style={{ ...note('var(--text-tertiary)'), marginTop: 0, marginBottom: '8px' }}>
          No primary publisher above: MSP writes the first publisher below first.
        </p>
      )}
      {parties.map((party, index) => {
        const feedUrl = normalizeFeedUrl(party.feedUrl || '');
        const state = feedUrl ? lookups[urlKey(feedUrl)] : undefined;
        const urlError = getFeedUrlError(feedUrl);
        // PR #793: one entry per party. The same feed twice looks like two.
        const others = [...(primaryUsable ? [primary] : []), ...parties.filter((_, i) => i !== index)];
        const duplicate = isUsableParty(party) && others.some(other => samePublisher(other, party));
        return (
          <div
            key={index}
            style={{ border: '1px solid var(--border-color)', borderRadius: '6px', padding: '12px', marginBottom: '12px' }}
          >
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                type="url"
                className="form-input"
                placeholder="https://example.com/label-feed.xml"
                aria-label={`Other publisher ${index + 1} feed URL`}
                value={party.feedUrl || ''}
                onChange={e => update(index, { ...party, feedGuid: '', feedUrl: normalizeFeedUrl(e.target.value) })}
                style={{ flex: '1 1 220px', ...(urlError ? { borderColor: 'var(--error, #ef4444)' } : {}) }}
              />
              <button
                className="btn btn-secondary"
                onClick={() => lookup(feedUrl)}
                disabled={!feedUrl || !!urlError || state?.loading}
                style={{ fontSize: '12px', padding: '6px 12px', whiteSpace: 'nowrap' }}
              >
                {state?.loading ? 'Looking up...' : 'Look up'}
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => onMakePrimary(index)}
                disabled={!isUsableParty(party)}
                title="Write this publisher first. An app that reads only one publisher shows the first."
                style={{ fontSize: '12px', padding: '6px 12px', whiteSpace: 'nowrap' }}
              >
                Make primary
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => onChange(parties.filter((_, i) => i !== index))}
                aria-label={`Remove other publisher ${index + 1}`}
                style={{ fontSize: '12px', padding: '6px 12px' }}
              >
                Remove
              </button>
            </div>
            {duplicate && (
              <p style={note('var(--error, #ef4444)')}>
                This publisher is already named. Give it one entry, with all its roles.
              </p>
            )}
            {urlError && <p style={note('var(--error, #ef4444)')}>{urlError}</p>}
            {state?.error && <p style={note('var(--warning-color, #f59e0b)')}>⚠ {state.error}</p>}
            {party.feedGuid ? (
              <p style={note('var(--success)')}>
                ✓ {state?.title ? `Found: ${state.title}` : `GUID ${party.feedGuid}`}
              </p>
            ) : (
              feedUrl && !urlError && !state?.loading && !state?.error && (
                <p style={note('var(--text-tertiary)')}>
                  Look up the feed to fill in its GUID. Apps need the GUID to confirm the link.
                </p>
              )
            )}
            {(showRoles || party.rel) && (
              <div style={{ marginTop: '8px' }}>
                <RolePicker rel={party.rel} info={FIELD_INFO.publisherRole} inBetaField onChange={rel => update(index, withRole(party, rel))} />
              </div>
            )}
          </div>
        );
      })}
      {canAdd && (
        <button
          className="btn btn-secondary"
          onClick={() => onChange([...parties, { feedGuid: '' }])}
          style={{ fontSize: '12px', padding: '6px 12px' }}
        >
          + Add another publisher
        </button>
      )}
    </div>
  );
}
