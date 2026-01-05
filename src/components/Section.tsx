import { useState } from 'react';
import type { ReactNode } from 'react';

export function Section({ title, icon, children, defaultOpen = true }: {
  title: string;
  icon: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="section">
      <div className="section-header" onClick={() => setIsOpen(!isOpen)}>
        <h2><span className="icon">{icon}</span> {title}</h2>
        <span className={`section-toggle ${isOpen ? 'expanded' : ''}`}>&#9660;</span>
      </div>
      <div className={`section-content ${isOpen ? '' : 'collapsed'}`}>
        {children}
      </div>
    </div>
  );
}
