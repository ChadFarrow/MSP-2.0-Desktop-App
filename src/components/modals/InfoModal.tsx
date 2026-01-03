import { useState, useEffect } from 'react';
import Markdown from 'react-markdown';

interface InfoModalProps {
  onClose: () => void;
}

export function InfoModal({ onClose }: InfoModalProps) {
  const [content, setContent] = useState('Loading...');

  useEffect(() => {
    fetch('/info.md')
      .then(res => res.text())
      .then(setContent)
      .catch(() => setContent('Failed to load content'));
  }, []);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal info-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>About Music Side Project</h2>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-content info-content">
          <Markdown>{content}</Markdown>
        </div>
        <div className="modal-footer">
          <button className="btn btn-primary" onClick={onClose}>
            Got it!
          </button>
        </div>
      </div>
    </div>
  );
}
