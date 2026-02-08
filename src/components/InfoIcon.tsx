import { useState, useRef, useEffect } from 'react';

interface InfoIconProps {
  text: string;
  position?: 'right' | 'left';
}

export function InfoIcon({ text, position = 'right' }: InfoIconProps) {
  const [show, setShow] = useState(false);
  const [pinned, setPinned] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement>(null);

  // Close when clicking outside
  useEffect(() => {
    if (!pinned) return;

    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setPinned(false);
        setShow(false);
      }
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
      {show && (
        <div className={`info-tooltip${position === 'left' ? ' info-tooltip-left' : ''}`} onClick={handleClose} onTouchEnd={handleClose}>
          {text}
          <span className="info-tooltip-close">tap to close</span>
        </div>
      )}
    </span>
  );
}
