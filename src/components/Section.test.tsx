import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '../test/utils';
import { Section } from './Section';

describe('Section', () => {
  const title = 'Test Section';
  const icon = '📋';
  const content = 'Section content here';

  it('renders the section with title and icon', () => {
    render(
      <Section title={title} icon={icon}>
        <p>{content}</p>
      </Section>
    );

    expect(screen.getByText(title)).toBeInTheDocument();
    expect(screen.getByText(icon)).toBeInTheDocument();
    expect(screen.getByText(content)).toBeInTheDocument();
  });

  it('is expanded by default', () => {
    render(
      <Section title={title} icon={icon}>
        <p>{content}</p>
      </Section>
    );

    const sectionContent = screen.getByText(content).closest('.section-content');
    expect(sectionContent).not.toHaveClass('collapsed');
  });

  it('can be collapsed by default when defaultOpen is false', () => {
    render(
      <Section title={title} icon={icon} defaultOpen={false}>
        <p>{content}</p>
      </Section>
    );

    const sectionContent = screen.getByText(content).closest('.section-content');
    expect(sectionContent).toHaveClass('collapsed');
  });

  it('collapses when header is clicked', () => {
    render(
      <Section title={title} icon={icon}>
        <p>{content}</p>
      </Section>
    );

    const header = screen.getByText(title).closest('.section-header');
    fireEvent.click(header!);

    const sectionContent = screen.getByText(content).closest('.section-content');
    expect(sectionContent).toHaveClass('collapsed');
  });

  it('expands when header is clicked again', () => {
    render(
      <Section title={title} icon={icon}>
        <p>{content}</p>
      </Section>
    );

    const header = screen.getByText(title).closest('.section-header');

    // Collapse
    fireEvent.click(header!);
    let sectionContent = screen.getByText(content).closest('.section-content');
    expect(sectionContent).toHaveClass('collapsed');

    // Expand
    fireEvent.click(header!);
    sectionContent = screen.getByText(content).closest('.section-content');
    expect(sectionContent).not.toHaveClass('collapsed');
  });

  it('shows toggle indicator in correct state', () => {
    render(
      <Section title={title} icon={icon}>
        <p>{content}</p>
      </Section>
    );

    const toggle = document.querySelector('.section-toggle');
    expect(toggle).toHaveClass('expanded');

    const header = screen.getByText(title).closest('.section-header');
    fireEvent.click(header!);

    expect(toggle).not.toHaveClass('expanded');
  });

  it('preserves children when collapsed', () => {
    render(
      <Section title={title} icon={icon} defaultOpen={false}>
        <p>{content}</p>
      </Section>
    );

    // Content should still be in DOM even when collapsed (for CSS animation)
    expect(screen.getByText(content)).toBeInTheDocument();
  });
});
