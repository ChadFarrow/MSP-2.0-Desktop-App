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

  return (
    <ExperimentalContext.Provider value={{ showExperimental, toggleExperimental, setShowExperimental }}>
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
