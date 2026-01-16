import { useFeed } from '../../store/feedStore';
import { LANGUAGES, createEmptyRemoteItem } from '../../types/feed';
import { FIELD_INFO } from '../../data/fieldInfo';
import { InfoIcon } from '../InfoIcon';
import { Section } from '../Section';
import { Toggle } from '../Toggle';

// Field info for publisher-specific fields
const PUBLISHER_FIELD_INFO = {
  remoteItemFeedGuid: 'The podcast:guid of the feed you want to include in your publisher catalog. This is the unique identifier that links to the feed.',
  remoteItemFeedUrl: 'The URL of the RSS feed (optional but recommended). This helps apps find the feed if they cannot resolve the GUID.',
  remoteItemTitle: 'A display title for this feed (optional). If not provided, apps will fetch the title from the feed itself.',
};

export function PublisherEditor() {
  const { state, dispatch } = useFeed();
  const { publisherFeed } = state;

  if (!publisherFeed) {
    return (
      <div className="main-content">
        <div className="editor-panel">
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>
            No publisher feed loaded. Create a new publisher feed or import an existing one.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="main-content">
      <div className="editor-panel">
        {/* Publisher Info Section */}
        <Section title="Publisher Info" icon="&#127970;">
          <div className="form-grid">
            <div className="form-group">
              <label className="form-label">Publisher Name <span className="required">*</span><InfoIcon text={FIELD_INFO.author} /></label>
              <input
                type="text"
                className="form-input"
                placeholder="Enter publisher or label name"
                value={publisherFeed.author || ''}
                onChange={e => dispatch({ type: 'UPDATE_PUBLISHER_FEED', payload: { author: e.target.value } })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Catalog Title <span className="required">*</span><InfoIcon text={FIELD_INFO.title} /></label>
              <input
                type="text"
                className="form-input"
                placeholder="Enter catalog title"
                value={publisherFeed.title || ''}
                onChange={e => dispatch({ type: 'UPDATE_PUBLISHER_FEED', payload: { title: e.target.value } })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Website<InfoIcon text={FIELD_INFO.link} /></label>
              <input
                type="url"
                className="form-input"
                placeholder="https://yourlabel.com"
                value={publisherFeed.link || ''}
                onChange={e => dispatch({ type: 'UPDATE_PUBLISHER_FEED', payload: { link: e.target.value } })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Language <span className="required">*</span><InfoIcon text={FIELD_INFO.language} /></label>
              <select
                className="form-select"
                value={publisherFeed.language || 'en'}
                onChange={e => dispatch({ type: 'UPDATE_PUBLISHER_FEED', payload: { language: e.target.value } })}
              >
                {LANGUAGES.map(lang => (
                  <option key={lang.value} value={lang.value}>{lang.label}</option>
                ))}
              </select>
            </div>
            <div className="form-group full-width">
              <label className="form-label">Description <span className="required">*</span><InfoIcon text={FIELD_INFO.description} /></label>
              <textarea
                className="form-textarea"
                placeholder="Describe your label, catalog, or publishing entity..."
                value={publisherFeed.description || ''}
                onChange={e => dispatch({ type: 'UPDATE_PUBLISHER_FEED', payload: { description: e.target.value } })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Publisher GUID <span className="required">*</span><InfoIcon text={FIELD_INFO.podcastGuid} /></label>
              <input
                type="text"
                className="form-input"
                placeholder="Auto-generated UUID"
                value={publisherFeed.podcastGuid || ''}
                onChange={e => dispatch({ type: 'UPDATE_PUBLISHER_FEED', payload: { podcastGuid: e.target.value } })}
              />
            </div>
            <div className="form-group">
              <Toggle
                checked={publisherFeed.explicit}
                onChange={val => dispatch({ type: 'UPDATE_PUBLISHER_FEED', payload: { explicit: val } })}
                label="Explicit Content"
                labelSuffix={<InfoIcon text={FIELD_INFO.explicit} />}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Keywords<InfoIcon text={FIELD_INFO.keywords} /></label>
              <input
                type="text"
                className="form-input"
                placeholder="label, publisher, music, indie"
                value={publisherFeed.keywords || ''}
                onChange={e => dispatch({ type: 'UPDATE_PUBLISHER_FEED', payload: { keywords: e.target.value } })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Owner Name<InfoIcon text={FIELD_INFO.ownerName} /></label>
              <input
                type="text"
                className="form-input"
                placeholder="Your name or company name"
                value={publisherFeed.ownerName || ''}
                onChange={e => dispatch({ type: 'UPDATE_PUBLISHER_FEED', payload: { ownerName: e.target.value } })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Owner Email<InfoIcon text={FIELD_INFO.ownerEmail} /></label>
              <input
                type="email"
                className="form-input"
                placeholder="contact@yourlabel.com"
                value={publisherFeed.ownerEmail || ''}
                onChange={e => dispatch({ type: 'UPDATE_PUBLISHER_FEED', payload: { ownerEmail: e.target.value } })}
              />
            </div>
          </div>
        </Section>

        {/* Publisher Artwork Section */}
        <Section title="Publisher Artwork" icon="&#127912;">
          <div className="form-grid">
            <div className="form-group">
              <label className="form-label">Logo URL <span className="required">*</span><InfoIcon text={FIELD_INFO.imageUrl} /></label>
              <input
                type="url"
                className="form-input"
                placeholder="https://example.com/logo.jpg"
                value={publisherFeed.imageUrl || ''}
                onChange={e => dispatch({ type: 'UPDATE_PUBLISHER_FEED', payload: { imageUrl: e.target.value } })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Image Title<InfoIcon text={FIELD_INFO.imageTitle} /></label>
              <input
                type="text"
                className="form-input"
                placeholder="Publisher logo description"
                value={publisherFeed.imageTitle || ''}
                onChange={e => dispatch({ type: 'UPDATE_PUBLISHER_FEED', payload: { imageTitle: e.target.value } })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Image Description<InfoIcon text={FIELD_INFO.imageDescription} /></label>
              <input
                type="text"
                className="form-input"
                placeholder="Optional description"
                value={publisherFeed.imageDescription || ''}
                onChange={e => dispatch({ type: 'UPDATE_PUBLISHER_FEED', payload: { imageDescription: e.target.value } })}
              />
            </div>
            {publisherFeed.imageUrl && (
              <div className="form-group full-width">
                <img
                  src={publisherFeed.imageUrl}
                  alt="Publisher logo preview"
                  style={{ maxWidth: '200px', borderRadius: '8px', border: '1px solid var(--border-color)' }}
                  onError={e => (e.target as HTMLImageElement).style.display = 'none'}
                />
              </div>
            )}
          </div>
        </Section>

        {/* Catalog Feeds Section */}
        <Section title="Catalog Feeds" icon="&#128218;">
          <p style={{ color: 'var(--text-secondary)', marginBottom: '16px', fontSize: '14px' }}>
            Add the feeds that belong to this publisher. Each feed should have a GUID (from its podcast:guid tag) and optionally a feed URL.
          </p>
          <div className="repeatable-list">
            {publisherFeed.remoteItems.map((item, index) => (
              <div key={index} className="repeatable-item">
                <div className="repeatable-item-content">
                  <div className="form-grid">
                    <div className="form-group">
                      <label className="form-label">Feed GUID <span className="required">*</span><InfoIcon text={PUBLISHER_FIELD_INFO.remoteItemFeedGuid} /></label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                        value={item.feedGuid || ''}
                        onChange={e => dispatch({
                          type: 'UPDATE_REMOTE_ITEM',
                          payload: { index, item: { ...item, feedGuid: e.target.value } }
                        })}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Feed URL<InfoIcon text={PUBLISHER_FIELD_INFO.remoteItemFeedUrl} /></label>
                      <input
                        type="url"
                        className="form-input"
                        placeholder="https://example.com/feed.xml"
                        value={item.feedUrl || ''}
                        onChange={e => dispatch({
                          type: 'UPDATE_REMOTE_ITEM',
                          payload: { index, item: { ...item, feedUrl: e.target.value } }
                        })}
                      />
                    </div>
                    <div className="form-group full-width">
                      <label className="form-label">Display Title<InfoIcon text={PUBLISHER_FIELD_INFO.remoteItemTitle} /></label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="Optional display title"
                        value={item.title || ''}
                        onChange={e => dispatch({
                          type: 'UPDATE_REMOTE_ITEM',
                          payload: { index, item: { ...item, title: e.target.value } }
                        })}
                      />
                    </div>
                  </div>
                </div>
                <div className="repeatable-item-actions">
                  <button
                    className="btn btn-icon btn-danger"
                    onClick={() => dispatch({ type: 'REMOVE_REMOTE_ITEM', payload: index })}
                  >
                    &#10005;
                  </button>
                </div>
              </div>
            ))}
            <button
              className="add-item-btn"
              onClick={() => dispatch({ type: 'ADD_REMOTE_ITEM', payload: createEmptyRemoteItem() })}
            >
              + Add Feed
            </button>
          </div>
        </Section>

        {/* Funding Section */}
        <Section title="Funding" icon="&#128176;">
          <div className="form-grid">
            <div className="form-group">
              <label className="form-label">URL<InfoIcon text={FIELD_INFO.fundingUrl} /></label>
              <input
                type="url"
                className="form-input"
                placeholder="https://patreon.com/yourlabel"
                value={publisherFeed.funding?.[0]?.url || ''}
                onChange={e => dispatch({
                  type: 'UPDATE_PUBLISHER_FEED',
                  payload: { funding: [{ url: e.target.value, text: publisherFeed.funding?.[0]?.text || '' }] }
                })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Text<InfoIcon text={FIELD_INFO.fundingText} /></label>
              <input
                type="text"
                className="form-input"
                placeholder="Support the label!"
                maxLength={128}
                value={publisherFeed.funding?.[0]?.text || ''}
                onChange={e => dispatch({
                  type: 'UPDATE_PUBLISHER_FEED',
                  payload: { funding: [{ url: publisherFeed.funding?.[0]?.url || '', text: e.target.value }] }
                })}
              />
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}
