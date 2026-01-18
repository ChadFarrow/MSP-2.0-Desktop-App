import type { Funding } from '../types/feed';
import { FIELD_INFO } from '../data/fieldInfo';
import { InfoIcon } from './InfoIcon';

interface FundingFieldsProps {
  funding: Funding[] | undefined;
  onUpdate: (funding: Funding[]) => void;
  placeholderUrl?: string;
  placeholderText?: string;
}

export function FundingFields({
  funding,
  onUpdate,
  placeholderUrl = 'https://patreon.com/yourshow',
  placeholderText = 'Support the show!'
}: FundingFieldsProps) {
  const currentFunding = funding?.[0] || { url: '', text: '' };

  return (
    <div className="form-grid">
      <div className="form-group">
        <label className="form-label">URL<InfoIcon text={FIELD_INFO.fundingUrl} /></label>
        <input
          type="url"
          className="form-input"
          placeholder={placeholderUrl}
          value={currentFunding.url || ''}
          onChange={e => onUpdate([{ url: e.target.value, text: currentFunding.text || '' }])}
        />
      </div>
      <div className="form-group">
        <label className="form-label">Text<InfoIcon text={FIELD_INFO.fundingText} /></label>
        <input
          type="text"
          className="form-input"
          placeholder={placeholderText}
          maxLength={128}
          value={currentFunding.text || ''}
          onChange={e => onUpdate([{ url: currentFunding.url || '', text: e.target.value }])}
        />
      </div>
    </div>
  );
}
