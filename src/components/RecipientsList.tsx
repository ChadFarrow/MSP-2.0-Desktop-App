import type { ValueRecipient } from '../types/feed';
import { createSupportRecipients, isCommunitySupport } from '../types/feed';
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
  // Separate user recipients from platform recipients, preserving original indices
  const userRecipients: { recipient: ValueRecipient; originalIndex: number }[] = [];
  const platformRecipients: { recipient: ValueRecipient; originalIndex: number }[] = [];

  recipients.forEach((recipient, index) => {
    if (isCommunitySupport(recipient)) {
      platformRecipients.push({ recipient, originalIndex: index });
    } else {
      userRecipients.push({ recipient, originalIndex: index });
    }
  });

  const renderRecipient = (recipient: ValueRecipient, originalIndex: number, isSupport = false) => (
    <div key={originalIndex} className="repeatable-item">
      <div className="repeatable-item-content">
        <div className="form-grid">
          <div className="form-group">
            <label className="form-label">Name{!isSupport && <InfoIcon text={FIELD_INFO.recipientName} />}</label>
            <input
              type="text"
              className="form-input"
              placeholder="Recipient name"
              value={recipient.name || ''}
              onChange={e => onUpdate(originalIndex, { ...recipient, name: e.target.value })}
              readOnly={isSupport}
              style={isSupport ? { opacity: 0.7, cursor: 'default' } : undefined}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Address{!isSupport && <InfoIcon text={FIELD_INFO.recipientAddress} />}</label>
            <input
              type="text"
              className="form-input"
              placeholder="LN address or node pubkey"
              value={recipient.address || ''}
              onChange={e => {
                const address = e.target.value;
                const detectedType = detectAddressType(address);
                onUpdate(originalIndex, { ...recipient, address, type: detectedType });
              }}
              readOnly={isSupport}
              style={isSupport ? { opacity: 0.7, cursor: 'default' } : undefined}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Split %<InfoIcon text={FIELD_INFO.recipientSplit} /></label>
            <input
              type="number"
              className="form-input"
              placeholder="0"
              min="0"
              max="100"
              value={recipient.split || ''}
              onChange={e => onUpdate(originalIndex, { ...recipient, split: parseInt(e.target.value) || 0 })}
            />
          </div>
          {!isSupport && recipient.type === 'node' && /^[0-9a-fA-F]{66}$/.test(recipient.address) && (
            <>
              <div className="form-group">
                <label className="form-label">Custom Key<InfoIcon text={FIELD_INFO.recipientCustomKey} /></label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="696969"
                  value={recipient.customKey || ''}
                  onChange={e => onUpdate(originalIndex, { ...recipient, customKey: e.target.value || undefined })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Custom Value<InfoIcon text={FIELD_INFO.recipientCustomValue} /></label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Optional TLV value"
                  value={recipient.customValue || ''}
                  onChange={e => onUpdate(originalIndex, { ...recipient, customValue: e.target.value || undefined })}
                />
              </div>
            </>
          )}
        </div>
      </div>
      <div className="repeatable-item-actions">
        <button
          className="btn btn-icon btn-danger"
          onClick={() => onRemove(originalIndex)}
        >
          &#10005;
        </button>
      </div>
    </div>
  );

  const hasUserWithAddress = userRecipients.some(({ recipient }) => recipient.address);

  const handleAddSupport = () => {
    createSupportRecipients().forEach(r => onAdd(r));
  };

  return (
    <>
      <h4 style={{ marginBottom: '12px', color: 'var(--text-secondary)' }}>Recipients</h4>
      <div className="repeatable-list">
        {userRecipients.map(({ recipient, originalIndex }) => renderRecipient(recipient, originalIndex))}
        <AddRecipientSelect onAdd={onAdd} />
        {platformRecipients.length === 0 && hasUserWithAddress && (
          <div style={{
            borderTop: '1px solid var(--border-color)',
            marginTop: '16px',
            paddingTop: '16px',
            textAlign: 'center'
          }}>
            <div style={{
              fontSize: '13px',
              color: 'var(--text-secondary)',
              marginBottom: '8px',
              lineHeight: 1.4
            }}>
              Support the Podcasting 2.0 ecosystem? Add small splits for MSP 2.0 and Podcast Index.
            </div>
            <button
              className="btn btn-secondary"
              style={{ fontSize: '13px' }}
              onClick={handleAddSupport}
            >
              Add Community Support
            </button>
          </div>
        )}
        {platformRecipients.length > 0 && (
          <>
            <div style={{
              borderTop: '1px solid var(--border-color)',
              marginTop: '16px',
              paddingTop: '16px',
              opacity: 0.8
            }}>
              <div style={{
                fontSize: '12px',
                color: 'var(--text-secondary)',
                marginBottom: '4px',
                textTransform: 'uppercase',
                letterSpacing: '0.5px'
              }}>
                Community Support <span style={{ textTransform: 'none', opacity: 0.7 }}>(optional)</span>
              </div>
              <div style={{
                fontSize: '13px',
                color: 'var(--text-secondary)',
                marginBottom: '12px',
                lineHeight: 1.4
              }}>
                Help sustain the Podcasting 2.0 ecosystem. These splits support MSP 2.0 and Podcast Index. Click the red X to remove.
              </div>
              {platformRecipients.map(({ recipient, originalIndex }) => renderRecipient(recipient, originalIndex, true))}
            </div>
          </>
        )}
      </div>
    </>
  );
}
