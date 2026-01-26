import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '../../test/utils';
import { ModalWrapper } from './ModalWrapper';

describe('ModalWrapper', () => {
  const title = 'Test Modal';
  const content = 'Modal content here';

  it('renders nothing when isOpen is false', () => {
    const onClose = vi.fn();
    render(
      <ModalWrapper isOpen={false} onClose={onClose} title={title}>
        <p>{content}</p>
      </ModalWrapper>
    );

    expect(screen.queryByText(title)).not.toBeInTheDocument();
    expect(screen.queryByText(content)).not.toBeInTheDocument();
  });

  it('renders modal when isOpen is true', () => {
    const onClose = vi.fn();
    render(
      <ModalWrapper isOpen={true} onClose={onClose} title={title}>
        <p>{content}</p>
      </ModalWrapper>
    );

    expect(screen.getByText(title)).toBeInTheDocument();
    expect(screen.getByText(content)).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(
      <ModalWrapper isOpen={true} onClose={onClose} title={title}>
        <p>{content}</p>
      </ModalWrapper>
    );

    const closeButton = screen.getByRole('button');
    fireEvent.click(closeButton);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when overlay is clicked', () => {
    const onClose = vi.fn();
    render(
      <ModalWrapper isOpen={true} onClose={onClose} title={title}>
        <p>{content}</p>
      </ModalWrapper>
    );

    const overlay = document.querySelector('.modal-overlay');
    fireEvent.click(overlay!);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose when modal content is clicked', () => {
    const onClose = vi.fn();
    render(
      <ModalWrapper isOpen={true} onClose={onClose} title={title}>
        <p>{content}</p>
      </ModalWrapper>
    );

    const modal = document.querySelector('.modal');
    fireEvent.click(modal!);

    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose when Escape key is pressed', () => {
    const onClose = vi.fn();
    render(
      <ModalWrapper isOpen={true} onClose={onClose} title={title}>
        <p>{content}</p>
      </ModalWrapper>
    );

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not respond to Escape when closed', () => {
    const onClose = vi.fn();
    render(
      <ModalWrapper isOpen={false} onClose={onClose} title={title}>
        <p>{content}</p>
      </ModalWrapper>
    );

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).not.toHaveBeenCalled();
  });

  it('renders footer when provided', () => {
    const onClose = vi.fn();
    const footerContent = 'Footer buttons';
    render(
      <ModalWrapper
        isOpen={true}
        onClose={onClose}
        title={title}
        footer={<div>{footerContent}</div>}
      >
        <p>{content}</p>
      </ModalWrapper>
    );

    expect(screen.getByText(footerContent)).toBeInTheDocument();
  });

  it('does not render footer section when not provided', () => {
    const onClose = vi.fn();
    render(
      <ModalWrapper isOpen={true} onClose={onClose} title={title}>
        <p>{content}</p>
      </ModalWrapper>
    );

    expect(document.querySelector('.modal-footer')).not.toBeInTheDocument();
  });

  it('applies custom className', () => {
    const onClose = vi.fn();
    render(
      <ModalWrapper
        isOpen={true}
        onClose={onClose}
        title={title}
        className="custom-modal"
      >
        <p>{content}</p>
      </ModalWrapper>
    );

    const modal = document.querySelector('.modal');
    expect(modal).toHaveClass('custom-modal');
  });

  it('applies custom style to overlay', () => {
    const onClose = vi.fn();
    render(
      <ModalWrapper
        isOpen={true}
        onClose={onClose}
        title={title}
        style={{ zIndex: 9999 }}
      >
        <p>{content}</p>
      </ModalWrapper>
    );

    const overlay = document.querySelector('.modal-overlay');
    expect(overlay).toHaveStyle({ zIndex: '9999' });
  });

  it('supports ReactNode as title', () => {
    const onClose = vi.fn();
    render(
      <ModalWrapper
        isOpen={true}
        onClose={onClose}
        title={<span data-testid="custom-title">Custom Title</span>}
      >
        <p>{content}</p>
      </ModalWrapper>
    );

    expect(screen.getByTestId('custom-title')).toBeInTheDocument();
  });
});
