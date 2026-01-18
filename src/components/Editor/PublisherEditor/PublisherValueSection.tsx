import type { PublisherFeed } from '../../../types/feed';
import type { FeedAction } from '../../../store/feedStore';
import { Section } from '../../Section';
import { RecipientsList } from '../../RecipientsList';

interface PublisherValueSectionProps {
  publisherFeed: PublisherFeed;
  dispatch: React.Dispatch<FeedAction>;
}

export function PublisherValueSection({ publisherFeed, dispatch }: PublisherValueSectionProps) {
  return (
    <Section title="Value Block (Lightning)" icon="&#9889;">
      <RecipientsList
        recipients={publisherFeed.value.recipients}
        onUpdate={(index, recipient) => dispatch({
          type: 'UPDATE_PUBLISHER_RECIPIENT',
          payload: { index, recipient }
        })}
        onRemove={index => dispatch({ type: 'REMOVE_PUBLISHER_RECIPIENT', payload: index })}
        onAdd={recipient => dispatch({ type: 'ADD_PUBLISHER_RECIPIENT', payload: recipient })}
      />
    </Section>
  );
}
