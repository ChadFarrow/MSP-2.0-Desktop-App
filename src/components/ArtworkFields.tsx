import { FIELD_INFO } from '../data/fieldInfo';
import { InfoIcon } from './InfoIcon';

interface ArtworkFieldsProps {
  imageUrl: string | undefined;
  imageTitle: string | undefined;
  imageDescription: string | undefined;
  onUpdate: (field: 'imageUrl' | 'imageTitle' | 'imageDescription', value: string) => void;
  urlLabel?: string;
  urlPlaceholder?: string;
  titlePlaceholder?: string;
  previewAlt?: string;
}

export function ArtworkFields({
  imageUrl,
  imageTitle,
  imageDescription,
  onUpdate,
  urlLabel = 'Image URL',
  urlPlaceholder = 'https://example.com/image.jpg',
  titlePlaceholder = 'Image description',
  previewAlt = 'Image preview'
}: ArtworkFieldsProps) {
  return (
    <div className="form-grid">
      <div className="form-group">
        <label className="form-label">{urlLabel} <span className="required">*</span><InfoIcon text={FIELD_INFO.imageUrl} /></label>
        <input
          type="url"
          className="form-input"
          placeholder={urlPlaceholder}
          value={imageUrl || ''}
          onChange={e => onUpdate('imageUrl', e.target.value)}
        />
      </div>
      <div className="form-group">
        <label className="form-label">Image Title<InfoIcon text={FIELD_INFO.imageTitle} /></label>
        <input
          type="text"
          className="form-input"
          placeholder={titlePlaceholder}
          value={imageTitle || ''}
          onChange={e => onUpdate('imageTitle', e.target.value)}
        />
      </div>
      <div className="form-group">
        <label className="form-label">Image Description<InfoIcon text={FIELD_INFO.imageDescription} /></label>
        <input
          type="text"
          className="form-input"
          placeholder="Optional description"
          value={imageDescription || ''}
          onChange={e => onUpdate('imageDescription', e.target.value)}
        />
      </div>
      {imageUrl && (
        <div className="form-group full-width">
          <img
            src={imageUrl}
            alt={previewAlt}
            style={{ maxWidth: '200px', borderRadius: '8px', border: '1px solid var(--border-color)' }}
            onError={e => (e.target as HTMLImageElement).style.display = 'none'}
          />
        </div>
      )}
    </div>
  );
}
