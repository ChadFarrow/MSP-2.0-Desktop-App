import { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';

interface ExperimentalContextType {
  showExperimental: boolean;
  toggleExperimental: () => void;
  setShowExperimental: (value: boolean) => void;
  // Beta features: finished enough for users to opt in to on the main site,
  // unlike the experimental ones, which stay in local dev.
  showBeta: boolean;
  toggleBeta: () => void;
}

const ExperimentalContext = createContext<ExperimentalContextType | undefined>(undefined);

const STORAGE_KEY = 'msp-show-experimental';
const BETA_STORAGE_KEY = 'msp-show-beta';

export function ExperimentalProvider({ children }: { children: ReactNode }) {
  const [showExperimental, setShowExperimental] = useState<boolean>(() => {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  });
  const [showBeta, setShowBeta] = useState<boolean>(() => {
    return localStorage.getItem(BETA_STORAGE_KEY) === 'true';
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, showExperimental ? 'true' : 'false');
  }, [showExperimental]);

  useEffect(() => {
    localStorage.setItem(BETA_STORAGE_KEY, showBeta ? 'true' : 'false');
  }, [showBeta]);

  const toggleExperimental = () => {
    setShowExperimental(prev => !prev);
  };

  const toggleBeta = () => {
    setShowBeta(prev => !prev);
  };

  // Experimental features are only reachable in the local test environment.
  // import.meta.env.DEV is true only under `npm run dev` and statically false in
  // production builds, so the stored toggle can never expose them in production.
  // Beta features are not gated this way: production users turn them on.
  const effectiveShowExperimental = import.meta.env.DEV && showExperimental;

  return (
    <ExperimentalContext.Provider value={{ showExperimental: effectiveShowExperimental, toggleExperimental, setShowExperimental, showBeta, toggleBeta }}>
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
