import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '../test/utils';
import { InfoIcon } from './InfoIcon';

describe('InfoIcon', () => {
  const tooltipText = 'This is helpful information';

  it('renders the info icon', () => {
    render(<InfoIcon text={tooltipText} />);
    expect(screen.getByText('i')).toBeInTheDocument();
  });

  it('does not show tooltip by default', () => {
    render(<InfoIcon text={tooltipText} />);
    expect(screen.queryByText(tooltipText)).not.toBeInTheDocument();
  });

  describe('hover behavior (desktop)', () => {
    it('shows tooltip on mouse enter', () => {
      render(<InfoIcon text={tooltipText} />);
      const icon = screen.getByText('i');

      fireEvent.mouseEnter(icon);

      expect(screen.getByText(tooltipText)).toBeInTheDocument();
    });

    it('hides tooltip on mouse leave', () => {
      render(<InfoIcon text={tooltipText} />);
      const icon = screen.getByText('i');

      fireEvent.mouseEnter(icon);
      expect(screen.getByText(tooltipText)).toBeInTheDocument();

      fireEvent.mouseLeave(icon);
      expect(screen.queryByText(tooltipText)).not.toBeInTheDocument();
    });
  });

  describe('click/tap behavior (pinning)', () => {
    it('pins tooltip open on click', () => {
      render(<InfoIcon text={tooltipText} />);
      const icon = screen.getByText('i');

      fireEvent.click(icon);

      expect(screen.getByText(tooltipText)).toBeInTheDocument();
      expect(icon).toHaveClass('info-icon-active');
    });

    it('shows "tap to close" message when pinned', () => {
      render(<InfoIcon text={tooltipText} />);
      const icon = screen.getByText('i');

      fireEvent.click(icon);

      expect(screen.getByText('tap to close')).toBeInTheDocument();
    });

    it('keeps tooltip visible when pinned and mouse leaves', () => {
      render(<InfoIcon text={tooltipText} />);
      const icon = screen.getByText('i');

      // Pin it
      fireEvent.click(icon);
      expect(screen.getByText(tooltipText)).toBeInTheDocument();

      // Mouse leave should not close it
      fireEvent.mouseLeave(icon);
      expect(screen.getByText(tooltipText)).toBeInTheDocument();
    });

    it('closes tooltip when clicking on tooltip itself', () => {
      render(<InfoIcon text={tooltipText} />);
      const icon = screen.getByText('i');

      fireEvent.click(icon);
      expect(screen.getByText(tooltipText)).toBeInTheDocument();

      const tooltip = screen.getByText(tooltipText).closest('.info-tooltip');
      fireEvent.click(tooltip!);

      expect(screen.queryByText(tooltipText)).not.toBeInTheDocument();
    });

    it('closes tooltip when clicking icon again', () => {
      render(<InfoIcon text={tooltipText} />);
      const icon = screen.getByText('i');

      fireEvent.click(icon);
      expect(screen.getByText(tooltipText)).toBeInTheDocument();

      fireEvent.click(icon);
      expect(screen.queryByText(tooltipText)).not.toBeInTheDocument();
    });

    it('closes on outside click when pinned', async () => {
      render(
        <div>
          <InfoIcon text={tooltipText} />
          <button data-testid="outside">Outside</button>
        </div>
      );

      const icon = screen.getByText('i');
      fireEvent.click(icon);
      expect(screen.getByText(tooltipText)).toBeInTheDocument();

      // Wait for click listener to be added (100ms delay in component)
      await new Promise((r) => setTimeout(r, 150));

      // Click outside
      fireEvent.click(screen.getByTestId('outside'));

      await waitFor(() => {
        expect(screen.queryByText(tooltipText)).not.toBeInTheDocument();
      });
    });
  });

  describe('touch events', () => {
    it('pins tooltip on touch end', () => {
      render(<InfoIcon text={tooltipText} />);
      const icon = screen.getByText('i');

      fireEvent.touchEnd(icon);

      expect(screen.getByText(tooltipText)).toBeInTheDocument();
      expect(icon).toHaveClass('info-icon-active');
    });
  });
});
