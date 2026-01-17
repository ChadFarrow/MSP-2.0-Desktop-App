import type { PublisherFeed } from '../../../types/feed';
import type { FeedAction } from '../../../store/feedStore';
import { FIELD_INFO } from '../../../data/fieldInfo';
import { InfoIcon } from '../../InfoIcon';
import { Section } from '../../Section';

interface PublisherFundingSectionProps {
  publisherFeed: PublisherFeed;
  dispatch: React.Dispatch<FeedAction>;
}

export function PublisherFundingSection({ publisherFeed, dispatch }: PublisherFundingSectionProps) {
  return (
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
  );
}
