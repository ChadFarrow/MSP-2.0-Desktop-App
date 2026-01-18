import { useState, useEffect } from 'react';
import Markdown from 'react-markdown';
import { ModalWrapper } from './ModalWrapper';

interface InfoModalProps {
  onClose: () => void;
}

export function InfoModal({ onClose }: InfoModalProps) {
  const [content, setContent] = useState('Loading...');

  useEffect(() => {
    const loadContent = async () => {
      try {
        const res = await fetch('/info.md');
        const text = await res.text();
        setContent(text);
      } catch {
        setContent('Failed to load content');
      }
    };
    loadContent();
  }, []);

  return (
    <ModalWrapper
      isOpen={true}
      onClose={onClose}
      title="About Music Side Project 2.0"
      className="info-modal"
      footer={
        <button className="btn btn-primary" onClick={onClose}>
          Got it!
        </button>
      }
    >
      <div className="info-content">
        <Markdown>{content}</Markdown>
      </div>
    </ModalWrapper>
  );
}
