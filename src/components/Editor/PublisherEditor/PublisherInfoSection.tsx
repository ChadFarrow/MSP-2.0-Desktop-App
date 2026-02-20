import type { PublisherFeed } from '../../../types/feed';
import { LANGUAGES } from '../../../types/feed';
import type { FeedAction } from '../../../store/feedStore';
import { FIELD_INFO } from '../../../data/fieldInfo';
import { InfoIcon } from '../../InfoIcon';
import { Section } from '../../Section';
import { Toggle } from '../../Toggle';

interface PublisherInfoSectionProps {
  publisherFeed: PublisherFeed;
  dispatch: React.Dispatch<FeedAction>;
}

export function PublisherInfoSection({ publisherFeed, dispatch }: PublisherInfoSectionProps) {
  return (
    <Section title="Publisher Info" icon="&#127970;">
      <div className="form-grid">
        <div className="form-group">
          <label className="form-label">Artist Name <span className="required">*</span><InfoIcon text={FIELD_INFO.publisherName} /></label>
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
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="text"
              className="form-input"
              placeholder="Auto-generated UUID"
              value={publisherFeed.podcastGuid || ''}
              onChange={e => dispatch({ type: 'UPDATE_PUBLISHER_FEED', payload: { podcastGuid: e.target.value } })}
              style={{ flex: 1 }}
            />
            <button
              type="button"
              className="btn btn-secondary btn-small"
              title="Generate new GUID"
              onClick={() => {
                if (confirm('Generate a new GUID? This will create a new feed identity. Only do this if you are using this feed as a template for a new publisher feed.')) {
                  dispatch({ type: 'UPDATE_PUBLISHER_FEED', payload: { podcastGuid: crypto.randomUUID() } });
                }
              }}
            >
              New
            </button>
          </div>
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
  );
}
