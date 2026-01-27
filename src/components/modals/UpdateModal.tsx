import { useState } from 'react';
import Markdown from 'react-markdown';
import { ModalWrapper } from './ModalWrapper';
import { downloadAndInstallUpdate } from '../../utils/updater';
import type { UpdateInfo, UpdateProgress } from '../../utils/updater';

interface UpdateModalProps {
  updateInfo: UpdateInfo;
  onClose: () => void;
}

export function UpdateModal({ updateInfo, onClose }: UpdateModalProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleUpdate = async () => {
    setIsDownloading(true);
    setError(null);

    try {
      await downloadAndInstallUpdate((prog) => {
        setProgress(prog);
      });
      // App will relaunch automatically after update
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to install update');
      setIsDownloading(false);
    }
  };

  const getProgressPercent = (): number => {
    if (!progress) return 0;
    if (!progress.total) return 0;
    return Math.round((progress.downloaded / progress.total) * 100);
  };

  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <ModalWrapper
      isOpen={true}
      onClose={isDownloading ? () => {} : onClose}
      title="Update Available"
      className="update-modal"
      footer={
        <div className="update-modal-footer">
          {error && <div className="update-error">{error}</div>}
          <div className="update-modal-buttons">
            <button
              className="btn btn-secondary"
              onClick={onClose}
              disabled={isDownloading}
            >
              Later
            </button>
            <button
              className="btn btn-primary"
              onClick={handleUpdate}
              disabled={isDownloading}
            >
              {isDownloading ? 'Updating...' : 'Update Now'}
            </button>
          </div>
        </div>
      }
    >
      <div className="update-modal-content">
        <div className="update-version-info">
          <span className="update-version-current">v{updateInfo.currentVersion}</span>
          <span className="update-version-arrow">-&gt;</span>
          <span className="update-version-new">v{updateInfo.version}</span>
        </div>

        {isDownloading && progress && (
          <div className="update-progress">
            <div className="update-progress-bar">
              <div
                className="update-progress-fill"
                style={{ width: `${getProgressPercent()}%` }}
              />
            </div>
            <div className="update-progress-text">
              {progress.total
                ? `${formatBytes(progress.downloaded)} / ${formatBytes(progress.total)} (${getProgressPercent()}%)`
                : `${formatBytes(progress.downloaded)} downloaded`}
            </div>
          </div>
        )}

        {updateInfo.body && (
          <div className="update-release-notes">
            <h4>Release Notes</h4>
            <div className="update-release-notes-content">
              <Markdown>{updateInfo.body}</Markdown>
            </div>
          </div>
        )}
      </div>
    </ModalWrapper>
  );
}
