import { useState, useMemo } from 'react';
import { generateRssFeed, generatePublisherRssFeed, downloadXml, copyToClipboard } from '../../utils/xmlGenerator';
import type { Album, PublisherFeed } from '../../types/feed';
import type { FeedType } from '../../store/feedStore';
import { ModalWrapper } from './ModalWrapper';

// Simple XML syntax highlighter
function highlightXml(xml: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let key = 0;

  // Colors for syntax highlighting
  const colors = {
    tag: '#569cd6',        // Blue for tag names
    attribute: '#9cdcfe',  // Light blue for attribute names
    value: '#ce9178',      // Orange for attribute values
    bracket: '#808080',    // Gray for < > / =
    comment: '#6a9955',    // Green for comments
    text: '#d4d4d4',       // Light gray for text content
    declaration: '#569cd6' // Blue for XML declaration
  };

  // Process XML string character by character with state machine
  let i = 0;
  while (i < xml.length) {
    // Check for XML declaration <?xml ... ?>
    if (xml.startsWith('<?', i)) {
      const end = xml.indexOf('?>', i);
      if (end !== -1) {
        parts.push(<span key={key++} style={{ color: colors.declaration }}>{xml.slice(i, end + 2)}</span>);
        i = end + 2;
        continue;
      }
    }

    // Check for comments <!-- ... -->
    if (xml.startsWith('<!--', i)) {
      const end = xml.indexOf('-->', i);
      if (end !== -1) {
        parts.push(<span key={key++} style={{ color: colors.comment }}>{xml.slice(i, end + 3)}</span>);
        i = end + 3;
        continue;
      }
    }

    // Check for CDATA <![CDATA[ ... ]]>
    if (xml.startsWith('<![CDATA[', i)) {
      const end = xml.indexOf(']]>', i);
      if (end !== -1) {
        parts.push(<span key={key++} style={{ color: colors.text }}>{xml.slice(i, end + 3)}</span>);
        i = end + 3;
        continue;
      }
    }

    // Check for tags
    if (xml[i] === '<') {
      const tagEnd = xml.indexOf('>', i);
      if (tagEnd !== -1) {
        const tagContent = xml.slice(i, tagEnd + 1);
        const tagParts: React.ReactNode[] = [];
        let tagKey = 0;

        // Parse tag content
        const isClosing = tagContent.startsWith('</');
        const isSelfClosing = tagContent.endsWith('/>');

        // Opening bracket and optional slash
        if (isClosing) {
          tagParts.push(<span key={tagKey++} style={{ color: colors.bracket }}>{'</'}</span>);
        } else {
          tagParts.push(<span key={tagKey++} style={{ color: colors.bracket }}>{'<'}</span>);
        }

        // Extract tag name and attributes
        const innerContent = tagContent.slice(isClosing ? 2 : 1, isSelfClosing ? -2 : -1);
        const tagNameMatch = innerContent.match(/^[\w:.-]+/);

        if (tagNameMatch) {
          const tagName = tagNameMatch[0];
          tagParts.push(<span key={tagKey++} style={{ color: colors.tag }}>{tagName}</span>);

          // Parse attributes
          const attrString = innerContent.slice(tagName.length);
          const attrRegex = /([\w:.-]+)(=)("[^"]*"|'[^']*')/g;
          let lastIndex = 0;
          let match;

          while ((match = attrRegex.exec(attrString)) !== null) {
            // Add whitespace before attribute
            if (match.index > lastIndex) {
              tagParts.push(<span key={tagKey++}>{attrString.slice(lastIndex, match.index)}</span>);
            }
            // Attribute name
            tagParts.push(<span key={tagKey++} style={{ color: colors.attribute }}>{match[1]}</span>);
            // Equals sign
            tagParts.push(<span key={tagKey++} style={{ color: colors.bracket }}>{match[2]}</span>);
            // Attribute value
            tagParts.push(<span key={tagKey++} style={{ color: colors.value }}>{match[3]}</span>);
            lastIndex = match.index + match[0].length;
          }

          // Remaining content (whitespace, etc.)
          if (lastIndex < attrString.length) {
            tagParts.push(<span key={tagKey++}>{attrString.slice(lastIndex)}</span>);
          }
        }

        // Closing bracket
        if (isSelfClosing) {
          tagParts.push(<span key={tagKey++} style={{ color: colors.bracket }}>{'/>'}</span>);
        } else {
          tagParts.push(<span key={tagKey++} style={{ color: colors.bracket }}>{'>'}</span>);
        }

        parts.push(<span key={key++}>{tagParts}</span>);
        i = tagEnd + 1;
        continue;
      }
    }

    // Regular text content - collect until next tag
    let textEnd = xml.indexOf('<', i);
    if (textEnd === -1) textEnd = xml.length;
    if (textEnd > i) {
      parts.push(<span key={key++} style={{ color: colors.text }}>{xml.slice(i, textEnd)}</span>);
      i = textEnd;
    } else {
      parts.push(<span key={key++} style={{ color: colors.text }}>{xml[i]}</span>);
      i++;
    }
  }

  return parts;
}

interface PreviewModalProps {
  onClose: () => void;
  album: Album;
  publisherFeed?: PublisherFeed | null;
  feedType?: FeedType;
}

export function PreviewModal({ onClose, album, publisherFeed, feedType = 'album' }: PreviewModalProps) {
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const isPublisherMode = feedType === 'publisher';

  // Generate XML for current feed type
  const generateCurrentFeedXml = () => {
    if (isPublisherMode && publisherFeed) {
      return generatePublisherRssFeed(publisherFeed);
    }
    return generateRssFeed(album);
  };

  const xml = generateCurrentFeedXml();

  // Memoize highlighted XML for performance
  const highlightedXml = useMemo(() => highlightXml(xml), [xml]);

  const handleCopy = async () => {
    try {
      await copyToClipboard(xml);
      setMessage({ type: 'success', text: 'Copied to clipboard' });
      setTimeout(() => setMessage(null), 2000);
    } catch {
      setMessage({ type: 'error', text: 'Failed to copy' });
    }
  };

  const handleDownload = () => {
    const feedTitle = isPublisherMode && publisherFeed ? publisherFeed.title : album.title;
    const publisherName = isPublisherMode && publisherFeed?.author ? `${publisherFeed.author}_` : '';
    const filename = `${publisherName}${feedTitle || 'feed'}.xml`.replace(/[^a-z0-9.-]/gi, '_');
    downloadXml(xml, filename);
    setMessage({ type: 'success', text: 'Download started' });
    setTimeout(() => setMessage(null), 2000);
  };

  const feedTypeLabel = isPublisherMode ? 'Publisher Feed' : feedType === 'video' ? 'Video Feed' : 'Album';

  return (
    <ModalWrapper
      isOpen={true}
      onClose={onClose}
      title={`View ${feedTypeLabel} RSS`}
      className="preview-modal"
      footer={
        <>
          <button className="btn btn-secondary" onClick={handleCopy}>
            Copy to Clipboard
          </button>
          <button className="btn btn-secondary" onClick={handleDownload}>
            Download
          </button>
          <button className="btn btn-primary" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      <pre
        style={{
          backgroundColor: '#1e1e1e',
          padding: '16px',
          borderRadius: '8px',
          border: '1px solid var(--border-color)',
          overflow: 'auto',
          fontSize: '0.9rem',
          fontFamily: 'monospace',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          margin: 0
        }}
      >
        {highlightedXml}
      </pre>

      {message && (
        <div style={{
          color: message.type === 'error' ? 'var(--error)' : 'var(--success)',
          marginTop: '12px',
          fontSize: '0.875rem'
        }}>
          {message.text}
        </div>
      )}
    </ModalWrapper>
  );
}
