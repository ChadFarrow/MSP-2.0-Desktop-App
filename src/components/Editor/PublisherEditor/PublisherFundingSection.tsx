import type { PublisherFeed } from '../../../types/feed';
import type { FeedAction } from '../../../store/feedStore';
import { Section } from '../../Section';
import { FundingFields } from '../../FundingFields';

interface PublisherFundingSectionProps {
  publisherFeed: PublisherFeed;
  dispatch: React.Dispatch<FeedAction>;
}

export function PublisherFundingSection({ publisherFeed, dispatch }: PublisherFundingSectionProps) {
  return (
    <Section title="Funding" icon="&#128176;">
      <FundingFields
        funding={publisherFeed.funding}
        onUpdate={funding => dispatch({ type: 'UPDATE_PUBLISHER_FEED', payload: { funding } })}
        placeholderUrl="https://patreon.com/yourlabel"
        placeholderText="Support the label!"
      />
    </Section>
  );
}
