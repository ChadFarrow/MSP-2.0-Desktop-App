import type { FeedType } from '../../store/feedStore';
import { ModalWrapper } from './ModalWrapper';

interface NewFeedChoiceModalProps {
  isOpen: boolean;
  feedType: FeedType;
  onStartBlank: () => void;
  onUseTemplate: () => void;
  onCancel: () => void;
}

const feedTypeLabel = (feedType: FeedType) =>
  feedType === 'publisher' ? 'Publisher Feed' : feedType === 'video' ? 'Video Feed' : 'Album';

export function NewFeedChoiceModal({
  isOpen,
  feedType,
  onStartBlank,
  onUseTemplate,
  onCancel,
}: NewFeedChoiceModalProps) {
  const label = feedTypeLabel(feedType);

  return (
    <ModalWrapper
      isOpen={isOpen}
      onClose={onCancel}
      title={`New ${label}`}
      footer={
        <div style={{ display: 'flex', gap: '12px', width: '100%' }}>
          <button className="btn btn-warning" onClick={onStartBlank}>
            Start Blank
          </button>
          <button className="btn btn-primary" onClick={onUseTemplate}>
            Use Template
          </button>
          <div style={{ flex: 1 }} />
          <button className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
        </div>
      }
    >
      <p style={{ color: 'var(--text-secondary)', margin: 0 }}>
        Start with an empty {label.toLowerCase()}, or import an existing feed as a template
        (keeps all content but assigns a new GUID).
      </p>
    </ModalWrapper>
  );
}
