import type { ValueRecipient } from '../types/feed';
import { PRESET_RECIPIENTS } from '../data/recipients';

interface AddRecipientSelectProps {
  onAdd: (recipient: ValueRecipient) => void;
}

export function AddRecipientSelect({ onAdd }: AddRecipientSelectProps) {
  return (
    <select
      className="form-input"
      style={{ width: 'auto', minWidth: '180px' }}
      value=""
      onChange={e => {
        const value = e.target.value;
        if (value === 'blank') {
          onAdd({ name: '', address: '', split: 0, type: 'node' });
        } else {
          const preset = PRESET_RECIPIENTS.find(p => p.label === value);
          if (preset) onAdd(preset.recipient);
        }
        e.target.value = '';
      }}
    >
      <option value="" disabled>+ Add Recipient</option>
      <option value="blank">Blank Recipient</option>
      {PRESET_RECIPIENTS.map(preset => (
        <option key={preset.label} value={preset.label}>{preset.label}</option>
      ))}
    </select>
  );
}
