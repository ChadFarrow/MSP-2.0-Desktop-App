import { useState } from 'react';
import { useFeed } from '../../store/feedStore';
import { LANGUAGES, PERSON_GROUPS, PERSON_ROLES, createEmptyPersonRole } from '../../types/feed';
import type { PersonGroup } from '../../types/feed';
import { FIELD_INFO } from '../../data/fieldInfo';
import { detectAddressType } from '../../utils/addressUtils';
import { getAudioDuration, secondsToHHMMSS, formatDuration } from '../../utils/audioUtils';
import { InfoIcon } from '../InfoIcon';
import { Section } from '../Section';
import { Toggle } from '../Toggle';
import { AddRecipientSelect } from '../AddRecipientSelect';
import { RecipientsList } from '../RecipientsList';
import { FundingFields } from '../FundingFields';
import { ArtworkFields } from '../ArtworkFields';

// Roles Reference Modal
function RolesModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose} style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0, 0, 0, 0.7)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000
    }}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{
        background: 'var(--bg-secondary)',
        borderRadius: '12px',
        padding: '24px',
        maxWidth: '900px',
        maxHeight: '80vh',
        overflow: 'auto',
        width: '90%'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2 style={{ margin: 0, color: 'var(--text-primary)' }}>Podcasting 2.0 Roles Reference</h2>
          <button onClick={onClose} className="btn btn-icon" style={{ fontSize: '20px' }}>&times;</button>
        </div>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '20px' }}>
          Full list of groups and roles from the Podcasting 2.0 taxonomy, plus custom music roles.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '16px' }}>
          {PERSON_GROUPS.map(group => (
            <div key={group.value} style={{
              background: 'var(--bg-tertiary)',
              borderRadius: '8px',
              padding: '16px'
            }}>
              <h4 style={{ margin: '0 0 12px 0', color: 'var(--accent-primary)', fontSize: '14px', textTransform: 'uppercase' }}>
                {group.label}
              </h4>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {PERSON_ROLES[group.value].map(role => (
                  <li key={role.value} style={{ color: 'var(--text-primary)', padding: '4px 0', fontSize: '13px' }}>
                    {role.label}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Editor() {
  const { state, dispatch } = useFeed();
  const { album } = state;
  const [collapsedTracks, setCollapsedTracks] = useState<Set<string>>(new Set());
  const [showRolesModal, setShowRolesModal] = useState(false);

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

  return (
    <>
      <div className="main-content">
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
                  value={album.author || ''}
                  onChange={e => dispatch({ type: 'UPDATE_ALBUM', payload: { author: e.target.value } })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Album Title <span className="required">*</span><InfoIcon text={FIELD_INFO.title} /></label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Enter album title"
                  value={album.title || ''}
                  onChange={e => dispatch({ type: 'UPDATE_ALBUM', payload: { title: e.target.value } })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Website<InfoIcon text={FIELD_INFO.link} /></label>
                <input
                  type="url"
                  className="form-input"
                  placeholder="https://yourband.com"
                  value={album.link || ''}
                  onChange={e => dispatch({ type: 'UPDATE_ALBUM', payload: { link: e.target.value } })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Language <span className="required">*</span><InfoIcon text={FIELD_INFO.language} /></label>
                <select
                  className="form-select"
                  value={album.language || 'en'}
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
                  value={album.description || ''}
                  onChange={e => dispatch({ type: 'UPDATE_ALBUM', payload: { description: e.target.value } })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Podcast GUID <span className="required">*</span><InfoIcon text={FIELD_INFO.podcastGuid} /></label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Auto-generated UUID"
                  value={album.podcastGuid || ''}
                  onChange={e => dispatch({ type: 'UPDATE_ALBUM', payload: { podcastGuid: e.target.value } })}
                />
              </div>
              <div className="form-group">
                <Toggle
                  checked={album.explicit}
                  onChange={val => dispatch({ type: 'UPDATE_ALBUM', payload: { explicit: val } })}
                  label="Explicit Content"
                  labelSuffix={<InfoIcon text={FIELD_INFO.explicit} />}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Keywords<InfoIcon text={FIELD_INFO.keywords} /></label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="rock, indie, guitar, electronic"
                  value={album.keywords || ''}
                  onChange={e => dispatch({ type: 'UPDATE_ALBUM', payload: { keywords: e.target.value } })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Medium<InfoIcon text={FIELD_INFO.medium} /></label>
                <select
                  className="form-select"
                  value={album.medium || 'music'}
                  onChange={e => dispatch({ type: 'UPDATE_ALBUM', payload: { medium: e.target.value as 'music' | 'musicL' } })}
                >
                  <option value="music">Music</option>
                  <option value="musicL">Music (Long-form)</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Owner Name<InfoIcon text={FIELD_INFO.ownerName} /></label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Your name or band name"
                  value={album.ownerName || ''}
                  onChange={e => dispatch({ type: 'UPDATE_ALBUM', payload: { ownerName: e.target.value } })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Owner Email<InfoIcon text={FIELD_INFO.ownerEmail} /></label>
                <input
                  type="email"
                  className="form-input"
                  placeholder="contact@yourband.com"
                  value={album.ownerEmail || ''}
                  onChange={e => dispatch({ type: 'UPDATE_ALBUM', payload: { ownerEmail: e.target.value } })}
                />
              </div>
            </div>
          </Section>

          {/* Artwork Section */}
          <Section title="Album Artwork" icon="&#127912;">
            <ArtworkFields
              imageUrl={album.imageUrl}
              imageTitle={album.imageTitle}
              imageDescription={album.imageDescription}
              onUpdate={(field, value) => dispatch({ type: 'UPDATE_ALBUM', payload: { [field]: value } })}
              urlLabel="Album Art URL"
              urlPlaceholder="https://example.com/album-art.jpg"
              titlePlaceholder="Album cover description"
              previewAlt="Album preview"
            />
          </Section>

          {/* Credits Section */}
          <Section title="Credits / Persons" icon="&#128100;">
            <div className="repeatable-list">
              {album.persons.map((person, personIndex) => (
                <div key={personIndex} className="repeatable-item">
                  <div className="repeatable-item-content">
                    <div className="form-grid">
                      <div className="form-group">
                        <label className="form-label">Name<InfoIcon text={FIELD_INFO.personName} /></label>
                        <input
                          type="text"
                          className="form-input"
                          placeholder="Person name"
                          value={person.name || ''}
                          onChange={e => dispatch({
                            type: 'UPDATE_PERSON',
                            payload: { index: personIndex, person: { ...person, name: e.target.value } }
                          })}
                        />
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
                            payload: { index: personIndex, person: { ...person, href: e.target.value } }
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
                            payload: { index: personIndex, person: { ...person, img: e.target.value } }
                          })}
                        />
                      </div>
                    </div>

                    {/* Two-column layout: Roles (left) + Thumbnail Preview (right) */}
                    <div className="person-preview-container" style={{ marginTop: '16px', display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
                      {/* Left column: Roles section */}
                    <div className="person-roles-section" style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                        <label className="form-label" style={{ margin: 0 }}>Roles<InfoIcon text={FIELD_INFO.personRole} /></label>
                        <button
                          className="btn btn-secondary"
                          style={{ fontSize: '14px', padding: '8px 16px' }}
                          onClick={() => setShowRolesModal(true)}
                        >
                          View All Roles
                        </button>
                      </div>
                      <div className="person-roles-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '8px' }}>
                        {person.roles.map((role, roleIndex) => (
                          <div key={roleIndex} className="person-role-item" style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            background: 'var(--bg-tertiary)',
                            padding: '8px 12px',
                            borderRadius: '6px',
                            fontSize: '14px'
                          }}>
                            <select
                              className="form-select"
                              style={{ minWidth: '180px', padding: '8px 12px', fontSize: '14px' }}
                              value={role.group}
                              onChange={e => {
                                const newGroup = e.target.value as PersonGroup;
                                const newRole = PERSON_ROLES[newGroup]?.[0]?.value || 'band';
                                dispatch({
                                  type: 'UPDATE_PERSON_ROLE',
                                  payload: { personIndex, roleIndex, role: { group: newGroup, role: newRole } }
                                });
                              }}
                            >
                              {PERSON_GROUPS.map(g => (
                                <option key={g.value} value={g.value}>{g.label}</option>
                              ))}
                            </select>
                            <select
                              className="form-select"
                              style={{ minWidth: '200px', padding: '8px 12px', fontSize: '14px' }}
                              value={role.role}
                              onChange={e => dispatch({
                                type: 'UPDATE_PERSON_ROLE',
                                payload: { personIndex, roleIndex, role: { ...role, role: e.target.value } }
                              })}
                            >
                              {(PERSON_ROLES[role.group] || PERSON_ROLES.music).map(r => (
                                <option key={r.value} value={r.value}>{r.label}</option>
                              ))}
                            </select>
                            {person.roles.length > 1 && (
                              <button
                                className="btn btn-icon btn-danger"
                                style={{ padding: '6px 10px', fontSize: '14px', minWidth: 'auto' }}
                                onClick={() => dispatch({
                                  type: 'REMOVE_PERSON_ROLE',
                                  payload: { personIndex, roleIndex }
                                })}
                                title="Remove role"
                              >
                                &#10005;
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                      <button
                        className="btn btn-secondary"
                        style={{ fontSize: '12px', padding: '4px 12px' }}
                        onClick={() => dispatch({
                          type: 'ADD_PERSON_ROLE',
                          payload: { personIndex, role: createEmptyPersonRole() }
                        })}
                      >
                        + Add Role
                      </button>
                    </div>
                      {/* Right column: Thumbnail preview */}
                      <div className="person-thumbnail-preview" style={{
                        width: '140px',
                        flexShrink: 0,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '8px'
                      }}>
                        <div style={{
                          width: '100%',
                          aspectRatio: '1',
                          borderRadius: '8px',
                          overflow: 'hidden',
                          background: 'var(--bg-tertiary)',
                          border: '1px solid var(--border-color)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}>
                          {person.img ? (
                            <img
                              src={person.img}
                              alt={person.name || 'Person thumbnail'}
                              style={{
                                width: '100%',
                                height: '100%',
                                objectFit: 'cover'
                              }}
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = 'none';
                              }}
                              onLoad={(e) => {
                                (e.target as HTMLImageElement).style.display = 'block';
                              }}
                            />
                          ) : (
                            <span style={{
                              fontSize: '48px',
                              color: 'var(--text-muted)'
                            }}>
                              &#128100;
                            </span>
                          )}
                        </div>
                        <span style={{
                          fontSize: '12px',
                          color: 'var(--text-muted)',
                          textAlign: 'center',
                          width: '100%'
                        }}>
                          {person.img ? 'Photo' : 'No photo'}
                        </span>
                      </div>
                    </div>
                    {/* Close two-column container */}
                  </div>
                  <div className="repeatable-item-actions">
                    <button
                      className="btn btn-icon btn-danger"
                      onClick={() => dispatch({ type: 'REMOVE_PERSON', payload: personIndex })}
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
            <RecipientsList
              recipients={album.value.recipients}
              onUpdate={(index, recipient) => dispatch({
                type: 'UPDATE_RECIPIENT',
                payload: { index, recipient }
              })}
              onRemove={index => dispatch({ type: 'REMOVE_RECIPIENT', payload: index })}
              onAdd={recipient => dispatch({ type: 'ADD_RECIPIENT', payload: recipient })}
            />
          </Section>

          {/* Funding Section */}
          <Section title="Funding" icon="&#128176;">
            <FundingFields
              funding={album.funding}
              onUpdate={funding => dispatch({ type: 'UPDATE_ALBUM', payload: { funding } })}
            />
          </Section>

          {/* Publisher Section - Hidden for now
          <Section title="Publisher" icon="&#127970;">
            <p style={{ color: 'var(--text-secondary)', marginBottom: '16px', fontSize: '14px' }}>
              Link this album to a publisher feed. This allows apps to discover your other releases.
            </p>
            <div className="form-grid">
              <div className="form-group">
                <label className="form-label">Publisher Feed GUID<InfoIcon text={FIELD_INFO.publisherGuid} /></label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g., a1b2c3d4-e5f6-7890-abcd-ef1234567890"
                  value={album.publisher?.feedGuid || ''}
                  onChange={e => dispatch({
                    type: 'UPDATE_ALBUM',
                    payload: {
                      publisher: {
                        feedGuid: e.target.value,
                        feedUrl: album.publisher?.feedUrl || ''
                      }
                    }
                  })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Publisher Feed URL<InfoIcon text={FIELD_INFO.publisherUrl} /></label>
                <input
                  type="url"
                  className="form-input"
                  placeholder="https://example.com/publisher-feed.xml"
                  value={album.publisher?.feedUrl || ''}
                  onChange={e => dispatch({
                    type: 'UPDATE_ALBUM',
                    payload: {
                      publisher: {
                        feedGuid: album.publisher?.feedGuid || '',
                        feedUrl: e.target.value
                      }
                    }
                  })}
                />
              </div>
            </div>
            {album.publisher?.feedGuid && (
              <p style={{ color: 'var(--text-tertiary)', marginTop: '8px', fontSize: '12px' }}>
                This will add a &lt;podcast:publisher&gt; tag to your feed XML.
              </p>
            )}
          </Section>
          */}

          {/* Tracks Section */}
          <Section title="Tracks" icon="&#127925;">
            <div className="track-list">
              {album.tracks.map((track, index) => (
                <div key={track.id} className="repeatable-item" style={{ flexDirection: 'column' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', width: '100%' }}>
                    <span className="track-number">{track.trackNumber}</span>
                    <span style={{ flex: 1, fontWeight: 500 }}>{track.title || 'Untitled Track'}</span>
                    {track.duration && track.duration !== '00:00:00' && (
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
                        value={track.title || ''}
                        onChange={e => dispatch({
                          type: 'UPDATE_TRACK',
                          payload: { index, track: { title: e.target.value } }
                        })}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">MP3 URL <span className="required">*</span><InfoIcon text={FIELD_INFO.enclosureUrl} /></label>
                      <input
                        type="url"
                        className="form-input"
                        placeholder="https://example.com/track.mp3"
                        value={track.enclosureUrl || ''}
                        onChange={e => dispatch({
                          type: 'UPDATE_TRACK',
                          payload: { index, track: { enclosureUrl: e.target.value } }
                        })}
                        onPaste={async e => {
                          const url = e.clipboardData.getData('text').trim();
                          if (url && url.startsWith('http')) {
                            const isNewUrl = url !== track.enclosureUrl;
                            // Update the URL field immediately
                            dispatch({
                              type: 'UPDATE_TRACK',
                              payload: { index, track: { enclosureUrl: url } }
                            });
                            // Fetch duration using Audio API (always fetch for new URLs)
                            if (isNewUrl || !track.duration) {
                              const duration = await getAudioDuration(url);
                              if (duration !== null) {
                                dispatch({
                                  type: 'UPDATE_TRACK',
                                  payload: { index, track: { duration: secondsToHHMMSS(duration) } }
                                });
                              }
                            }
                            // Set placeholder file size
                            if (isNewUrl || !track.enclosureLength) {
                              dispatch({
                                type: 'UPDATE_TRACK',
                                payload: { index, track: { enclosureLength: '33' } }
                              });
                            }
                          }
                        }}
                        onBlur={async e => {
                          const url = e.target.value;
                          if (url && url.startsWith('http')) {
                            // Fetch duration using Audio API (works without CORS)
                            if (!track.duration) {
                              const duration = await getAudioDuration(url);
                              if (duration !== null) {
                                dispatch({
                                  type: 'UPDATE_TRACK',
                                  payload: { index, track: { duration: secondsToHHMMSS(duration) } }
                                });
                              }
                            }
                            // Set placeholder file size
                            if (!track.enclosureLength) {
                              dispatch({
                                type: 'UPDATE_TRACK',
                                payload: { index, track: { enclosureLength: '33' } }
                              });
                            }
                          }
                        }}
                      />
                      {track.enclosureUrl && (
                        <audio
                          src={track.enclosureUrl}
                          controls
                          style={{ width: '100%', marginTop: '8px' }}
                          onError={e => (e.target as HTMLAudioElement).style.display = 'none'}
                        />
                      )}
                    </div>
                    <div className="form-group">
                      <label className="form-label">Duration (HH:MM:SS) <span className="required">*</span><InfoIcon text={FIELD_INFO.trackDuration} /></label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="00:00:00"
                        value={track.duration || ''}
                        onChange={e => dispatch({
                          type: 'UPDATE_TRACK',
                          payload: { index, track: { duration: e.target.value } }
                        })}
                        onBlur={e => dispatch({
                          type: 'UPDATE_TRACK',
                          payload: { index, track: { duration: formatDuration(e.target.value) } }
                        })}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            dispatch({
                              type: 'UPDATE_TRACK',
                              payload: { index, track: { duration: formatDuration((e.target as HTMLInputElement).value) } }
                            });
                          }
                        }}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Pub Date<InfoIcon text={FIELD_INFO.trackPubDate} /></label>
                      <input
                        type="datetime-local"
                        className="form-input"
                        value={track.pubDate ? new Date(track.pubDate).toISOString().slice(0, 16) : ''}
                        onChange={e => dispatch({
                          type: 'UPDATE_TRACK',
                          payload: { index, track: { pubDate: new Date(e.target.value).toUTCString() } }
                        })}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Track # (Episode)<InfoIcon text={FIELD_INFO.trackEpisode} /></label>
                      <input
                        type="number"
                        className="form-input"
                        placeholder={String(track.trackNumber)}
                        min="1"
                        value={track.episode ?? ''}
                        onChange={e => dispatch({
                          type: 'UPDATE_TRACK',
                          payload: { index, track: { episode: e.target.value ? parseInt(e.target.value) : undefined } }
                        })}
                      />
                    </div>
                    <div className="form-group full-width">
                      <div className="track-preview-container" style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
                        {/* Left column: Description */}
                        <div className="track-description" style={{ flex: 1, minWidth: 0 }}>
                          <label className="form-label">Description<InfoIcon text={FIELD_INFO.trackDescription} /></label>
                          <textarea
                            className="form-textarea"
                            placeholder="Track description or notes"
                            value={track.description || ''}
                            onChange={e => dispatch({
                              type: 'UPDATE_TRACK',
                              payload: { index, track: { description: e.target.value } }
                            })}
                          />
                        </div>
                        {/* Right column: Thumbnail preview (from Track Art URL) */}
                        <div className="track-thumbnail-preview" style={{
                          width: '140px',
                          flexShrink: 0,
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: '8px'
                        }}>
                          <div style={{
                            width: '100%',
                            aspectRatio: '1',
                            borderRadius: '8px',
                            overflow: 'hidden',
                            background: 'var(--bg-tertiary)',
                            border: '1px solid var(--border-color)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}>
                            {track.trackArtUrl ? (
                              <img
                                src={track.trackArtUrl}
                                alt={track.title || 'Track art thumbnail'}
                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                onError={(e) => {
                                  (e.target as HTMLImageElement).style.display = 'none';
                                }}
                                onLoad={(e) => {
                                  (e.target as HTMLImageElement).style.display = 'block';
                                }}
                              />
                            ) : (
                              <span style={{ fontSize: '48px', color: 'var(--text-muted)' }}>
                                &#9835;
                              </span>
                            )}
                          </div>
                          <span style={{ fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center', width: '100%' }}>
                            {track.trackArtUrl ? 'Track art' : 'No track art'}
                          </span>
                        </div>
                      </div>
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
                        labelSuffix={<InfoIcon text={FIELD_INFO.trackExplicit} />}
                      />
                    </div>
                    <div className="form-group">
                      <Toggle
                        checked={track.overrideValue}
                        onChange={val => dispatch({
                          type: 'UPDATE_TRACK',
                          payload: { index, track: { overrideValue: val } }
                        })}
                        label="Override Value Split"
                        labelSuffix={<InfoIcon text={FIELD_INFO.overrideValue} />}
                      />
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
                                    value={recipient.name || ''}
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
                                    value={recipient.address || ''}
                                    onChange={e => {
                                      const address = e.target.value;
                                      const detectedType = detectAddressType(address);
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
                                    value={recipient.split ?? 0}
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
                        <AddRecipientSelect onAdd={recipient => {
                          const newRecipients = [...(track.value?.recipients || []), recipient];
                          dispatch({ type: 'UPDATE_TRACK', payload: { index, track: { value: { type: 'lightning', method: 'keysend', recipients: newRecipients } } } });
                        }} />
                      </div>
                    </div>
                  )}
                </div>
              ))}
              <button className="add-item-btn" onClick={() => {
                dispatch({ type: 'ADD_TRACK' });
              }}>
                + Add Track
              </button>
            </div>
          </Section>
        </div>
      </div>
      <RolesModal isOpen={showRolesModal} onClose={() => setShowRolesModal(false)} />
    </>
  );
}
