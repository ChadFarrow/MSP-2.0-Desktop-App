import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '../../test/utils';
import { Editor } from './Editor';
import { FeedProvider, useFeed } from '../../store/feedStore';
import { ExperimentalProvider } from '../../store/experimentalStore';

// The editor reads the Nostr login only for its "use my npub" shortcuts.
vi.mock('../../store/nostrStore', () => ({
  useNostr: () => ({ state: { isLoggedIn: false, user: null } })
}));

// What the store holds for the album's block tags, so a test can see the
// choice land in the feed and not only in the control.
function BlockProbe() {
  const { state } = useFeed();
  const { itunesBlock, podcastBlock, serviceBlocks } = state.album;
  return <output data-testid="blocks">{JSON.stringify({ itunesBlock, podcastBlock, serviceBlocks })}</output>;
}

function renderEditor() {
  return render(
    <ExperimentalProvider>
      <FeedProvider>
        <Editor />
        <BlockProbe />
      </FeedProvider>
    </ExperimentalProvider>
  );
}

// The Listing control, ported from the web repo's Editor.tsx (MSP-2.0#150). The
// sync kept this fork's Editor.tsx, so an album or video had no way to set
// <itunes:block> or <podcast:block>; only the publisher editor had the control.
describe('Editor Listing', () => {
  it('offers the three listing choices, starting at Listed', () => {
    renderEditor();
    const select = screen.getByDisplayValue('Listed') as HTMLSelectElement;
    expect(Array.from(select.options).map(option => option.text)).toEqual([
      'Listed',
      'Hidden from podcast directories',
      'Hidden everywhere'
    ]);
  });

  it('writes "Hidden from podcast directories" as itunes:block only', () => {
    renderEditor();
    fireEvent.change(screen.getByDisplayValue('Listed'), { target: { value: 'directories' } });
    expect(screen.getByDisplayValue('Hidden from podcast directories')).toBeInTheDocument();
    expect(JSON.parse(screen.getByTestId('blocks').textContent!)).toEqual({
      itunesBlock: true,
      podcastBlock: false,
      serviceBlocks: []
    });
  });

  it('writes "Hidden everywhere" as both tags, and Listed clears them', () => {
    renderEditor();
    fireEvent.change(screen.getByDisplayValue('Listed'), { target: { value: 'everywhere' } });
    expect(JSON.parse(screen.getByTestId('blocks').textContent!)).toEqual({
      itunesBlock: true,
      podcastBlock: true,
      serviceBlocks: []
    });
    fireEvent.change(screen.getByDisplayValue('Hidden everywhere'), { target: { value: 'listed' } });
    expect(JSON.parse(screen.getByTestId('blocks').textContent!)).toEqual({
      itunesBlock: false,
      podcastBlock: false,
      serviceBlocks: []
    });
  });
});
