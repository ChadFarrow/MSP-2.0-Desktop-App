import type { ValueRecipient } from '../types/feed';
import { FIELD_INFO } from '../data/fieldInfo';
import { detectAddressType } from '../utils/addressUtils';
import { InfoIcon } from './InfoIcon';
import { AddRecipientSelect } from './AddRecipientSelect';

interface RecipientsListProps {
  recipients: ValueRecipient[];
  onUpdate: (index: number, recipient: ValueRecipient) => void;
  onRemove: (index: number) => void;
  onAdd: (recipient: ValueRecipient) => void;
}

export function RecipientsList({ recipients, onUpdate, onRemove, onAdd }: RecipientsListProps) {
  return (
    <>
      <h4 style={{ marginBottom: '12px', color: 'var(--text-secondary)' }}>Recipients</h4>
      <div className="repeatable-list">
        {recipients.map((recipient, index) => (
          <div key={index} className="repeatable-item">
            <div className="repeatable-item-content">
              <div className="form-grid">
                <div className="form-group">
                  <label className="form-label">Name<InfoIcon text={FIELD_INFO.recipientName} /></label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Recipient name"
                    value={recipient.name || ''}
                    onChange={e => onUpdate(index, { ...recipient, name: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Address<InfoIcon text={FIELD_INFO.recipientAddress} /></label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Node pubkey or LN address"
                    value={recipient.address || ''}
                    onChange={e => {
                      const address = e.target.value;
                      const detectedType = detectAddressType(address);
                      onUpdate(index, { ...recipient, address, type: detectedType });
                    }}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Split %<InfoIcon text={FIELD_INFO.recipientSplit} /></label>
                  <input
                    type="number"
                    className="form-input"
                    placeholder="50"
                    min="0"
                    max="100"
                    value={recipient.split ?? 0}
                    onChange={e => onUpdate(index, { ...recipient, split: parseInt(e.target.value) || 0 })}
                  />
                </div>
                {recipient.type === 'node' && recipient.address && (
                  <>
                    <div className="form-group">
                      <label className="form-label">Custom Key<InfoIcon text={FIELD_INFO.recipientCustomKey} /></label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="696969"
                        value={recipient.customKey || ''}
                        onChange={e => onUpdate(index, { ...recipient, customKey: e.target.value || undefined })}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Custom Value<InfoIcon text={FIELD_INFO.recipientCustomValue} /></label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="Optional TLV value"
                        value={recipient.customValue || ''}
                        onChange={e => onUpdate(index, { ...recipient, customValue: e.target.value || undefined })}
                      />
                    </div>
                  </>
                )}
              </div>
            </div>
            <div className="repeatable-item-actions">
              <button
                className="btn btn-icon btn-danger"
                onClick={() => onRemove(index)}
              >
                &#10005;
              </button>
            </div>
          </div>
        ))}
        <AddRecipientSelect onAdd={onAdd} />
      </div>
    </>
  );
}
