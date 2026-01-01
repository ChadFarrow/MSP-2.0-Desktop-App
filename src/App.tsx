// MSP 2.0 - Music Side Project Studio
import { useState } from 'react';
import { FeedProvider, useFeed } from './store/feedStore.tsx';
import { NostrProvider, useNostr } from './store/nostrStore.tsx';
import { generateRssFeed, downloadXml, copyToClipboard } from './utils/xmlGenerator';
import { parseRssFeed, fetchFeedFromUrl } from './utils/xmlParser';
import { createEmptyAlbum, LANGUAGES, PERSON_GROUPS, PERSON_ROLES } from './types/feed';
import { FIELD_INFO } from './data/fieldInfo';
import { NostrLoginButton } from './components/NostrLoginButton';
import { NostrSyncModal } from './components/NostrSyncModal';
import './App.css';

// Info Icon Component for tooltips
function InfoIcon({ text }: { text: string }) {
  const [show, setShow] = useState(false);

  return (
    <span className="info-icon-wrapper">
      <span
        className="info-icon"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onClick={() => setShow(!show)}
      >
        i
      </span>
      {show && <div className="info-tooltip">{text}</div>}
    </span>
  );
}

// Import Modal Component
function ImportModal({ onClose, onImport }: { onClose: () => void; onImport: (xml: string) => void }) {
  const [mode, setMode] = useState<'file' | 'paste' | 'url'>('file');
  const [xmlContent, setXmlContent] = useState('');
  const [feedUrl, setFeedUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setError('');

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setXmlContent(content);
    };
    reader.onerror = () => {
      setError('Failed to read file');
    };
    reader.readAsText(file);
  };

  const handleImport = async () => {
    setError('');
    setLoading(true);

    try {
      let xml = xmlContent;

      if (mode === 'url') {
        xml = await fetchFeedFromUrl(feedUrl);
      }

      if (!xml.trim()) {
        throw new Error('No XML content provided');
      }

      onImport(xml);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import feed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Import Feed</h2>
          <button className="btn btn-icon" onClick={onClose}>&#10005;</button>
        </div>
        <div className="modal-content">
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
            <button
              className={`btn ${mode === 'file' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setMode('file')}
            >
              Upload File
            </button>
            <button
              className={`btn ${mode === 'paste' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setMode('paste')}
            >
              Paste XML
            </button>
            <button
              className={`btn ${mode === 'url' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setMode('url')}
            >
              From URL
            </button>
          </div>

          {mode === 'file' ? (
            <div className="form-group">
              <label className="form-label">Select XML File</label>
              <input
                type="file"
                accept=".xml,application/xml,text/xml"
                onChange={handleFileChange}
                style={{ marginBottom: '12px' }}
              />
              {fileName && (
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                  Selected: {fileName}
                </div>
              )}
            </div>
          ) : mode === 'paste' ? (
            <div className="form-group">
              <label className="form-label">Paste RSS XML</label>
              <textarea
                className="form-textarea"
                style={{ minHeight: '200px', fontFamily: 'monospace', fontSize: '0.75rem' }}
                placeholder="Paste your RSS feed XML here..."
                value={xmlContent}
                onChange={e => setXmlContent(e.target.value)}
              />
            </div>
          ) : (
            <div className="form-group">
              <label className="form-label">Feed URL</label>
              <input
                type="url"
                className="form-input"
                placeholder="https://example.com/feed.xml"
                value={feedUrl}
                onChange={e => setFeedUrl(e.target.value)}
              />
            </div>
          )}

          {error && (
            <div style={{ color: 'var(--error)', marginTop: '12px', fontSize: '0.875rem' }}>
              {error}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleImport} disabled={loading}>
            {loading ? 'Importing...' : 'Import Feed'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Section component for collapsible sections
function Section({ title, icon, children, defaultOpen = true }: {
  title: string;
  icon: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="section">
      <div className="section-header" onClick={() => setIsOpen(!isOpen)}>
        <h2><span className="icon">{icon}</span> {title}</h2>
        <span className={`section-toggle ${isOpen ? 'expanded' : ''}`}>&#9660;</span>
      </div>
      <div className={`section-content ${isOpen ? '' : 'collapsed'}`}>
        {children}
      </div>
    </div>
  );
}

// Toggle component
function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (val: boolean) => void; label?: string }) {
  return (
    <div className="toggle-wrapper">
      <div className={`toggle ${checked ? 'active' : ''}`} onClick={() => onChange(!checked)}>
        <div className="toggle-knob" />
      </div>
      {label && <span className="form-label">{label}</span>}
    </div>
  );
}

// Main Editor Component
function Editor() {
  const { state, dispatch } = useFeed();
  const { album } = state;
  const [collapsedTracks, setCollapsedTracks] = useState<Set<string>>(new Set());
  const [copySuccess, setCopySuccess] = useState(false);

  // Format duration to HH:MM:SS
  const formatDuration = (input: string): string => {
    // Remove any non-digit and non-colon characters
    const cleaned = input.replace(/[^\d:]/g, '');
    const parts = cleaned.split(':').map(p => parseInt(p) || 0);

    let hours = 0, minutes = 0, seconds = 0;

    if (parts.length === 1) {
      // Just seconds or minutes
      seconds = parts[0];
    } else if (parts.length === 2) {
      // MM:SS
      minutes = parts[0];
      seconds = parts[1];
    } else if (parts.length >= 3) {
      // HH:MM:SS
      hours = parts[0];
      minutes = parts[1];
      seconds = parts[2];
    }

    // Handle overflow
    if (seconds >= 60) {
      minutes += Math.floor(seconds / 60);
      seconds = seconds % 60;
    }
    if (minutes >= 60) {
      hours += Math.floor(minutes / 60);
      minutes = minutes % 60;
    }

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  };

  const toggleTrackCollapse = (trackId: string) => {
    setCollapsedTracks(prev => {
      const next = new Set(prev);
      if (next.has(trackId)) {
        next.delete(trackId);
      } else {
        next.add(trackId);
      }
      return next;
    });
  };

  const xml = generateRssFeed(album);

  const handleCopy = async () => {
    const success = await copyToClipboard(xml);
    if (success) {
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    }
  };

  const handleDownload = () => {
    const filename = album.title ? `${album.title.toLowerCase().replace(/\s+/g, '-')}.xml` : 'feed.xml';
    downloadXml(xml, filename);
  };

  return (
    <>
      <div className="main-content">
        {/* Editor Panel */}
        <div className="editor-panel">
          {/* Album Info Section */}
          <Section title="Album Info" icon="&#128191;">
            <div className="form-grid">
              <div className="form-group">
                <label className="form-label">Artist/Band <span className="required">*</span><InfoIcon text={FIELD_INFO.author} /></label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Enter artist or band name"
                  value={album.author}
                  onChange={e => dispatch({ type: 'UPDATE_ALBUM', payload: { author: e.target.value } })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Album Title <span className="required">*</span><InfoIcon text={FIELD_INFO.title} /></label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Enter album title"
                  value={album.title}
                  onChange={e => dispatch({ type: 'UPDATE_ALBUM', payload: { title: e.target.value } })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Website<InfoIcon text={FIELD_INFO.link} /></label>
                <input
                  type="url"
                  className="form-input"
                  placeholder="https://yourband.com"
                  value={album.link}
                  onChange={e => dispatch({ type: 'UPDATE_ALBUM', payload: { link: e.target.value } })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Language<InfoIcon text={FIELD_INFO.language} /></label>
                <select
                  className="form-select"
                  value={album.language}
                  onChange={e => dispatch({ type: 'UPDATE_ALBUM', payload: { language: e.target.value } })}
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
                  placeholder="Describe your album, band members, recording info, etc."
                  value={album.description}
                  onChange={e => dispatch({ type: 'UPDATE_ALBUM', payload: { description: e.target.value } })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Podcast GUID<InfoIcon text={FIELD_INFO.podcastGuid} /></label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Auto-generated UUID"
                  value={album.podcastGuid}
                  onChange={e => dispatch({ type: 'UPDATE_ALBUM', payload: { podcastGuid: e.target.value } })}
                />
              </div>
              <div className="form-group">
                <Toggle
                  checked={album.explicit}
                  onChange={val => dispatch({ type: 'UPDATE_ALBUM', payload: { explicit: val } })}
                  label="Explicit Content"
                />
                <InfoIcon text={FIELD_INFO.explicit} />
              </div>
            </div>
          </Section>

          {/* Artwork Section */}
          <Section title="Artwork" icon="&#127912;">
            <div className="form-grid">
              <div className="form-group">
                <label className="form-label">Album Art URL <span className="required">*</span><InfoIcon text={FIELD_INFO.imageUrl} /></label>
                <input
                  type="url"
                  className="form-input"
                  placeholder="https://example.com/album-art.jpg"
                  value={album.imageUrl}
                  onChange={e => dispatch({ type: 'UPDATE_ALBUM', payload: { imageUrl: e.target.value } })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Image Title<InfoIcon text={FIELD_INFO.imageTitle} /></label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Album cover description"
                  value={album.imageTitle}
                  onChange={e => dispatch({ type: 'UPDATE_ALBUM', payload: { imageTitle: e.target.value } })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Image Description<InfoIcon text={FIELD_INFO.imageDescription} /></label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Optional description"
                  value={album.imageDescription}
                  onChange={e => dispatch({ type: 'UPDATE_ALBUM', payload: { imageDescription: e.target.value } })}
                />
              </div>
              {album.imageUrl && (
                <div className="form-group full-width">
                  <img
                    src={album.imageUrl}
                    alt="Album preview"
                    style={{ maxWidth: '200px', borderRadius: '8px', border: '1px solid var(--border-color)' }}
                    onError={e => (e.target as HTMLImageElement).style.display = 'none'}
                  />
                </div>
              )}
            </div>
          </Section>

          {/* Credits Section */}
          <Section title="Credits / Persons" icon="&#128100;">
            <div className="repeatable-list">
              {album.persons.map((person, index) => (
                <div key={index} className="repeatable-item">
                  <div className="repeatable-item-content">
                    <div className="form-grid">
                      <div className="form-group">
                        <label className="form-label">Name<InfoIcon text={FIELD_INFO.personName} /></label>
                        <input
                          type="text"
                          className="form-input"
                          placeholder="Person name"
                          value={person.name}
                          onChange={e => dispatch({
                            type: 'UPDATE_PERSON',
                            payload: { index, person: { ...person, name: e.target.value } }
                          })}
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Group<InfoIcon text={FIELD_INFO.personGroup} /></label>
                        <select
                          className="form-select"
                          value={person.group}
                          onChange={e => dispatch({
                            type: 'UPDATE_PERSON',
                            payload: { index, person: { ...person, group: e.target.value as any, role: PERSON_ROLES[e.target.value]?.[0]?.value || 'band' } }
                          })}
                        >
                          {PERSON_GROUPS.map(g => (
                            <option key={g.value} value={g.value}>{g.label}</option>
                          ))}
                        </select>
                      </div>
                      <div className="form-group">
                        <label className="form-label">Role<InfoIcon text={FIELD_INFO.personRole} /></label>
                        <select
                          className="form-select"
                          value={person.role}
                          onChange={e => dispatch({
                            type: 'UPDATE_PERSON',
                            payload: { index, person: { ...person, role: e.target.value } }
                          })}
                        >
                          {(PERSON_ROLES[person.group] || PERSON_ROLES.music).map(r => (
                            <option key={r.value} value={r.value}>{r.label}</option>
                          ))}
                        </select>
                      </div>
                      <div className="form-group">
                        <label className="form-label">Website<InfoIcon text={FIELD_INFO.personHref} /></label>
                        <input
                          type="url"
                          className="form-input"
                          placeholder="https://..."
                          value={person.href || ''}
                          onChange={e => dispatch({
                            type: 'UPDATE_PERSON',
                            payload: { index, person: { ...person, href: e.target.value } }
                          })}
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Photo URL<InfoIcon text={FIELD_INFO.personImg} /></label>
                        <input
                          type="url"
                          className="form-input"
                          placeholder="https://..."
                          value={person.img || ''}
                          onChange={e => dispatch({
                            type: 'UPDATE_PERSON',
                            payload: { index, person: { ...person, img: e.target.value } }
                          })}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="repeatable-item-actions">
                    <button
                      className="btn btn-icon btn-danger"
                      onClick={() => dispatch({ type: 'REMOVE_PERSON', payload: index })}
                    >
                      &#10005;
                    </button>
                  </div>
                </div>
              ))}
              <button className="add-item-btn" onClick={() => dispatch({ type: 'ADD_PERSON' })}>
                + Add Person
              </button>
            </div>
          </Section>

          {/* Value Block Section */}
          <Section title="Value Block (Lightning)" icon="&#9889;">
            <div className="form-grid" style={{ marginBottom: '16px' }}>
              <div className="form-group">
                <label className="form-label">Suggested Amount (BTC)<InfoIcon text={FIELD_INFO.valueSuggested} /></label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="0.000033333"
                  value={album.value.suggested || ''}
                  onChange={e => dispatch({
                    type: 'UPDATE_ALBUM',
                    payload: { value: { ...album.value, suggested: e.target.value } }
                  })}
                />
              </div>
            </div>
            <h4 style={{ marginBottom: '12px', color: 'var(--text-secondary)' }}>Recipients</h4>
            <div className="repeatable-list">
              {album.value.recipients.map((recipient, index) => (
                <div key={index} className="repeatable-item">
                  <div className="repeatable-item-content">
                    <div className="form-grid">
                      <div className="form-group">
                        <label className="form-label">Name<InfoIcon text={FIELD_INFO.recipientName} /></label>
                        <input
                          type="text"
                          className="form-input"
                          placeholder="Recipient name"
                          value={recipient.name}
                          onChange={e => dispatch({
                            type: 'UPDATE_RECIPIENT',
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
                          value={recipient.address}
                          onChange={e => {
                            const address = e.target.value;
                            const detectedType = address.includes('@') ? 'lnaddress' : 'node';
                            dispatch({
                              type: 'UPDATE_RECIPIENT',
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
                          value={recipient.split}
                          onChange={e => dispatch({
                            type: 'UPDATE_RECIPIENT',
                            payload: { index, recipient: { ...recipient, split: parseInt(e.target.value) || 0 } }
                          })}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="repeatable-item-actions">
                    <button
                      className="btn btn-icon btn-danger"
                      onClick={() => dispatch({ type: 'REMOVE_RECIPIENT', payload: index })}
                    >
                      &#10005;
                    </button>
                  </div>
                </div>
              ))}
              <button className="add-item-btn" onClick={() => dispatch({ type: 'ADD_RECIPIENT' })}>
                + Add Recipient
              </button>
            </div>
          </Section>

          {/* Tracks Section */}
          <Section title="Tracks" icon="&#127925;">
            <div className="track-list">
              {album.tracks.map((track, index) => (
                <div key={track.id} className="repeatable-item" style={{ flexDirection: 'column' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', width: '100%' }}>
                    <span className="track-number">{track.trackNumber}</span>
                    <span style={{ flex: 1, fontWeight: 500 }}>{track.title || 'Untitled Track'}</span>
                    {track.duration !== '00:00:00' && (
                      <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>{track.duration}</span>
                    )}
                    <button
                      className="btn btn-icon"
                      style={{ background: 'transparent', color: 'var(--text-secondary)' }}
                      onClick={() => toggleTrackCollapse(track.id)}
                      title={collapsedTracks.has(track.id) ? 'Expand' : 'Collapse'}
                    >
                      {collapsedTracks.has(track.id) ? '▶' : '▼'}
                    </button>
                    <button
                      className="btn btn-icon btn-danger"
                      onClick={() => dispatch({ type: 'REMOVE_TRACK', payload: index })}
                    >
                      &#10005;
                    </button>
                  </div>
                  {!collapsedTracks.has(track.id) && (
                  <div className="form-grid" style={{ marginTop: '12px' }}>
                    <div className="form-group">
                      <label className="form-label">Track Title <span className="required">*</span><InfoIcon text={FIELD_INFO.trackTitle} /></label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="Enter track title"
                        value={track.title}
                        onChange={e => dispatch({
                          type: 'UPDATE_TRACK',
                          payload: { index, track: { title: e.target.value } }
                        })}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Duration (HH:MM:SS) <span className="required">*</span><InfoIcon text={FIELD_INFO.trackDuration} /></label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="00:03:45"
                        value={track.duration}
                        onChange={e => dispatch({
                          type: 'UPDATE_TRACK',
                          payload: { index, track: { duration: e.target.value } }
                        })}
                        onBlur={e => dispatch({
                          type: 'UPDATE_TRACK',
                          payload: { index, track: { duration: formatDuration(e.target.value) } }
                        })}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">MP3 URL <span className="required">*</span><InfoIcon text={FIELD_INFO.enclosureUrl} /></label>
                      <input
                        type="url"
                        className="form-input"
                        placeholder="https://example.com/track.mp3"
                        value={track.enclosureUrl}
                        onChange={e => dispatch({
                          type: 'UPDATE_TRACK',
                          payload: { index, track: { enclosureUrl: e.target.value } }
                        })}
                        onBlur={async e => {
                          const url = e.target.value;
                          if (url && url.startsWith('http') && !track.enclosureLength) {
                            try {
                              const response = await fetch(url, { method: 'HEAD' });
                              const length = response.headers.get('content-length');
                              if (length && parseInt(length) > 0) {
                                dispatch({
                                  type: 'UPDATE_TRACK',
                                  payload: { index, track: { enclosureLength: length } }
                                });
                              }
                            } catch {
                              // CORS blocked - user needs to enter manually
                            }
                          }
                        }}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">
                        File Size (MB)<InfoIcon text={FIELD_INFO.enclosureLength} />
                        {(!track.enclosureLength || track.enclosureLength === '0') && (
                          <span style={{ color: 'var(--error)', marginLeft: '4px' }}>⚠ Required</span>
                        )}
                      </label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="e.g. 3.25"
                        defaultValue={track.enclosureLength && parseInt(track.enclosureLength) > 0 ? (parseInt(track.enclosureLength) / 1024 / 1024).toFixed(2) : ''}
                        onBlur={e => {
                          const mb = parseFloat(e.target.value) || 0;
                          const bytes = Math.round(mb * 1024 * 1024);
                          dispatch({
                            type: 'UPDATE_TRACK',
                            payload: { index, track: { enclosureLength: bytes > 0 ? String(bytes) : '' } }
                          });
                        }}
                        style={(!track.enclosureLength || track.enclosureLength === '0') ? { borderColor: 'var(--error)' } : {}}
                      />
                      {track.enclosureLength && parseInt(track.enclosureLength) > 0 && (
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                          = {parseInt(track.enclosureLength).toLocaleString()} bytes
                        </span>
                      )}
                    </div>
                    <div className="form-group full-width">
                      <label className="form-label">Description<InfoIcon text={FIELD_INFO.trackDescription} /></label>
                      <textarea
                        className="form-textarea"
                        placeholder="Track description or notes"
                        value={track.description}
                        onChange={e => dispatch({
                          type: 'UPDATE_TRACK',
                          payload: { index, track: { description: e.target.value } }
                        })}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Track Art URL<InfoIcon text={FIELD_INFO.trackArtUrl} /></label>
                      <input
                        type="url"
                        className="form-input"
                        placeholder="Override album art for this track"
                        value={track.trackArtUrl || ''}
                        onChange={e => dispatch({
                          type: 'UPDATE_TRACK',
                          payload: { index, track: { trackArtUrl: e.target.value } }
                        })}
                      />
                      {track.trackArtUrl && (
                        <img
                          src={track.trackArtUrl}
                          alt="Track art preview"
                          style={{ marginTop: '8px', maxWidth: '100px', borderRadius: '4px', border: '1px solid var(--border-color)' }}
                          onError={e => (e.target as HTMLImageElement).style.display = 'none'}
                        />
                      )}
                    </div>
                    <div className="form-group">
                      <label className="form-label">Lyrics URL<InfoIcon text={FIELD_INFO.transcriptUrl} /></label>
                      <input
                        type="url"
                        className="form-input"
                        placeholder="https://example.com/lyrics.srt"
                        value={track.transcriptUrl || ''}
                        onChange={e => dispatch({
                          type: 'UPDATE_TRACK',
                          payload: { index, track: { transcriptUrl: e.target.value } }
                        })}
                      />
                    </div>
                    <div className="form-group">
                      <Toggle
                        checked={track.explicit}
                        onChange={val => dispatch({
                          type: 'UPDATE_TRACK',
                          payload: { index, track: { explicit: val } }
                        })}
                        label="Explicit"
                      />
                      <InfoIcon text={FIELD_INFO.trackExplicit} />
                    </div>
                    <div className="form-group">
                      <Toggle
                        checked={track.overrideValue}
                        onChange={val => dispatch({
                          type: 'UPDATE_TRACK',
                          payload: { index, track: { overrideValue: val } }
                        })}
                        label="Override Value Split"
                      />
                      <InfoIcon text={FIELD_INFO.overrideValue} />
                    </div>
                  </div>
                  )}

                  {/* Track-specific Value Block */}
                  {track.overrideValue && !collapsedTracks.has(track.id) && (
                    <div style={{ marginTop: '12px', padding: '12px', background: 'var(--bg-primary)', borderRadius: '8px' }}>
                      <h5 style={{ marginBottom: '12px', color: 'var(--text-secondary)' }}>Track Value Recipients</h5>
                      <div className="repeatable-list">
                        {(track.value?.recipients || []).map((recipient, rIndex) => (
                          <div key={rIndex} className="repeatable-item">
                            <div className="repeatable-item-content">
                              <div className="form-grid">
                                <div className="form-group">
                                  <label className="form-label">Name<InfoIcon text={FIELD_INFO.recipientName} /></label>
                                  <input
                                    type="text"
                                    className="form-input"
                                    placeholder="Recipient name"
                                    value={recipient.name}
                                    onChange={e => {
                                      const newRecipients = [...(track.value?.recipients || [])];
                                      newRecipients[rIndex] = { ...recipient, name: e.target.value };
                                      dispatch({
                                        type: 'UPDATE_TRACK',
                                        payload: { index, track: { value: { type: 'lightning', method: 'keysend', recipients: newRecipients } } }
                                      });
                                    }}
                                  />
                                </div>
                                <div className="form-group">
                                  <label className="form-label">Address<InfoIcon text={FIELD_INFO.recipientAddress} /></label>
                                  <input
                                    type="text"
                                    className="form-input"
                                    placeholder="Node pubkey or LN address"
                                    value={recipient.address}
                                    onChange={e => {
                                      const address = e.target.value;
                                      const detectedType = address.includes('@') ? 'lnaddress' : 'node';
                                      const newRecipients = [...(track.value?.recipients || [])];
                                      newRecipients[rIndex] = { ...recipient, address, type: detectedType };
                                      dispatch({
                                        type: 'UPDATE_TRACK',
                                        payload: { index, track: { value: { type: 'lightning', method: 'keysend', recipients: newRecipients } } }
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
                                    value={recipient.split}
                                    onChange={e => {
                                      const newRecipients = [...(track.value?.recipients || [])];
                                      newRecipients[rIndex] = { ...recipient, split: parseInt(e.target.value) || 0 };
                                      dispatch({
                                        type: 'UPDATE_TRACK',
                                        payload: { index, track: { value: { type: 'lightning', method: 'keysend', recipients: newRecipients } } }
                                      });
                                    }}
                                  />
                                </div>
                              </div>
                            </div>
                            <div className="repeatable-item-actions">
                              <button
                                className="btn btn-icon btn-danger"
                                onClick={() => {
                                  const newRecipients = [...(track.value?.recipients || [])];
                                  newRecipients.splice(rIndex, 1);
                                  dispatch({
                                    type: 'UPDATE_TRACK',
                                    payload: { index, track: { value: { type: 'lightning', method: 'keysend', recipients: newRecipients } } }
                                  });
                                }}
                              >
                                &#10005;
                              </button>
                            </div>
                          </div>
                        ))}
                        <button
                          className="add-item-btn"
                          onClick={() => {
                            const newRecipients = [...(track.value?.recipients || []), { name: '', address: '', split: 0, type: 'node' as const }];
                            dispatch({
                              type: 'UPDATE_TRACK',
                              payload: { index, track: { value: { type: 'lightning', method: 'keysend', recipients: newRecipients } } }
                            });
                          }}
                        >
                          + Add Recipient
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              <button className="add-item-btn" onClick={() => {
                // Collapse all existing tracks, new track will be open
                setCollapsedTracks(new Set(album.tracks.map(t => t.id)));
                dispatch({ type: 'ADD_TRACK' });
              }}>
                + Add Track
              </button>
            </div>
          </Section>
        </div>

      </div>

      {/* Footer Actions */}
      <div className="footer-actions">
        <button className="btn btn-primary" onClick={handleDownload}>
          ⬇️ Download XML
        </button>
        <button className="btn btn-secondary" onClick={handleCopy}>
          {copySuccess ? '✓ Copied!' : '📋 Copy to Clipboard'}
        </button>
        <button
          className="btn btn-secondary"
          onClick={() => {
            if (confirm('Are you sure you want to reset all fields?')) {
              dispatch({ type: 'SET_ALBUM', payload: createEmptyAlbum() });
            }
          }}
        >
          🔄 Reset
        </button>
      </div>
    </>
  );
}

// Main App Content (needs access to context)
function AppContent() {
  const { state, dispatch } = useFeed();
  const [showImportModal, setShowImportModal] = useState(false);
  const [showNostrModal, setShowNostrModal] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const { state: nostrState } = useNostr();

  const handleImport = (xml: string) => {
    try {
      const album = parseRssFeed(xml);
      dispatch({ type: 'SET_ALBUM', payload: album });
    } catch (err) {
      alert('Failed to parse feed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
  };

  const handleNew = () => {
    if (confirm('Create a new feed? This will clear all current data.')) {
      dispatch({ type: 'SET_ALBUM', payload: createEmptyAlbum() });
    }
  };

  return (
    <>
      <div className="app">
        <header className="header">
          <div className="header-title">
            <h1>MSP 2.0 - Music Side Project Studio</h1>
          </div>
          <div className="header-actions">
            <button className="btn btn-secondary btn-small" onClick={handleNew}>
              📂 New
            </button>
            <button className="btn btn-secondary btn-small" onClick={() => setShowImportModal(true)}>
              📥 Import
            </button>
            <button className="btn btn-primary btn-small" onClick={() => {
              localStorage.setItem('msp2-album-data', JSON.stringify(state.album));
              setSaveMessage('Saved!');
              setTimeout(() => setSaveMessage(''), 2000);
            }}>
              {saveMessage || '💾 Save'}
            </button>
            <span className="header-separator" />
            {nostrState.isLoggedIn && (
              <button className="btn btn-secondary btn-small" onClick={() => setShowNostrModal(true)}>
                ⚡ Nostr
              </button>
            )}
            <NostrLoginButton />
          </div>
        </header>
        <Editor />
      </div>

      {showImportModal && (
        <ImportModal
          onClose={() => setShowImportModal(false)}
          onImport={handleImport}
        />
      )}

      {showNostrModal && (
        <NostrSyncModal
          onClose={() => setShowNostrModal(false)}
          album={state.album}
          isDirty={state.isDirty}
          onLoadAlbum={(album) => dispatch({ type: 'SET_ALBUM', payload: album })}
        />
      )}
    </>
  );
}

// Main App
function App() {
  return (
    <NostrProvider>
      <FeedProvider>
        <AppContent />
      </FeedProvider>
    </NostrProvider>
  );
}

export default App;
