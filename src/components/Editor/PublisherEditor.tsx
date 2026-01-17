import { useState } from 'react';
import { useFeed } from '../../store/feedStore';
import { LANGUAGES, createEmptyRemoteItem } from '../../types/feed';
import type { ValueRecipient } from '../../types/feed';
import { FIELD_INFO } from '../../data/fieldInfo';
import { InfoIcon } from '../InfoIcon';
import { Section } from '../Section';
import { Toggle } from '../Toggle';

const PRESET_RECIPIENTS: { label: string; recipient: ValueRecipient }[] = [
  { label: 'MSP 2.0', recipient: { name: 'MSP 2.0', address: 'chadf@getalby.com', split: 1, type: 'lnaddress' } },
  { label: 'Podcastindex.org', recipient: { name: 'Podcastindex.org', address: 'podcastindex@getalby.com', split: 1, type: 'lnaddress' } },
];

function AddRecipientSelect({ onAdd }: { onAdd: (recipient: ValueRecipient) => void }) {
  return (
    <select
      className="form-input"
      style={{ width: 'auto', minWidth: '180px' }}
      value=""
      onChange={e => {
        const value = e.target.value;
        if (value === 'blank') {
          onAdd({ name: '', address: '', split: 0, type: 'node' });
        } else {
          const preset = PRESET_RECIPIENTS.find(p => p.label === value);
          if (preset) onAdd(preset.recipient);
        }
        e.target.value = '';
      }}
    >
      <option value="" disabled>+ Add Recipient</option>
      <option value="blank">Blank Recipient</option>
      {PRESET_RECIPIENTS.map(preset => (
        <option key={preset.label} value={preset.label}>{preset.label}</option>
      ))}
    </select>
  );
}

interface SearchResult {
  id: number;
  title: string;
  podcastGuid: string;
  url: string;
  image: string;
}

// Field info for publisher-specific fields
const PUBLISHER_FIELD_INFO = {
  remoteItemFeedGuid: 'The podcast:guid of the feed you want to include in your publisher catalog. This is the unique identifier that links to the feed.',
  remoteItemFeedUrl: 'The URL of the RSS feed (optional but recommended). This helps apps find the feed if they cannot resolve the GUID.',
  remoteItemTitle: 'A display title for this feed (optional). If not provided, apps will fetch the title from the feed itself.',
};

export function PublisherEditor() {
  const { state, dispatch } = useFeed();
  const { publisherFeed } = state;
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState('');

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    setSearchError('');
    setSearchResults([]);

    try {
      const response = await fetch(`/api/pisearch?q=${encodeURIComponent(searchQuery)}`);
      const data = await response.json();

      if (!response.ok) {
        setSearchError(data.error || 'Search failed');
        return;
      }

      setSearchResults(data.feeds || []);
    } catch {
      setSearchError('Failed to search');
    } finally {
      setIsSearching(false);
    }
  };

  const handleAddFromSearch = (result: SearchResult) => {
    dispatch({
      type: 'ADD_REMOTE_ITEM',
      payload: {
        ...createEmptyRemoteItem(),
        feedGuid: result.podcastGuid,
        feedUrl: result.url,
        title: result.title,
        image: result.image
      }
    });
    setSearchResults(prev => prev.filter(r => r.id !== result.id));
  };

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
              <label className="form-label">Publisher Name <span className="required">*</span><InfoIcon text={FIELD_INFO.publisherName} /></label>
              <input
                type="text"
                className="form-input"
                placeholder="Enter publisher or label name"
                value={publisherFeed.author || ''}
                onChange={e => dispatch({ type: 'UPDATE_PUBLISHER_FEED', payload: { author: e.target.value } })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Catalog Title <span className="required">*</span><InfoIcon text={FIELD_INFO.catalogTitle} /></label>
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
            Add the feeds that belong to this publisher. Search by name, Podcast Index ID, or podcastindex.org URL.
          </p>

          {/* Search UI */}
          <div style={{ marginBottom: '20px' }}>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
              <input
                type="text"
                className="form-input"
                placeholder="Search by name, ID, or podcastindex.org URL..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
                style={{ flex: 1 }}
              />
              <button
                className="btn btn-primary"
                onClick={handleSearch}
                disabled={isSearching || !searchQuery.trim()}
              >
                {isSearching ? 'Searching...' : 'Search Directory'}
              </button>
            </div>

            {searchError && (
              <p style={{ color: 'var(--danger-color)', fontSize: '14px', marginBottom: '12px' }}>{searchError}</p>
            )}

            {searchResults.length > 0 && (
              <div style={{
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                overflow: 'hidden',
                marginBottom: '16px'
              }}>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '8px 12px',
                  backgroundColor: 'var(--surface-color)',
                  borderBottom: '1px solid var(--border-color)'
                }}>
                  <span style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
                    {searchResults.length} result{searchResults.length !== 1 ? 's' : ''}
                  </span>
                  <button
                    className="btn btn-icon"
                    onClick={() => { setSearchResults([]); setSearchQuery(''); }}
                    style={{ padding: '4px 8px', fontSize: '12px' }}
                  >
                    Close
                  </button>
                </div>
                <div style={{ maxHeight: '250px', overflowY: 'auto' }}>
                {searchResults.map(result => (
                  <div
                    key={result.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      padding: '12px',
                      gap: '12px',
                      borderBottom: '1px solid var(--border-color)'
                    }}
                  >
                    <img
                      src={result.image}
                      alt=""
                      style={{
                        width: '48px',
                        height: '48px',
                        borderRadius: '4px',
                        objectFit: 'cover',
                        backgroundColor: 'var(--surface-color)'
                      }}
                      onError={e => (e.target as HTMLImageElement).style.display = 'none'}
                    />
                    <span style={{ flex: 1, fontWeight: 500 }}>{result.title}</span>
                    <button
                      className="btn btn-primary"
                      onClick={() => handleAddFromSearch(result)}
                      style={{ padding: '6px 16px' }}
                    >
                      Add
                    </button>
                  </div>
                ))}
                </div>
              </div>
            )}
          </div>

          <div className="repeatable-list">
            {publisherFeed.remoteItems.map((item, index) => (
              <div key={index} className="repeatable-item">
                <div className="repeatable-item-content" style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
                  {/* Album Art Preview */}
                  <div style={{ flexShrink: 0 }}>
                    {item.image ? (
                      <img
                        src={item.image}
                        alt={item.title || 'Feed artwork'}
                        style={{
                          width: '80px',
                          height: '80px',
                          borderRadius: '8px',
                          objectFit: 'cover',
                          backgroundColor: 'var(--surface-color)',
                          border: '1px solid var(--border-color)'
                        }}
                        onError={e => (e.target as HTMLImageElement).style.display = 'none'}
                      />
                    ) : (
                      <div style={{
                        width: '80px',
                        height: '80px',
                        borderRadius: '8px',
                        backgroundColor: 'var(--surface-color)',
                        border: '1px solid var(--border-color)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--text-secondary)',
                        fontSize: '24px'
                      }}>
                        &#127911;
                      </div>
                    )}
                  </div>
                  {/* Form Fields */}
                  <div style={{ flex: 1 }}>
                    <div className="form-grid">
                      <div className="form-group" style={{ width: '80px' }}>
                        <label className="form-label">Order</label>
                        <input
                          type="number"
                          className="form-input"
                          min="1"
                          value={index + 1}
                          onChange={e => {
                            const newIndex = parseInt(e.target.value) - 1;
                            if (!isNaN(newIndex) && newIndex >= 0 && newIndex < publisherFeed.remoteItems.length && newIndex !== index) {
                              dispatch({ type: 'REORDER_REMOTE_ITEMS', payload: { fromIndex: index, toIndex: newIndex } });
                            }
                          }}
                          style={{ textAlign: 'center' }}
                        />
                      </div>
                      <div className="form-group" style={{ flex: 1 }}>
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

        {/* Value Block Section */}
        <Section title="Value Block (Lightning)" icon="&#9889;">
          <h4 style={{ marginBottom: '12px', color: 'var(--text-secondary)' }}>Recipients</h4>
          <div className="repeatable-list">
            {publisherFeed.value.recipients.map((recipient, index) => (
              <div key={index} className="repeatable-item">
                <div className="repeatable-item-content">
                  <div className="form-grid">
                    <div className="form-group">
                      <label className="form-label">Name<InfoIcon text={FIELD_INFO.recipientName} /></label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="Recipient name"
                        value={recipient.name || ''}
                        onChange={e => dispatch({
                          type: 'UPDATE_PUBLISHER_RECIPIENT',
                          payload: { index, recipient: { ...recipient, name: e.target.value } }
                        })}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Address<InfoIcon text={FIELD_INFO.recipientAddress} /></label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="Node pubkey or LN address"
                        value={recipient.address || ''}
                        onChange={e => {
                          const address = e.target.value;
                          const detectedType = address.includes('@') ? 'lnaddress' : 'node';
                          dispatch({
                            type: 'UPDATE_PUBLISHER_RECIPIENT',
                            payload: { index, recipient: { ...recipient, address, type: detectedType } }
                          });
                        }}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Split %<InfoIcon text={FIELD_INFO.recipientSplit} /></label>
                      <input
                        type="number"
                        className="form-input"
                        placeholder="50"
                        min="0"
                        max="100"
                        value={recipient.split ?? 0}
                        onChange={e => dispatch({
                          type: 'UPDATE_PUBLISHER_RECIPIENT',
                          payload: { index, recipient: { ...recipient, split: parseInt(e.target.value) || 0 } }
                        })}
                      />
                    </div>
                    {recipient.type === 'node' && recipient.address && (
                      <>
                        <div className="form-group">
                          <label className="form-label">Custom Key<InfoIcon text={FIELD_INFO.recipientCustomKey} /></label>
                          <input
                            type="text"
                            className="form-input"
                            placeholder="696969"
                            value={recipient.customKey || ''}
                            onChange={e => dispatch({
                              type: 'UPDATE_PUBLISHER_RECIPIENT',
                              payload: { index, recipient: { ...recipient, customKey: e.target.value || undefined } }
                            })}
                          />
                        </div>
                        <div className="form-group">
                          <label className="form-label">Custom Value<InfoIcon text={FIELD_INFO.recipientCustomValue} /></label>
                          <input
                            type="text"
                            className="form-input"
                            placeholder="Optional TLV value"
                            value={recipient.customValue || ''}
                            onChange={e => dispatch({
                              type: 'UPDATE_PUBLISHER_RECIPIENT',
                              payload: { index, recipient: { ...recipient, customValue: e.target.value || undefined } }
                            })}
                          />
                        </div>
                      </>
                    )}
                  </div>
                </div>
                <div className="repeatable-item-actions">
                  <button
                    className="btn btn-icon btn-danger"
                    onClick={() => dispatch({ type: 'REMOVE_PUBLISHER_RECIPIENT', payload: index })}
                  >
                    &#10005;
                  </button>
                </div>
              </div>
            ))}
            <AddRecipientSelect onAdd={recipient => dispatch({ type: 'ADD_PUBLISHER_RECIPIENT', payload: recipient })} />
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
