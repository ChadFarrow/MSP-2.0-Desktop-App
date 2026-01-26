import { render, type RenderOptions } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';

// Simple wrapper that provides common test setup
function TestWrapper({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

function customRender(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) {
  return render(ui, { wrapper: TestWrapper, ...options });
}

// Re-export everything from testing-library
export * from '@testing-library/react';
export { customRender as render };

// Helper to simulate touch events
export function createTouchEvent(type: string, target: Element) {
  const touch = {
    identifier: 0,
    target,
    clientX: 0,
    clientY: 0,
    pageX: 0,
    pageY: 0,
    screenX: 0,
    screenY: 0,
    radiusX: 0,
    radiusY: 0,
    rotationAngle: 0,
    force: 0,
  };

  return new TouchEvent(type, {
    bubbles: true,
    cancelable: true,
    touches: type === 'touchend' ? [] : [touch as Touch],
    targetTouches: type === 'touchend' ? [] : [touch as Touch],
    changedTouches: [touch as Touch],
  });
}

// Helper to mock viewport width for matchMedia
export function mockViewport(width: number) {
  Object.defineProperty(window, 'innerWidth', {
    writable: true,
    configurable: true,
    value: width,
  });

  window.matchMedia = vi.fn().mockImplementation((query: string) => {
    // Parse common media queries
    const minWidthMatch = query.match(/min-width:\s*(\d+)px/);
    const maxWidthMatch = query.match(/max-width:\s*(\d+)px/);

    let matches = false;
    if (minWidthMatch) {
      matches = width >= parseInt(minWidthMatch[1], 10);
    } else if (maxWidthMatch) {
      matches = width <= parseInt(maxWidthMatch[1], 10);
    }

    return {
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    };
  });
}
