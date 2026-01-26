/**
 * Blossom Upload Component
 * 
 * Allows users to upload feeds and files to a Blossom server.
 * Requires Nostr login.
 */

import { useState, useEffect } from 'react';
import {
  blossomUpload,
  blossomList,
  blossomDelete,
  DEFAULT_BLOSSOM_SERVERS,
  checkBlossomServer,
  type BlossomBlob,
} from '../utils/tauriBlossom';
import { isTauri } from '../utils/tauriNostr';
import { extractErrorMessage } from '../utils/errorHandling';
import { formatBytes } from '../utils/formatting';

interface BlossomManagerProps {
  feedXml?: string;
  feedTitle?: string;
  onUploadComplete?: (url: string, sha256: string) => void;
}

export function BlossomManager({ feedXml, feedTitle, onUploadComplete }: BlossomManagerProps) {
  const [serverUrl, setServerUrl] = useState(DEFAULT_BLOSSOM_SERVERS[0]);
  const [customServer, setCustomServer] = useState('');
  const [useCustom, setUseCustom] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [blobs, setBlobs] = useState<BlossomBlob[]>([]);
  const [loadingBlobs, setLoadingBlobs] = useState(false);
  const [serverOnline, setServerOnline] = useState<boolean | null>(null);

  const activeServer = useCustom ? customServer : serverUrl;

  // Check server status when it changes
  useEffect(() => {
    if (!activeServer) {
      setServerOnline(null);
      return;
    }

    setServerOnline(null);
    checkBlossomServer(activeServer).then(setServerOnline);
  }, [activeServer]);

  const handleUpload = async () => {
    if (!feedXml) {
      setError('No feed content to upload');
      return;
    }

    if (!activeServer) {
      setError('Please select or enter a Blossom server');
      return;
    }

    setUploading(true);
    setError(null);
    setSuccess(null);

    try {
      const result = await blossomUpload(activeServer, feedXml, 'application/xml');
      setSuccess(`Uploaded! URL: ${result.url}`);
      onUploadComplete?.(result.url, result.sha256);
      
      // Refresh blob list
      loadBlobs();
    } catch (e) {
      setError(extractErrorMessage(e, 'Upload failed'));
    } finally {
      setUploading(false);
    }
  };

  const loadBlobs = async () => {
    if (!activeServer) return;

    setLoadingBlobs(true);
    try {
      const list = await blossomList(activeServer);
      setBlobs(list);
    } catch (e) {
      console.error('Failed to load blobs:', e);
    } finally {
      setLoadingBlobs(false);
    }
  };

  const handleDelete = async (sha256: string) => {
    if (!confirm('Delete this file from the Blossom server?')) return;

    try {
      await blossomDelete(activeServer, sha256);
      setBlobs(blobs.filter(b => b.sha256 !== sha256));
    } catch (e) {
      setError(extractErrorMessage(e, 'Delete failed'));
    }
  };

  const copyUrl = (sha256: string) => {
    const url = `${activeServer.replace(/\/$/, '')}/${sha256}`;
    navigator.clipboard.writeText(url);
  };

  // Don't render in web mode
  if (!isTauri()) {
    return null;
  }

  return (
    <div className="blossom-manager">
      <h3>🌸 Blossom Upload</h3>

      <div className="blossom-server-select">
        <label>
          <input
            type="radio"
            checked={!useCustom}
            onChange={() => setUseCustom(false)}
          />
          Popular servers
        </label>
        
        {!useCustom && (
          <select
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
          >
            {DEFAULT_BLOSSOM_SERVERS.map((server: string) => (
              <option key={server} value={server}>{server}</option>
            ))}
          </select>
        )}

        <label>
          <input
            type="radio"
            checked={useCustom}
            onChange={() => setUseCustom(true)}
          />
          Custom server
        </label>

        {useCustom && (
          <input
            type="url"
            placeholder="https://your-blossom-server.com"
            value={customServer}
            onChange={(e) => setCustomServer(e.target.value)}
          />
        )}

        {serverOnline !== null && (
          <span className={`server-status ${serverOnline ? 'online' : 'offline'}`}>
            {serverOnline ? '● Online' : '● Offline'}
          </span>
        )}
      </div>

      {error && <div className="blossom-error">{error}</div>}
      {success && <div className="blossom-success">{success}</div>}

      <div className="blossom-actions">
        <button
          onClick={handleUpload}
          disabled={uploading || !feedXml || !activeServer}
          className="upload-btn"
        >
          {uploading ? 'Uploading...' : `Upload ${feedTitle || 'Feed'}`}
        </button>

        <button
          onClick={loadBlobs}
          disabled={loadingBlobs || !activeServer}
          className="list-btn"
        >
          {loadingBlobs ? 'Loading...' : 'My Uploads'}
        </button>
      </div>

      {blobs.length > 0 && (
        <div className="blossom-blobs">
          <h4>Your Uploads</h4>
          <ul>
            {blobs.map(blob => (
              <li key={blob.sha256}>
                <span className="blob-hash" title={blob.sha256}>
                  {blob.sha256.slice(0, 12)}...
                </span>
                <span className="blob-size">
                  {formatBytes(blob.size)}
                </span>
                {blob.type && <span className="blob-type">{blob.type}</span>}
                <button onClick={() => copyUrl(blob.sha256)} title="Copy URL">📋</button>
                <button onClick={() => handleDelete(blob.sha256)} title="Delete">🗑️</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="blossom-info">
        Blossom stores files addressed by their SHA256 hash. 
        Files are publicly accessible but only you can delete them.
      </p>
    </div>
  );
}

// CSS styles
export const blossomStyles = `
.blossom-manager {
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 1rem;
  margin: 1rem 0;
  background: #fdf9ff;
}

.blossom-manager h3 {
  margin: 0 0 1rem 0;
  font-size: 1rem;
}

.blossom-server-select {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.blossom-server-select label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
}

.blossom-server-select select,
.blossom-server-select input[type="url"] {
  padding: 0.5rem;
  border: 1px solid #ccc;
  border-radius: 4px;
  margin-left: 1.5rem;
  width: calc(100% - 1.5rem);
}

.server-status {
  font-size: 0.8rem;
  margin-left: 1.5rem;
}

.server-status.online {
  color: #27ae60;
}

.server-status.offline {
  color: #e74c3c;
}

.blossom-error {
  color: #e74c3c;
  background: #fdeaea;
  padding: 0.5rem;
  border-radius: 4px;
  margin-bottom: 0.5rem;
  font-size: 0.85rem;
}

.blossom-success {
  color: #27ae60;
  background: #eafde8;
  padding: 0.5rem;
  border-radius: 4px;
  margin-bottom: 0.5rem;
  font-size: 0.85rem;
  word-break: break-all;
}

.blossom-actions {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.blossom-actions button {
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.blossom-actions .upload-btn {
  background: #9b59b6;
  color: white;
}

.blossom-actions .upload-btn:hover:not(:disabled) {
  background: #8e44ad;
}

.blossom-actions .list-btn {
  background: #e0e0e0;
}

.blossom-actions .list-btn:hover:not(:disabled) {
  background: #d0d0d0;
}

.blossom-actions button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.blossom-blobs {
  border-top: 1px solid #e0e0e0;
  padding-top: 0.75rem;
  margin-bottom: 1rem;
}

.blossom-blobs h4 {
  margin: 0 0 0.5rem 0;
  font-size: 0.9rem;
}

.blossom-blobs ul {
  list-style: none;
  padding: 0;
  margin: 0;
}

.blossom-blobs li {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.25rem 0;
  font-size: 0.85rem;
}

.blob-hash {
  font-family: monospace;
  color: #666;
}

.blob-size {
  color: #888;
}

.blob-type {
  background: #eee;
  padding: 0.1rem 0.3rem;
  border-radius: 3px;
  font-size: 0.75rem;
}

.blossom-blobs button {
  background: none;
  border: none;
  cursor: pointer;
  padding: 0.25rem;
  font-size: 0.9rem;
}

.blossom-info {
  font-size: 0.75rem;
  color: #888;
  margin: 0;
}
`;
