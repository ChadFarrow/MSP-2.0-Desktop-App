import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

interface InfoIconProps {
  text: string;
}

const MOBILE_QUERY = '(max-width: 768px)';

export function InfoIcon({ text }: InfoIconProps) {
  const [show, setShow] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [side, setSide] = useState<'left' | 'right'>('right');
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' && window.matchMedia(MOBILE_QUERY).matches
  );
  const wrapperRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia(MOBILE_QUERY);
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  // Auto-detect tooltip side when shown
  useEffect(() => {
    if (!show || !wrapperRef.current) return;
    const rect = wrapperRef.current.getBoundingClientRect();
    setSide(rect.right + 300 > window.innerWidth ? 'left' : 'right');
  }, [show]);

  // Close when clicking outside
  useEffect(() => {
    if (!pinned) return;

    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (wrapperRef.current && wrapperRef.current.contains(target)) return;
      // Also ignore clicks on the portaled tooltip itself — it handles its own close.
      const tooltipEl = document.querySelector('.info-tooltip');
      if (tooltipEl && tooltipEl.contains(target)) return;
      setPinned(false);
      setShow(false);
    };

    // Small delay to avoid the same click that opened it
    const timer = setTimeout(() => {
      document.addEventListener('click', handleClickOutside);
      document.addEventListener('touchend', handleClickOutside);
    }, 100);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', handleClickOutside);
      document.removeEventListener('touchend', handleClickOutside);
    };
  }, [pinned]);

  const handleClick = (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    e.preventDefault();

    if (pinned) {
      // Close if already pinned
      setPinned(false);
      setShow(false);
    } else {
      // Pin it open
      setPinned(true);
      setShow(true);
    }
  };

  const handleMouseEnter = () => {
    if (!pinned) {
      setShow(true);
    }
  };

  const handleMouseLeave = () => {
    if (!pinned) {
      setShow(false);
    }
  };

  const handleClose = (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    setPinned(false);
    setShow(false);
  };

  const tooltip = show ? (
    <div
      className={`info-tooltip${side === 'left' ? ' info-tooltip-left' : ''}`}
      onClick={handleClose}
      onTouchEnd={handleClose}
    >
      {text}
      <span className="info-tooltip-close">tap to close</span>
    </div>
  ) : null;

  return (
    <span className="info-icon-wrapper" ref={wrapperRef}>
      <span
        className={`info-icon${pinned ? ' info-icon-active' : ''}`}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
        onTouchEnd={handleClick}
      >
        i
      </span>
      {/* On mobile the tooltip uses position: fixed to pin to the viewport.
          Ancestors that establish a containing block (e.g. .section's
          backdrop-filter) would otherwise trap it, so portal it to <body>. */}
      {isMobile ? tooltip && createPortal(tooltip, document.body) : tooltip}
    </span>
  );
}
