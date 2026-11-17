import { LISTING_CHOICES, describeServiceBlocks, listingFlags, listingOf } from '../utils/listing';
import type { BlockFlags, Listing } from '../utils/listing';

interface ListingSelectProps {
  value: BlockFlags;
  onChange: (flags: Required<BlockFlags>) => void;
}

// One control for the block tags (utils/listing.ts), shared by the album and
// publisher editors.
export function ListingSelect({ value, onChange }: ListingSelectProps) {
  const current = listingOf(value);
  const serviceBlocks = value.serviceBlocks ?? [];
  return (
    <>
      <select
        className="form-select"
        value={current}
        onChange={e => onChange(listingFlags(e.target.value as Listing))}
      >
        {current === 'custom' && (
          <option value="custom" disabled>Custom (from the imported feed)</option>
        )}
        {LISTING_CHOICES.map(choice => (
          <option key={choice.value} value={choice.value}>{choice.label}</option>
        ))}
      </select>
      {serviceBlocks.length > 0 && (
        <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '4px 0 0 0' }}>
          The imported feed sets rules for named services ({describeServiceBlocks(serviceBlocks)}).
          Picking a choice replaces them.
        </p>
      )}
    </>
  );
}
