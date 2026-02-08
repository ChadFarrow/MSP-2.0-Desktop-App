import type { ValueRecipient } from '../types/feed';

interface AddRecipientSelectProps {
  onAdd: (recipient: ValueRecipient) => void;
}

export function AddRecipientSelect({ onAdd }: AddRecipientSelectProps) {
  return (
    <button
      className="btn btn-secondary"
      onClick={() => onAdd({ name: '', address: '', split: 0, type: 'lnaddress' })}
    >
      + Add Recipient
    </button>
  );
}
