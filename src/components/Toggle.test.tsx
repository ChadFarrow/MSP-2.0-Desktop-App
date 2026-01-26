import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '../test/utils';
import { Toggle } from './Toggle';

describe('Toggle', () => {
  it('renders unchecked state', () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} />);

    const toggle = document.querySelector('.toggle');
    expect(toggle).not.toHaveClass('active');
  });

  it('renders checked state', () => {
    const onChange = vi.fn();
    render(<Toggle checked={true} onChange={onChange} />);

    const toggle = document.querySelector('.toggle');
    expect(toggle).toHaveClass('active');
  });

  it('calls onChange with true when clicked while unchecked', () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} />);

    const toggle = document.querySelector('.toggle');
    fireEvent.click(toggle!);

    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('calls onChange with false when clicked while checked', () => {
    const onChange = vi.fn();
    render(<Toggle checked={true} onChange={onChange} />);

    const toggle = document.querySelector('.toggle');
    fireEvent.click(toggle!);

    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('renders label when provided', () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} label="Enable feature" />);

    expect(screen.getByText('Enable feature')).toBeInTheDocument();
  });

  it('renders label suffix when provided', () => {
    const onChange = vi.fn();
    render(
      <Toggle
        checked={false}
        onChange={onChange}
        label="Enable"
        labelSuffix={<span data-testid="suffix">Beta</span>}
      />
    );

    expect(screen.getByTestId('suffix')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  it('has clickable toggle knob', () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} />);

    const knob = document.querySelector('.toggle-knob');
    expect(knob).toBeInTheDocument();
  });

  it('toggle wrapper contains all elements', () => {
    const onChange = vi.fn();
    render(
      <Toggle
        checked={true}
        onChange={onChange}
        label="Test Label"
        labelSuffix={<span>Suffix</span>}
      />
    );

    const wrapper = document.querySelector('.toggle-wrapper');
    expect(wrapper).toBeInTheDocument();
    expect(wrapper?.querySelector('.toggle')).toBeInTheDocument();
    expect(wrapper?.querySelector('.form-label')).toBeInTheDocument();
  });
});
