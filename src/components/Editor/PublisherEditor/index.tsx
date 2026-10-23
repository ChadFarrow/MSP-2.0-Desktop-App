import { useFeed } from '../../../store/feedStore';
import { PublisherInfoSection } from './PublisherInfoSection';
import { PublisherArtworkSection } from './PublisherArtworkSection';
import { CatalogFeedsSection } from './CatalogFeedsSection';
import { PublisherValueSection } from './PublisherValueSection';
import { PublisherFundingSection } from './PublisherFundingSection';
import { PublisherFeedReminderSection } from './PublisherFeedReminderSection';
import { DownloadCatalogSection } from './DownloadCatalogSection';
import { PublishSection } from './PublishSection';
import { shouldShowPublishSection } from '../../../utils/publisherPublish';
import { FeedCheckPanel } from '../../FeedCheckPanel';
import { useLinkBackStatus } from './useLinkBackStatus';

export function PublisherEditor() {
  const { state, dispatch } = useFeed();
  const { publisherFeed, publisherFeedInstance } = state;
  // Before the early return below: hooks must run on every render.
  const linkBack = useLinkBackStatus(publisherFeed, publisherFeedInstance);

  if (!publisherFeed) {
    return (
      <div className="main-content">
        <div className="editor-panel">
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>
            No publisher feed loaded. Create a new publisher feed or import an existing one.
          </div>
        </div>
      </div>
    );
  }

  // Show PublishSection whenever the catalog has an MSP-hosted album: it writes the
  // link back into those, and skips the rest. It used to need every album on MSP,
  // so one Wavlake or self-hosted album hid it and no MSP album got its link.
  const showPublishSection = shouldShowPublishSection(publisherFeed.remoteItems);

  return (
    <div className="main-content">
      <div className="editor-panel">
        <FeedCheckPanel />
        <PublisherInfoSection publisherFeed={publisherFeed} dispatch={dispatch} />
        <PublisherArtworkSection publisherFeed={publisherFeed} dispatch={dispatch} />
        <CatalogFeedsSection publisherFeed={publisherFeed} dispatch={dispatch} linkBack={linkBack} />
        <PublisherValueSection publisherFeed={publisherFeed} dispatch={dispatch} />
        <PublisherFundingSection publisherFeed={publisherFeed} dispatch={dispatch} />
        <PublisherFeedReminderSection publisherFeed={publisherFeed} feedInstance={publisherFeedInstance} />
        <DownloadCatalogSection publisherFeed={publisherFeed} feedInstance={publisherFeedInstance} linkBack={linkBack} />
        {showPublishSection && <PublishSection publisherFeed={publisherFeed} linkBack={linkBack} />}
      </div>
    </div>
  );
}
