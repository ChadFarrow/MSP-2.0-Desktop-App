import { useState } from 'react';
import type { Track } from '../../types/feed';
import type { FeedAction } from '../../store/feedStore';
import { createEmptyTrack } from '../../types/feed';
import { FIELD_INFO } from '../../data/fieldInfo';
import { detectAddressType } from '../../utils/addressUtils';
import { getMediaDuration, secondsToHHMMSS, formatDuration } from '../../utils/audioUtils';
import { getVideoMimeType } from '../../utils/videoUtils';
import { isNaddrString, resolveNostrVideo } from '../../utils/nostrVideoConverter';
import { InfoIcon } from '../InfoIcon';
import { Section } from '../Section';
import { Toggle } from '../Toggle';
import { AddRecipientSelect } from '../AddRecipientSelect';

interface TracksSectionProps {
  tracks: Track[];
  isVideo: boolean;
  dispatch: React.Dispatch<FeedAction>;
}

export function TracksSection({ tracks, isVideo, dispatch }: TracksSectionProps) {
  const [collapsedTracks, setCollapsedTracks] = useState<Record<string, boolean>>({});
  const [resolvingNaddr, setResolvingNaddr] = useState<Record<number, boolean>>({});
  const [naddrError, setNaddrError] = useState<Record<number, string>>({});

  const toggleTrackCollapse = (trackId: string) => {
    setCollapsedTracks(prev => ({
      ...prev,
      [trackId]: !prev[trackId]
    }));
  };

  const allTracksCollapsed = tracks.length > 0 && tracks.every(t => collapsedTracks[t.id]);

  const toggleAllTracks = () => {
    if (allTracksCollapsed) {
      setCollapsedTracks({});
    } else {
      const allCollapsed: Record<string, boolean> = {};
      tracks.forEach(t => { allCollapsed[t.id] = true; });
      setCollapsedTracks(allCollapsed);
    }
  };

  return (
    <Section title={isVideo ? "Videos" : "Tracks"} icon={isVideo ? "🎬" : "🎵"}>
      {tracks.length > 0 && (
        <div style={{ marginBottom: '12px', textAlign: 'right' }}>
          <button
            className="btn btn-secondary"
            onClick={toggleAllTracks}
            style={{ fontSize: '0.875rem', padding: '4px 12px' }}
          >
            {allTracksCollapsed ? 'Expand All' : 'Collapse All'}
          </button>
        </div>
      )}
      <div className="track-list">
        {tracks.map((track, index) => (
          <div key={track.id} className="repeatable-item" style={{ flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', width: '100%' }}>
              <div
                style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, cursor: 'pointer' }}
                onClick={() => toggleTrackCollapse(track.id)}
              >
                <span className="track-number">{track.trackNumber}</span>
                <span style={{ flex: 1, fontWeight: 500 }}>{track.title || (isVideo ? 'Untitled Video' : 'Untitled Track')}</span>
                {track.duration && track.duration !== '00:00:00' && (
                  <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>{track.duration}</span>
                )}
                <span style={{ color: 'var(--text-secondary)' }}>
                  {collapsedTracks[track.id] ? '▶' : '▼'}
                </span>
              </div>
              <button
                className="btn btn-icon btn-danger"
                onClick={() => dispatch({ type: 'REMOVE_TRACK', payload: index })}
              >
                &#10005;
              </button>
            </div>
            {!collapsedTracks[track.id] && (
            <div className="form-grid" style={{ marginTop: '12px' }}>
              <div className="form-group">
                <label className="form-label">{isVideo ? 'Video Title' : 'Track Title'} <span className="required">*</span><InfoIcon text={FIELD_INFO.trackTitle} /></label>
                <input
                  type="text"
                  className="form-input"
                  placeholder={isVideo ? "Enter video title" : "Enter track title"}
                  value={track.title || ''}
                  onChange={e => dispatch({
                    type: 'UPDATE_TRACK',
                    payload: { index, track: { title: e.target.value } }
                  })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">{isVideo ? 'Video URL' : 'MP3 URL'} <span className="required">*</span><InfoIcon text={FIELD_INFO.enclosureUrl} /></label>
                <input
                  type="url"
                  className="form-input"
                  placeholder={isVideo ? "https://example.com/video.mp4" : "https://example.com/track.mp3"}
                  value={track.enclosureUrl || ''}
                  onChange={e => {
                    const url = e.target.value;
                    dispatch({
                      type: 'UPDATE_TRACK',
                      payload: { index, track: { enclosureUrl: url } }
                    });
                    if (isVideo && url) {
                      dispatch({
                        type: 'UPDATE_TRACK',
                        payload: { index, track: { enclosureType: getVideoMimeType(url) } }
                      });
                    }
                  }}
                  onPaste={async e => {
                    const pastedText = e.clipboardData.getData('text').trim();
                    if (isVideo && isNaddrString(pastedText)) {
                      e.preventDefault();
                      setResolvingNaddr(prev => ({ ...prev, [index]: true }));
                      setNaddrError(prev => { const next = { ...prev }; delete next[index]; return next; });
                      try {
                        const videoData = await resolveNostrVideo(pastedText);
                        if (videoData) {
                          dispatch({
                            type: 'UPDATE_TRACK',
                            payload: {
                              index,
                              track: {
                                enclosureUrl: videoData.url,
                                enclosureType: videoData.mimeType,
                                enclosureLength: '33',
                                ...(videoData.duration && { duration: videoData.duration }),
                              }
                            }
                          });
                        }
                      } catch (err) {
                        const msg = err instanceof Error ? err.message : 'Failed to resolve Nostr video';
                        setNaddrError(prev => ({ ...prev, [index]: msg }));
                      } finally {
                        setResolvingNaddr(prev => ({ ...prev, [index]: false }));
                      }
                      return;
                    }
                    const url = pastedText;
                    if (url && url.startsWith('http')) {
                      e.preventDefault();
                      const isNewUrl = url !== track.enclosureUrl;
                      dispatch({
                        type: 'UPDATE_TRACK',
                        payload: { index, track: { enclosureUrl: url } }
                      });
                      if (isVideo) {
                        dispatch({
                          type: 'UPDATE_TRACK',
                          payload: { index, track: { enclosureType: getVideoMimeType(url) } }
                        });
                      }
                      if (isNewUrl || !track.duration) {
                        const duration = await getMediaDuration(url);
                        if (duration !== null) {
                          dispatch({
                            type: 'UPDATE_TRACK',
                            payload: { index, track: { duration: secondsToHHMMSS(duration) } }
                          });
                        }
                      }
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
                      if (!track.duration) {
                        const duration = await getMediaDuration(url);
                        if (duration !== null) {
                          dispatch({
                            type: 'UPDATE_TRACK',
                            payload: { index, track: { duration: secondsToHHMMSS(duration) } }
                          });
                        }
                      }
                      if (!track.enclosureLength) {
                        dispatch({
                          type: 'UPDATE_TRACK',
                          payload: { index, track: { enclosureLength: '33' } }
                        });
                      }
                    }
                  }}
                />
                {isVideo && resolvingNaddr[index] && (
                  <div style={{ color: 'var(--text-secondary)', fontSize: '0.85em', marginTop: '4px' }}>
                    Resolving Nostr video...
                  </div>
                )}
                {isVideo && naddrError[index] && (
                  <div style={{ color: 'var(--error)', fontSize: '0.85em', marginTop: '4px' }}>
                    {naddrError[index]}
                  </div>
                )}
                {isVideo && !resolvingNaddr[index] && !track.enclosureUrl && (
                  <div style={{ color: 'var(--text-secondary)', fontSize: '0.8em', marginTop: '4px', opacity: 0.7 }}>
                    Tip: Paste a Nostr naddr to auto-fill video details
                  </div>
                )}
                {track.enclosureUrl && (
                  isVideo ? (
                    <video
                      src={track.enclosureUrl}
                      controls
                      style={{ width: '100%', marginTop: '8px', maxHeight: '300px' }}
                      onError={e => (e.target as HTMLVideoElement).style.display = 'none'}
                    />
                  ) : (
                    <audio
                      src={track.enclosureUrl}
                      controls
                      style={{ width: '100%', marginTop: '8px' }}
                      onError={e => (e.target as HTMLAudioElement).style.display = 'none'}
                    />
                  )
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
                <label className="form-label">{isVideo ? 'Video #' : 'Track #'} (Episode)<InfoIcon text={FIELD_INFO.trackEpisode} /></label>
                <input
                  type="number"
                  className="form-input"
                  placeholder={String(track.trackNumber)}
                  min="1"
                  value={track.episode ?? ''}
                  onChange={e => {
                    const newEpisode = e.target.value ? parseInt(e.target.value) : undefined;
                    dispatch({
                      type: 'UPDATE_TRACK',
                      payload: { index, track: { episode: newEpisode } }
                    });
                    if (newEpisode !== undefined) {
                      const newIndex = newEpisode - 1;
                      if (newIndex >= 0 && newIndex < tracks.length && newIndex !== index) {
                        dispatch({ type: 'REORDER_TRACKS', payload: { fromIndex: index, toIndex: newIndex } });
                      }
                    }
                  }}
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
                      ...(!isVideo && { aspectRatio: '1' }),
                      borderRadius: '8px',
                      overflow: 'hidden',
                      background: 'var(--bg-tertiary)',
                      border: '1px solid var(--border-color)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      ...(isVideo && !track.trackArtUrl && { aspectRatio: '16 / 9' })
                    }}>
                      {track.trackArtUrl ? (
                        <img
                          src={track.trackArtUrl}
                          alt={track.title || 'Track art thumbnail'}
                          style={{ width: '100%', display: 'block' }}
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                          }}
                          onLoad={(e) => {
                            (e.target as HTMLImageElement).style.display = 'block';
                          }}
                        />
                      ) : (
                        <span style={{ fontSize: '48px', color: 'var(--text-muted)' }}>
                          {isVideo ? '\u25B6' : '\u266B'}
                        </span>
                      )}
                    </div>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center', width: '100%' }}>
                      {track.trackArtUrl ? (isVideo ? 'Thumbnail' : 'Track art') : (isVideo ? 'No thumbnail' : 'No track art')}
                    </span>
                  </div>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">{isVideo ? 'Thumbnail URL' : 'Track Art URL'}<InfoIcon text={FIELD_INFO.trackArtUrl} /></label>
                <input
                  type="url"
                  className="form-input"
                  placeholder={isVideo ? "Override cover art for this video" : "Override album art for this track"}
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
            {track.overrideValue && !collapsedTracks[track.id] && (
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
          dispatch({ type: 'ADD_TRACK', payload: createEmptyTrack(tracks.length + 1, isVideo ? 'video/mp4' : 'audio/mpeg') });
        }}>
          + Add {isVideo ? 'Video' : 'Track'}
        </button>
      </div>
    </Section>
  );
}
