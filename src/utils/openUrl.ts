// Open URL in system browser (Tauri) or new tab (web)
export async function openUrl(url: string): Promise<void> {
  // Check if running in Tauri
  if (window.__TAURI_INTERNALS__) {
    const { open } = await import('@tauri-apps/plugin-shell');
    await open(url);
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}
