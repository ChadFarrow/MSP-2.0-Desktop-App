import { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';

interface ExperimentalContextType {
  showExperimental: boolean;
  toggleExperimental: () => void;
  setShowExperimental: (value: boolean) => void;
}

const ExperimentalContext = createContext<ExperimentalContextType | undefined>(undefined);

const STORAGE_KEY = 'msp-show-experimental';

export function ExperimentalProvider({ children }: { children: ReactNode }) {
  const [showExperimental, setShowExperimental] = useState<boolean>(() => {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, showExperimental ? 'true' : 'false');
  }, [showExperimental]);

  const toggleExperimental = () => {
    setShowExperimental(prev => !prev);
  };

  // Experimental features are only reachable in the local test environment.
  // import.meta.env.DEV is true only under `npm run dev` and statically false in
  // production builds, so the stored toggle can never expose them in production.
  const effectiveShowExperimental = import.meta.env.DEV && showExperimental;

  return (
    <ExperimentalContext.Provider value={{ showExperimental: effectiveShowExperimental, toggleExperimental, setShowExperimental }}>
      {children}
    </ExperimentalContext.Provider>
  );
}

export function useExperimental() {
  const context = useContext(ExperimentalContext);
  if (!context) {
    throw new Error('useExperimental must be used within ExperimentalProvider');
  }
  return context;
}
