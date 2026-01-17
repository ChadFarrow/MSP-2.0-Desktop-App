import type { PublisherFeed } from '../../../types/feed';
import type { FeedAction } from '../../../store/feedStore';
import { FIELD_INFO } from '../../../data/fieldInfo';
import { InfoIcon } from '../../InfoIcon';
import { Section } from '../../Section';

interface PublisherArtworkSectionProps {
  publisherFeed: PublisherFeed;
  dispatch: React.Dispatch<FeedAction>;
}

export function PublisherArtworkSection({ publisherFeed, dispatch }: PublisherArtworkSectionProps) {
  return (
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
  );
}
