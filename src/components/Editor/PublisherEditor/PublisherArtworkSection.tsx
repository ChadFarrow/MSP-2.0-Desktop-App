import type { PublisherFeed } from '../../../types/feed';
import type { FeedAction } from '../../../store/feedStore';
import { Section } from '../../Section';
import { ArtworkFields } from '../../ArtworkFields';

interface PublisherArtworkSectionProps {
  publisherFeed: PublisherFeed;
  dispatch: React.Dispatch<FeedAction>;
}

export function PublisherArtworkSection({ publisherFeed, dispatch }: PublisherArtworkSectionProps) {
  return (
    <Section title="Publisher Artwork" icon="&#127912;">
      <ArtworkFields
        imageUrl={publisherFeed.imageUrl}
        imageTitle={publisherFeed.imageTitle}
        imageDescription={publisherFeed.imageDescription}
        onUpdate={(field, value) => dispatch({ type: 'UPDATE_PUBLISHER_FEED', payload: { [field]: value } })}
        urlLabel="Logo URL"
        urlPlaceholder="https://example.com/logo.jpg"
        titlePlaceholder="Publisher logo description"
        previewAlt="Publisher logo preview"
      />
    </Section>
  );
}
