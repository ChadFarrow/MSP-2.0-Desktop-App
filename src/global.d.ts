// Global type declarations

// Tauri internals
declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export {};
