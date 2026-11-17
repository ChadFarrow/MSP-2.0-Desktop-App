import { useState, useEffect, useCallback, useMemo } from 'react';
import { useFeed } from '../../store/feedStore';
import { useNostr } from '../../store/nostrStore';
import { useExperimental } from '../../store/experimentalStore';
import { LANGUAGES, PERSON_GROUPS, PERSON_ROLES, createEmptyPersonRole, createEmptyTrack, isVideoMedium, isCommunitySupport, createSupportRecipients, hasUserRecipients, TRANSCRIPT_TYPES, DEFAULT_TRANSCRIPT_TYPE } from '../../types/feed';
import type { PersonGroup } from '../../types/feed';
import { FIELD_INFO } from '../../data/fieldInfo';
import { detectAddressType } from '../../utils/addressUtils';
import { getMediaDuration, secondsToHHMMSS, formatDuration, getAudioMimeType, isKnownAudioFormat, resolveMediaSize, hhmmssToSeconds, AUDIO_EXTENSION_LIST } from '../../utils/audioUtils';
import { getVideoMimeType } from '../../utils/videoUtils';
import { isNaddrString, resolveNostrVideo } from '../../utils/nostrVideoConverter';
import { getFeedUrlError, normalizeFeedUrl } from '../../utils/urlValidation';
import { trackOrderIssue } from '../../utils/trackOrder';
import { verifyFeedUrl, isGuardRefusal, FORCED_SUBMIT_NOTE } from '../../utils/verifyFeedUrl';
import { lookupPublisherFeed, PUBLISHER_NOT_FOUND } from '../../utils/publisherLookup';
import { isUsableParty } from '../../utils/publisherParties';
import { withRole } from '../../utils/publisherRole';
import { BetaTag } from '../BetaTag';
import { InfoIcon } from '../InfoIcon';
import { ListingSelect } from '../ListingSelect';
import { Section } from '../Section';
import { Toggle } from '../Toggle';
import { AddRecipientSelect } from '../AddRecipientSelect';
import { RecipientsList } from '../RecipientsList';
import { FundingFields } from '../FundingFields';
import { ArtworkFields } from '../ArtworkFields';
import { PodcastImagesList } from '../PodcastImagesList';
import { AlternateEnclosuresList } from '../AlternateEnclosuresList';
import { AdditionalPublishers } from './AdditionalPublishers';
import { RolePicker } from '../RolePicker';
import { showsAlternateVersions } from '../../utils/alternateEnclosure';
import { FeedCheckPanel } from '../FeedCheckPanel';
import { PubDateInput } from '../PubDateInput';

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

function Op3StatsLink({ podcastGuid }: { podcastGuid: string }) {
  const [hasStats, setHasStats] = useState<boolean | null>(null);

  // No setHasStats(null) reset here — the call site keys this component on
  // podcastGuid, so a guid change remounts it and useState does the reset.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/op3check?guid=${encodeURIComponent(podcastGuid)}`)
      .then(res => res.json())
      .then(data => { if (!cancelled) setHasStats(data.hasStats === true); })
      .catch(() => { if (!cancelled) setHasStats(false); });
    return () => { cancelled = true; };
  }, [podcastGuid]);

  const link = (
    <a
      href={`https://op3.dev/show/${podcastGuid}`}
      target="_blank"
      rel="noopener noreferrer"
      style={{ color: 'var(--accent-color)', textDecoration: 'underline' }}
    >here</a>
  );

  return (
    <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '4px 0 0 0' }}>
      {hasStats === null
        ? 'Checking OP3 stats...'
        : hasStats
          ? <>View your OP3 stats {link}.</>
          : <>Once OP3 has observed a few days of downloads, stats will be available {link}.</>
      }
    </p>
  );
}

export function Editor() {
  const { state, dispatch } = useFeed();
  const { state: nostrState } = useNostr();
  const { showBeta } = useExperimental();
  // Get the active album based on feedType (album or videoFeed)
  const album = state.feedType === 'video' && state.videoFeed ? state.videoFeed : state.album;

  // Simple collapse state - all tracks start expanded (empty object = nothing collapsed)
  // Editor remounts on album change (via key prop), so this always starts fresh
  const [collapsedTracks, setCollapsedTracks] = useState<Record<string, boolean>>({});
  const [showRolesModal, setShowRolesModal] = useState(false);
  const [publisherLookup, setPublisherLookup] = useState<{
    loading: boolean;
    error: string | null;
    feedTitle: string | null;
    feedImage: string | null;
  }>({ loading: false, error: null, feedTitle: null, feedImage: null });

  // Nostr naddr resolution state (per-track index)
  const [resolvingNaddr, setResolvingNaddr] = useState<Record<number, boolean>>({});
  const [naddrError, setNaddrError] = useState<Record<number, string>>({});

  // Submit to Podcast Index state
  const [piSubmitting, setPiSubmitting] = useState(false);
  const [piSubmitResult, setPiSubmitResult] = useState<{ success: boolean; message: string } | null>(null);
  // Latch: set when the reachability check warns, so a second click submits anyway.
  const [piBypassVerify, setPiBypassVerify] = useState(false);
  const publisherFeedUrlError = getFeedUrlError(album.publisher?.feedUrl || '');

  // Auto-lookup publisher feed in Podcast Index when URL changes. The reply can
  // land after the user edited the field, so it is dropped once `signal` aborts,
  // and the GUID is set on the publisher at that URL (SET_PUBLISHER_GUID), never
  // written over the whole reference: that kept a stale URL and deleted the rel
  // an imported feed states.
  // The lookup itself is shared with the other publishers (utils/publisherLookup.ts),
  // and takes a result only when it is the feed at this URL.
  const lookupPublisher = useCallback(async (feedUrl: string, signal: AbortSignal) => {
    // Only lookup actual URLs, not search terms
    if (!feedUrl.startsWith('http://') && !feedUrl.startsWith('https://')) {
      setPublisherLookup({ loading: false, error: null, feedTitle: null, feedImage: null });
      return;
    }

    setPublisherLookup({ loading: true, error: null, feedTitle: null, feedImage: null });

    const result = await lookupPublisherFeed(feedUrl, signal);
    if (signal.aborted) return;
    if (result.ok) {
      dispatch({ type: 'SET_PUBLISHER_GUID', payload: { feedUrl, feedGuid: result.feed.feedGuid } });
      setPublisherLookup({ loading: false, error: null, feedTitle: result.feed.title, feedImage: result.feed.image });
    } else {
      setPublisherLookup({ loading: false, error: result.error, feedTitle: null, feedImage: null });
    }
  }, [dispatch]);

  // Debounce publisher URL lookup
  useEffect(() => {
    const url = album.publisher?.feedUrl;
    if (!url) {
      setPublisherLookup({ loading: false, error: null, feedTitle: null, feedImage: null });
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      lookupPublisher(url, controller.signal);
    }, 500);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [album.publisher?.feedUrl, lookupPublisher]);

  // Submit feed to Podcast Index
  const handleSubmitToPI = async () => {
    // Normalize here too: the store value can arrive from a feed import, which
    // never passes through the input's onChange.
    const feedUrl = normalizeFeedUrl(album.publisher?.feedUrl || '');
    if (!feedUrl) return;
    setPiSubmitting(true);
    setPiSubmitResult(null);
    try {
      // Check the feed actually resolves, via /api/verify-feed-url rather than
      // /api/proxy-feed: this needs a verdict, not the bytes, and a verdict is
      // cheaper and safer to ask for.
      // The latch doubles as the override: set by this check or by a server
      // refusal, and cleared whenever the URL changes.
      const force = piBypassVerify;
      if (!force) {
        const check = await verifyFeedUrl(feedUrl);
        if (!check.ok) {
          setPiSubmitResult({
            success: false,
            message: `${check.warning} Click again to submit anyway.`
          });
          setPiBypassVerify(true);
          return;
        }
      }

      // Submit to Podcast Index
      const response = await fetch('/api/pisubmit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: feedUrl, ...(force ? { force: true } : {}) })
      });
      const data = await response.json();
      if (response.ok && data.success) {
        setPiSubmitResult({
          success: true,
          message: `Submitted! May take a few minutes to index.${force ? FORCED_SUBMIT_NOTE : ''}`
        });
      } else if (isGuardRefusal(data)) {
        // The server saw a block our own check missed. Arm the latch so the
        // button becomes "Submit anyway" rather than a dead end.
        setPiSubmitResult({ success: false, message: `${data.error} Click again to submit anyway.` });
        setPiBypassVerify(true);
      } else {
        setPiSubmitResult({ success: false, message: data.error || data.details?.description || 'Failed to submit' });
      }
    } catch {
      setPiSubmitResult({ success: false, message: 'Failed to submit' });
    } finally {
      setPiSubmitting(false);
    }
  };

  // Determine if this is a video feed
  const isVideo = isVideoMedium(album.medium);

  // Feeds built or imported before pub dates were kept in sync with list order can still be
  // out of order; offer a one-click repair rather than rewriting an import behind their back.
  const orderIssue = useMemo(() => trackOrderIssue(album.tracks), [album.tracks]);

  const toggleTrackCollapse = (trackId: string) => {
    setCollapsedTracks(prev => ({
      ...prev,
      [trackId]: !prev[trackId]
    }));
  };

  const allTracksCollapsed = album?.tracks?.length > 0 && album.tracks.every(t => collapsedTracks[t.id]);

  const toggleAllTracks = () => {
    if (allTracksCollapsed) {
      setCollapsedTracks({});
    } else {
      const allCollapsed: Record<string, boolean> = {};
      album?.tracks?.forEach(t => { allCollapsed[t.id] = true; });
      setCollapsedTracks(allCollapsed);
    }
  };

  return (
    <>
      <div className="main-content">
        <div className="editor-panel">
          <FeedCheckPanel />
          {/* Album/Video Info Section */}
          <Section title={isVideo ? "Video Info" : "Album Info"} icon={isVideo ? "🎬" : "💿"}>
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
                <label className="form-label">{isVideo ? 'Video Title' : 'Album Title'} <span className="required">*</span><InfoIcon text={FIELD_INFO.title} /></label>
                <input
                  type="text"
                  className="form-input"
                  placeholder={isVideo ? "Enter video title" : "Enter album title"}
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
              <div className="form-group">
                <label className="form-label">Listing<InfoIcon text={FIELD_INFO.listing} /></label>
                <ListingSelect value={album} onChange={flags => dispatch({ type: 'UPDATE_ALBUM', payload: flags })} />
              </div>
              <div className="form-group" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', paddingTop: '28px', gap: '10px' }}>
                <Toggle
                  checked={album.explicit}
                  onChange={val => dispatch({ type: 'UPDATE_ALBUM', payload: { explicit: val } })}
                  label="Explicit Content"
                  labelSuffix={<InfoIcon text={FIELD_INFO.explicit} />}
                />
                <Toggle
                  checked={album.op3}
                  onChange={val => dispatch({ type: 'UPDATE_ALBUM', payload: { op3: val } })}
                  label={<>
                    <a
                      href="https://op3.dev/"
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: 'var(--accent-color)', textDecoration: 'underline' }}
                      title="Learn more at op3.dev"
                    >OP3</a> Analytics
                  </>}
                  labelSuffix={<InfoIcon text={FIELD_INFO.op3} />}
                />
                {album.op3 && album.podcastGuid && (
                  <Op3StatsLink key={album.podcastGuid} podcastGuid={album.podcastGuid} />
                )}
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
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Auto-generated UUID"
                    value={album.podcastGuid || ''}
                    onChange={e => dispatch({ type: 'UPDATE_ALBUM', payload: { podcastGuid: e.target.value } })}
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary btn-small"
                    title="Generate new GUID"
                    onClick={() => {
                      if (confirm('Generate a new GUID? This will create a new feed identity. Only do this if you are using this feed as a template for a new album.')) {
                        dispatch({ type: 'UPDATE_ALBUM', payload: { podcastGuid: crypto.randomUUID() } });
                      }
                    }}
                  >
                    New
                  </button>
                </div>
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
              <div className="form-group">
                <label className="form-label">Artist npub<InfoIcon text={FIELD_INFO.artistNpub} /></label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="npub1..."
                    value={album.artistNpub || ''}
                    onChange={e => dispatch({ type: 'UPDATE_ALBUM', payload: { artistNpub: e.target.value } })}
                    style={{ flex: 1 }}
                  />
                  {nostrState.isLoggedIn && nostrState.user?.npub && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => dispatch({ type: 'UPDATE_ALBUM', payload: { artistNpub: nostrState.user!.npub } })}
                      title="Use your logged-in Nostr npub"
                      style={{ padding: '0 12px', fontSize: '0.8rem' }}
                    >
                      use mine
                    </button>
                  )}
                </div>
              </div>
            </div>
          </Section>

          {/* Artwork Section */}
          <Section title={isVideo ? "Video Artwork" : "Album Artwork"} icon={isVideo ? "🎬" : "🎨"}>
            <ArtworkFields
              imageUrl={album.imageUrl}
              imageTitle={album.imageTitle}
              imageDescription={album.imageDescription}
              onUpdate={(field, value) => dispatch({ type: 'UPDATE_ALBUM', payload: { [field]: value } })}
              urlLabel={isVideo ? "Video Art URL" : "Album Art URL"}
              urlPlaceholder={isVideo ? "https://example.com/video-art.jpg" : "https://example.com/album-art.jpg"}
              titlePlaceholder={isVideo ? "Video cover description" : "Album cover description"}
              previewAlt={isVideo ? "Video preview" : "Album preview"}
            />
            <PodcastImagesList
              images={album.podcastImages || []}
              onChange={images => dispatch({ type: 'UPDATE_ALBUM', payload: { podcastImages: images } })}
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
                      <div className="form-group">
                        <label className="form-label">Nostr npub<InfoIcon text={FIELD_INFO.personNpub} /></label>
                        <input
                          type="text"
                          className="form-input"
                          placeholder="npub1..."
                          value={person.npub || ''}
                          onChange={e => dispatch({
                            type: 'UPDATE_PERSON',
                            payload: { index: personIndex, person: { ...person, npub: e.target.value } }
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
                          ...(!person.img && { aspectRatio: '1' }),
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
                                display: 'block'
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

          {/* Publisher Section */}
          <Section title="Publisher Feed (Advanced)" icon="&#127970;">
            <p style={{ color: 'var(--text-secondary)', marginBottom: '16px', fontSize: '14px' }}>
              Add this release to a publisher catalog by entering the publisher's feed URL (must be in Podcast Index).
            </p>
            <div className="form-group">
              <label className="form-label">Publisher Feed URL<InfoIcon text={FIELD_INFO.publisherUrl} /></label>
              <input
                type="url"
                className="form-input"
                placeholder="https://example.com/publisher-feed.xml"
                value={album.publisher?.feedUrl || ''}
                onChange={e => {
                  setPiBypassVerify(false);
                  setPiSubmitResult(null);
                  dispatch({
                    type: 'UPDATE_ALBUM',
                    payload: {
                      publisher: {
                        feedGuid: '',
                        feedUrl: normalizeFeedUrl(e.target.value)
                      }
                    }
                  });
                }}
                style={publisherFeedUrlError ? { borderColor: 'var(--error, #ef4444)' } : undefined}
              />
              {publisherFeedUrlError && (
                <p style={{ color: 'var(--error, #ef4444)', fontSize: '12px', marginTop: '6px', marginBottom: 0 }}>
                  {publisherFeedUrlError}
                </p>
              )}
              {publisherLookup.loading && (
                <p style={{ color: 'var(--text-tertiary)', marginTop: '8px', fontSize: '12px' }}>
                  Looking up feed in Podcast Index...
                </p>
              )}
              {publisherLookup.error && (
                <div style={{ marginTop: '8px' }}>
                  <p style={{ color: 'var(--warning-color, #f59e0b)', fontSize: '12px', marginBottom: '8px' }}>
                    ⚠ {publisherLookup.error}
                  </p>
                  {publisherLookup.error === PUBLISHER_NOT_FOUND && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <button
                        className="btn btn-secondary"
                        onClick={handleSubmitToPI}
                        disabled={piSubmitting || !!publisherFeedUrlError}
                        style={{ fontSize: '12px', padding: '6px 12px' }}
                      >
                        {piSubmitting
                          ? 'Submitting...'
                          : piBypassVerify ? 'Submit anyway' : 'Submit to Podcast Index'}
                      </button>
                      {piSubmitResult && (
                        <span style={{
                          color: piSubmitResult.success ? 'var(--success-color, #22c55e)' : 'var(--danger-color, #ef4444)',
                          fontSize: '12px'
                        }}>
                          {piSubmitResult.message}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}
              {album.publisher?.feedGuid && !publisherLookup.loading && !publisherLookup.error && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '8px' }}>
                  {publisherLookup.feedImage && (
                    <img
                      src={publisherLookup.feedImage}
                      alt=""
                      style={{ width: '40px', height: '40px', borderRadius: '4px', objectFit: 'cover' }}
                    />
                  )}
                  <p style={{ color: 'var(--success)', fontSize: '12px', margin: 0 }}>
                    ✓ Found: {publisherLookup.feedTitle || 'Publisher Feed'}
                  </p>
                </div>
              )}
            </div>
            {/* Beta (podcast-namespace PR #793): the role of the publisher, and
                further publishers. Shown with Show Beta Features on, or when the
                album already states one, so the toggle never hides what MSP writes. */}
            {isUsableParty(album.publisher) && (showBeta || album.publisher.rel) && (
              <div style={{ marginTop: '20px' }}>
                <RolePicker
                  rel={album.publisher.rel}
                  info={FIELD_INFO.publisherRole}
                  onChange={rel => album.publisher && dispatch({
                    type: 'UPDATE_ALBUM',
                    payload: { publisher: withRole(album.publisher, rel) }
                  })}
                />
              </div>
            )}
            {(showBeta || (album.additionalPublishers?.length ?? 0) > 0) && (
              <AdditionalPublishers
                primary={album.publisher}
                parties={album.additionalPublishers ?? []}
                canAdd={showBeta}
                showRoles={showBeta}
                onChange={parties => dispatch({
                  type: 'UPDATE_ALBUM',
                  payload: { additionalPublishers: parties.length > 0 ? parties : undefined }
                })}
                onMakePrimary={index => {
                  const others = album.additionalPublishers ?? [];
                  const chosen = others[index];
                  if (!isUsableParty(chosen)) return;
                  // Swap: the chosen party is written first, and the old primary
                  // takes its place (or leaves the list, when the field was empty).
                  const primary = album.publisher;
                  const rest = isUsableParty(primary)
                    ? others.map((party, i) => (i === index ? primary : party))
                    : others.filter((_, i) => i !== index);
                  dispatch({
                    type: 'UPDATE_ALBUM',
                    payload: { publisher: chosen, additionalPublishers: rest.length > 0 ? rest : undefined }
                  });
                }}
                onGuidFound={(feedUrl, feedGuid) => dispatch({ type: 'SET_PUBLISHER_GUID', payload: { feedUrl, feedGuid } })}
              />
            )}
          </Section>

          {/* Tracks/Videos Section */}
          <Section title={isVideo ? "Videos" : "Tracks"} icon={isVideo ? "🎬" : "🎵"}>
            {orderIssue && (
              <div className="track-order-warning">
                <span>
                  {orderIssue === 'reversed'
                    ? `These ${isVideo ? 'videos' : 'tracks'} look like they're in reverse order — ${isVideo ? 'video' : 'track'} 1 is at the bottom.`
                    : `Pub dates don't match this order, so apps may play these ${isVideo ? 'videos' : 'tracks'} out of order.`}
                </span>
                <button
                  className="btn btn-warning"
                  onClick={() => dispatch({ type: 'FIX_TRACK_ORDER' })}
                  style={{ fontSize: '0.875rem', padding: '4px 12px', whiteSpace: 'nowrap' }}
                >
                  {orderIssue === 'reversed' ? 'Reverse order' : 'Fix pub dates'}
                </button>
              </div>
            )}
            {album.tracks.length > 0 && (
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
              {album.tracks.map((track, index) => (
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
                          if (url) {
                            const mimeType = isVideo ? getVideoMimeType(url) : getAudioMimeType(url);
                            dispatch({
                              type: 'UPDATE_TRACK',
                              payload: { index, track: { enclosureType: mimeType } }
                            });
                          }
                        }}
                        onPaste={async e => {
                          const pastedText = e.clipboardData.getData('text').trim();
                          // Detect Nostr naddr strings (video feed only)
                          if (isVideo && isNaddrString(pastedText)) {
                            e.preventDefault();
                            setResolvingNaddr(prev => ({ ...prev, [index]: true }));
                            setNaddrError(prev => { const next = { ...prev }; delete next[index]; return next; });
                            try {
                              const videoData = await resolveNostrVideo(pastedText);
                              if (videoData) {
                                const bytes = await resolveMediaSize(videoData.url, hhmmssToSeconds(videoData.duration));
                                dispatch({
                                  type: 'UPDATE_TRACK',
                                  payload: {
                                    index,
                                    track: {
                                      enclosureUrl: videoData.url,
                                      enclosureType: videoData.mimeType,
                                      enclosureLength: String(bytes),
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
                            // Update the URL field immediately
                            dispatch({
                              type: 'UPDATE_TRACK',
                              payload: { index, track: { enclosureUrl: url } }
                            });
                            const mimeType = isVideo ? getVideoMimeType(url) : getAudioMimeType(url);
                            dispatch({
                              type: 'UPDATE_TRACK',
                              payload: { index, track: { enclosureType: mimeType } }
                            });
                            // Fetch duration using unified Media API (works for both audio and video)
                            let durationSeconds: number | null = null;
                            if (isNewUrl || !track.duration) {
                              durationSeconds = await getMediaDuration(url);
                              if (durationSeconds !== null) {
                                dispatch({
                                  type: 'UPDATE_TRACK',
                                  payload: { index, track: { duration: secondsToHHMMSS(durationSeconds) } }
                                });
                              }
                            }
                            // Measure the real file size; falls back to an estimate if the host blocks us
                            if (isNewUrl || !track.enclosureLength) {
                              const bytes = await resolveMediaSize(url, durationSeconds ?? hhmmssToSeconds(track.duration));
                              dispatch({
                                type: 'UPDATE_TRACK',
                                payload: { index, track: { enclosureLength: String(bytes) } }
                              });
                            }
                          }
                        }}
                        onBlur={async e => {
                          const url = e.target.value;
                          if (url && url.startsWith('http')) {
                            // Fetch duration using unified Media API (works for both audio and video)
                            let durationSeconds: number | null = null;
                            if (!track.duration) {
                              durationSeconds = await getMediaDuration(url);
                              if (durationSeconds !== null) {
                                dispatch({
                                  type: 'UPDATE_TRACK',
                                  payload: { index, track: { duration: secondsToHHMMSS(durationSeconds) } }
                                });
                              }
                            }
                            // Measure the real file size; falls back to an estimate if the host blocks us
                            if (!track.enclosureLength) {
                              const bytes = await resolveMediaSize(url, durationSeconds ?? hhmmssToSeconds(track.duration));
                              dispatch({
                                type: 'UPDATE_TRACK',
                                payload: { index, track: { enclosureLength: String(bytes) } }
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
                      {!isVideo && track.enclosureUrl && !isKnownAudioFormat(track.enclosureUrl) && (
                        <div style={{ color: 'var(--warning, #b8860b)', fontSize: '0.85em', marginTop: '4px' }}>
                          URL doesn't end with a recognized audio extension ({AUDIO_EXTENSION_LIST}). Podcast apps may not play it.
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
                      <PubDateInput
                        value={track.pubDate}
                        onChange={pubDate => dispatch({ type: 'UPDATE_TRACK', payload: { index, track: { pubDate } } })}
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
                          // Also reorder to match episode number
                          if (newEpisode !== undefined) {
                            const newIndex = newEpisode - 1;
                            if (newIndex >= 0 && newIndex < album.tracks.length && newIndex !== index) {
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
                    <PodcastImagesList
                      label="Additional Track Images"
                      images={track.podcastImages || []}
                      onChange={images => dispatch({ type: 'UPDATE_TRACK', payload: { index, track: { podcastImages: images } } })}
                    />
                    <div className="form-group">
                      <label className="form-label">Lyrics URL<InfoIcon text={FIELD_INFO.transcriptUrl} /></label>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <input
                          type="url"
                          className="form-input"
                          style={{ flex: '1 1 240px', minWidth: 0 }}
                          placeholder="https://example.com/lyrics.srt"
                          value={track.transcriptUrl || ''}
                          onChange={e => dispatch({
                            type: 'UPDATE_TRACK',
                            payload: { index, track: { transcriptUrl: e.target.value } }
                          })}
                        />
                        <select
                          className="form-select"
                          style={{ flex: '0 0 auto', minWidth: '170px' }}
                          aria-label="Lyrics file type"
                          value={track.transcriptType || DEFAULT_TRANSCRIPT_TYPE}
                          onChange={e => dispatch({
                            type: 'UPDATE_TRACK',
                            payload: { index, track: { transcriptType: e.target.value } }
                          })}
                        >
                          {TRANSCRIPT_TYPES.map(t => (
                            <option key={t.value} value={t.value}>{t.label}</option>
                          ))}
                          {/* An imported feed may carry a type outside the spec list
                              (MSP itself wrote application/srt for a long time). Show
                              it rather than silently snapping the value to SubRip. */}
                          {track.transcriptType &&
                            !TRANSCRIPT_TYPES.some(t => t.value === track.transcriptType) && (
                            <option value={track.transcriptType}>{track.transcriptType}</option>
                          )}
                        </select>
                      </div>
                    </div>
                    {/* Audio versions on album tracks first; video feeds come later.
                        Adding is a beta feature; versions a track already has always show. */}
                    {showsAlternateVersions(album, track, showBeta) && (
                      <AlternateEnclosuresList
                        canAdd={showBeta}
                        enclosures={track.alternateEnclosures || []}
                        onChange={alternateEnclosures => dispatch({
                          type: 'UPDATE_TRACK',
                          payload: { index, track: { alternateEnclosures: alternateEnclosures.length > 0 ? alternateEnclosures : undefined } }
                        })}
                        onMeasured={(versionId, url, field, value) => dispatch({
                          type: 'SET_ALTERNATE_ENCLOSURE_MEASURED',
                          payload: { trackId: track.id, versionId, url, field, value }
                        })}
                      />
                    )}
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
                    {/* Shown when the feed already has a recommendation, so turning the
                        beta toggle off can never hide one that will be written. */}
                    {(showBeta || track.pinned) && (
                      <div className="form-group beta-field">
                        <Toggle
                          checked={!!track.pinned}
                          onChange={val => dispatch({
                            type: 'UPDATE_TRACK',
                            payload: { index, track: { pinned: val } }
                          })}
                          label={<>Recommended first listen <BetaTag /></>}
                          labelSuffix={<InfoIcon text={FIELD_INFO.trackPinned} />}
                        />
                      </div>
                    )}
                    <div className="form-group">
                      <Toggle
                        checked={track.overridePersons}
                        onChange={val => dispatch({
                          type: 'UPDATE_TRACK',
                          payload: { index, track: {
                            overridePersons: val,
                            ...(val && track.persons.length === 0 ? {
                              persons: album.persons.map(p => ({ ...p, roles: p.roles.map(r => ({ ...r })) }))
                            } : {})
                          } }
                        })}
                        label="Override Persons"
                        labelSuffix={<InfoIcon text={FIELD_INFO.overridePersons} />}
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

                  {/* Track-specific Persons */}
                  {track.overridePersons && !collapsedTracks[track.id] && (
                    <div style={{ marginTop: '12px', padding: '12px', background: 'var(--bg-primary)', borderRadius: '8px' }}>
                      <h5 style={{ marginBottom: '12px', color: 'var(--text-secondary)' }}>Track Credits / Persons</h5>
                      <div className="repeatable-list">
                        {track.persons.map((person, personIndex) => (
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
                                      type: 'UPDATE_TRACK_PERSON',
                                      payload: { trackIndex: index, personIndex, person: { ...person, name: e.target.value } }
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
                                      type: 'UPDATE_TRACK_PERSON',
                                      payload: { trackIndex: index, personIndex, person: { ...person, href: e.target.value } }
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
                                      type: 'UPDATE_TRACK_PERSON',
                                      payload: { trackIndex: index, personIndex, person: { ...person, img: e.target.value } }
                                    })}
                                  />
                                </div>
                                <div className="form-group">
                                  <label className="form-label">Nostr npub<InfoIcon text={FIELD_INFO.personNpub} /></label>
                                  <input
                                    type="text"
                                    className="form-input"
                                    placeholder="npub1..."
                                    value={person.npub || ''}
                                    onChange={e => dispatch({
                                      type: 'UPDATE_TRACK_PERSON',
                                      payload: { trackIndex: index, personIndex, person: { ...person, npub: e.target.value } }
                                    })}
                                  />
                                </div>
                              </div>

                              {/* Roles */}
                              <div style={{ marginTop: '12px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                                  <label className="form-label" style={{ margin: 0 }}>Roles<InfoIcon text={FIELD_INFO.personRole} /></label>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '8px' }}>
                                  {person.roles.map((role, roleIndex) => (
                                    <div key={roleIndex} style={{
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
                                            type: 'UPDATE_TRACK_PERSON_ROLE',
                                            payload: { trackIndex: index, personIndex, roleIndex, role: { group: newGroup, role: newRole } }
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
                                          type: 'UPDATE_TRACK_PERSON_ROLE',
                                          payload: { trackIndex: index, personIndex, roleIndex, role: { ...role, role: e.target.value } }
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
                                            type: 'REMOVE_TRACK_PERSON_ROLE',
                                            payload: { trackIndex: index, personIndex, roleIndex }
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
                                    type: 'ADD_TRACK_PERSON_ROLE',
                                    payload: { trackIndex: index, personIndex, role: createEmptyPersonRole() }
                                  })}
                                >
                                  + Add Role
                                </button>
                              </div>
                            </div>
                            <div className="repeatable-item-actions">
                              <button
                                className="btn btn-icon btn-danger"
                                onClick={() => dispatch({ type: 'REMOVE_TRACK_PERSON', payload: { trackIndex: index, personIndex } })}
                              >
                                &#10005;
                              </button>
                            </div>
                          </div>
                        ))}
                        <button className="add-item-btn" onClick={() => dispatch({ type: 'ADD_TRACK_PERSON', payload: { trackIndex: index } })}>
                          + Add Person
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Track-specific Value Block */}
                  {track.overrideValue && !collapsedTracks[track.id] && (() => {
                    const trackRecipients = track.value?.recipients || [];
                    const trackUserRecipients = trackRecipients.filter(r => !isCommunitySupport(r));
                    const trackPlatformRecipients = trackRecipients.filter(r => isCommunitySupport(r));
                    const trackHasUserWithAddress = hasUserRecipients(trackRecipients);
                    return (
                    <div style={{ marginTop: '12px', padding: '12px', background: 'var(--bg-primary)', borderRadius: '8px' }}>
                      <h5 style={{ marginBottom: '12px', color: 'var(--text-secondary)' }}>Track Value Recipients</h5>
                      <div className="repeatable-list">
                        {trackUserRecipients.map((recipient) => {
                          const rIndex = trackRecipients.indexOf(recipient);
                          return (
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
                                      const newRecipients = [...trackRecipients];
                                      newRecipients[rIndex] = { ...recipient, name: e.target.value };
                                      dispatch({
                                        type: 'UPDATE_TRACK',
                                        payload: { index, track: { value: { ...track.value, type: 'lightning', method: 'keysend', recipients: newRecipients } } }
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
                                      const newRecipients = [...trackRecipients];
                                      newRecipients[rIndex] = { ...recipient, address, type: detectedType };
                                      dispatch({
                                        type: 'UPDATE_TRACK',
                                        payload: { index, track: { value: { ...track.value, type: 'lightning', method: 'keysend', recipients: newRecipients } } }
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
                                      const newRecipients = [...trackRecipients];
                                      newRecipients[rIndex] = { ...recipient, split: parseInt(e.target.value) || 0 };
                                      dispatch({
                                        type: 'UPDATE_TRACK',
                                        payload: { index, track: { value: { ...track.value, type: 'lightning', method: 'keysend', recipients: newRecipients } } }
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
                                  const newRecipients = [...trackRecipients];
                                  newRecipients.splice(rIndex, 1);
                                  dispatch({
                                    type: 'UPDATE_TRACK',
                                    payload: { index, track: { value: { ...track.value, type: 'lightning', method: 'keysend', recipients: newRecipients } } }
                                  });
                                }}
                              >
                                &#10005;
                              </button>
                            </div>
                          </div>
                          );
                        })}
                        <AddRecipientSelect onAdd={recipient => {
                          const newRecipients = [...trackRecipients, recipient];
                          dispatch({ type: 'UPDATE_TRACK', payload: { index, track: { value: { ...track.value, type: 'lightning', method: 'keysend', recipients: newRecipients } } } });
                        }} />
                        {trackPlatformRecipients.length === 0 && trackHasUserWithAddress && (
                          <div style={{
                            borderTop: '1px solid var(--border-color)',
                            marginTop: '16px',
                            paddingTop: '16px',
                            textAlign: 'center'
                          }}>
                            <div style={{
                              fontSize: '13px',
                              color: 'var(--text-secondary)',
                              marginBottom: '8px',
                              lineHeight: 1.4
                            }}>
                              Support the Podcasting 2.0 ecosystem? Add small splits for MSP 2.0 and Podcast Index.
                            </div>
                            <button
                              className="btn btn-secondary"
                              style={{ fontSize: '13px' }}
                              onClick={() => {
                                const newRecipients = [...trackRecipients, ...createSupportRecipients()];
                                dispatch({ type: 'UPDATE_TRACK', payload: { index, track: { value: { ...track.value, type: 'lightning', method: 'keysend', recipients: newRecipients } } } });
                              }}
                            >
                              Add Community Support
                            </button>
                          </div>
                        )}
                        {trackPlatformRecipients.length > 0 && (
                          <div style={{
                            borderTop: '1px solid var(--border-color)',
                            marginTop: '16px',
                            paddingTop: '16px',
                            opacity: 0.8
                          }}>
                            <div style={{
                              fontSize: '12px',
                              color: 'var(--text-secondary)',
                              marginBottom: '4px',
                              textTransform: 'uppercase',
                              letterSpacing: '0.5px'
                            }}>
                              Community Support <span style={{ textTransform: 'none', opacity: 0.7 }}>(optional)</span>
                            </div>
                            <div style={{
                              fontSize: '13px',
                              color: 'var(--text-secondary)',
                              marginBottom: '12px',
                              lineHeight: 1.4
                            }}>
                              Help sustain the Podcasting 2.0 ecosystem. These splits support MSP 2.0 and Podcast Index. Click the red X to remove.
                            </div>
                            {trackPlatformRecipients.map((recipient) => {
                              const rIndex = trackRecipients.indexOf(recipient);
                              return (
                              <div key={rIndex} className="repeatable-item">
                                <div className="repeatable-item-content">
                                  <div className="form-grid">
                                    <div className="form-group">
                                      <label className="form-label">Name</label>
                                      <input
                                        type="text"
                                        className="form-input"
                                        value={recipient.name || ''}
                                        readOnly
                                        style={{ opacity: 0.7, cursor: 'default' }}
                                      />
                                    </div>
                                    <div className="form-group">
                                      <label className="form-label">Address</label>
                                      <input
                                        type="text"
                                        className="form-input"
                                        value={recipient.address || ''}
                                        readOnly
                                        style={{ opacity: 0.7, cursor: 'default' }}
                                      />
                                    </div>
                                    <div className="form-group">
                                      <label className="form-label">Split %<InfoIcon text={FIELD_INFO.recipientSplit} /></label>
                                      <input
                                        type="number"
                                        className="form-input"
                                        placeholder="0"
                                        min="0"
                                        max="100"
                                        value={recipient.split || ''}
                                        onChange={e => {
                                          const newRecipients = [...trackRecipients];
                                          newRecipients[rIndex] = { ...recipient, split: parseInt(e.target.value) || 0 };
                                          dispatch({
                                            type: 'UPDATE_TRACK',
                                            payload: { index, track: { value: { ...track.value, type: 'lightning', method: 'keysend', recipients: newRecipients } } }
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
                                      const newRecipients = [...trackRecipients];
                                      newRecipients.splice(rIndex, 1);
                                      dispatch({
                                        type: 'UPDATE_TRACK',
                                        payload: { index, track: { value: { ...track.value, type: 'lightning', method: 'keysend', recipients: newRecipients } } }
                                      });
                                    }}
                                  >
                                    &#10005;
                                  </button>
                                </div>
                              </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                    );
                  })()}
                </div>
              ))}
              <button className="add-item-btn" onClick={() => {
                dispatch({ type: 'ADD_TRACK', payload: createEmptyTrack(album.tracks.length + 1, isVideo ? 'video/mp4' : 'audio/mpeg') });
              }}>
                + Add {isVideo ? 'Video' : 'Track'}
              </button>
            </div>
          </Section>
        </div>
      </div>
      <RolesModal isOpen={showRolesModal} onClose={() => setShowRolesModal(false)} />
    </>
  );
}
