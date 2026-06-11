import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

interface ModalWrapperProps {
  isOpen: boolean;
  onClose: () => void;
  title: string | ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function ModalWrapper({
  isOpen,
  onClose,
  title,
  footer,
  children,
  className = '',
  style = {}
}: ModalWrapperProps) {
  const modalRef = useRef<HTMLDivElement>(null);

  // Handle Escape key and trap Tab focus inside the modal
  useEffect(() => {
    if (!isOpen) return;

    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }

      if (e.key === 'Tab' && modalRef.current) {
        const focusable = modalRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;

        if (e.shiftKey) {
          if (active === first || !modalRef.current.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else if (active === last || !modalRef.current.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeydown);
    return () => document.removeEventListener('keydown', handleKeydown);
  }, [isOpen, onClose]);

  // Move focus into the modal when it opens
  useEffect(() => {
    if (isOpen) {
      modalRef.current?.focus();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose} style={style}>
      <div
        ref={modalRef}
        className={`modal ${className}`}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
      >
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="btn btn-icon" onClick={onClose} aria-label="Close">&#10005;</button>
        </div>
        <div className="modal-content">
          {children}
        </div>
        {footer && (
          <div className="modal-footer">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
