import { useFeed } from '../../store/feedStore';
import { useNostr } from '../../store/nostrStore';
import { LANGUAGES, isVideoMedium } from '../../types/feed';
import { FIELD_INFO } from '../../data/fieldInfo';
import { InfoIcon } from '../InfoIcon';
import { Section } from '../Section';
import { Toggle } from '../Toggle';
import { RecipientsList } from '../RecipientsList';
import { FundingFields } from '../FundingFields';
import { ArtworkFields } from '../ArtworkFields';
import { CreditsSection } from './CreditsSection';
import { PublisherLookupSection } from './PublisherLookupSection';
import { TracksSection } from './TracksSection';

export function Editor() {
  const { state, dispatch } = useFeed();
  const { state: nostrState } = useNostr();
  // Get the active album based on feedType (album or videoFeed)
  const album = state.feedType === 'video' && state.videoFeed ? state.videoFeed : state.album;

  // Determine if this is a video feed
  const isVideo = isVideoMedium(album.medium);

  return (
    <div className="main-content">
      <div className="editor-panel">
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
            <div className="form-group" style={{ display: 'flex', alignItems: 'center', paddingTop: '28px', marginLeft: '-20px' }}>
              <Toggle
                checked={album.explicit}
                onChange={val => dispatch({ type: 'UPDATE_ALBUM', payload: { explicit: val } })}
                label="Explicit Content"
                labelSuffix={<InfoIcon text={FIELD_INFO.explicit} />}
              />
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
        </Section>

        {/* Credits Section */}
        <CreditsSection persons={album.persons} dispatch={dispatch} />

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
        <PublisherLookupSection publisher={album.publisher} dispatch={dispatch} />

        {/* Tracks/Videos Section */}
        <TracksSection tracks={album.tracks} isVideo={isVideo} dispatch={dispatch} />
      </div>
    </div>
  );
}
