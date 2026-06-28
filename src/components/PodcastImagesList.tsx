import { useEffect, useRef, useState } from 'react';
import type { PodcastImage } from '../types/feed';
import { PODCAST_IMAGE_PURPOSES } from '../types/feed';
import { detectImageMetadata, suggestPurpose } from '../utils/imageMetadata';
import { FIELD_INFO } from '../data/fieldInfo';
import { InfoIcon } from './InfoIcon';

interface PodcastImagesListProps {
  images: PodcastImage[];
  onChange: (images: PodcastImage[]) => void;
  label?: string;
}

const CUSTOM = '__custom__';
const isPreset = (p?: string) => !!p && PODCAST_IMAGE_PURPOSES.some(opt => opt.value === p);

export function PodcastImagesList({ images, onChange, label = 'Additional Images' }: PodcastImagesListProps) {
  // Track which rows have the custom purpose input open (by index).
  const [customRows, setCustomRows] = useState<Set<number>>(new Set());

  // Always points at the latest images so the async handleUrlBlur (which may resolve
  // up to ~10s after blur) doesn't clobber edits the user made during image load.
  const imagesRef = useRef(images);
  useEffect(() => { imagesRef.current = images; });

  // Per-row URL we last auto-detected, so re-blurring an unchanged URL doesn't refetch.
  // Index-aligned with images; kept in sync by add()/remove() (append/remove only).
  const detectedUrls = useRef<string[]>([]);

  const update = (index: number, patch: Partial<PodcastImage>) => {
    onChange(imagesRef.current.map((img, i) => (i === index ? { ...img, ...patch } : img)));
  };

  const add = () => {
    detectedUrls.current = [...detectedUrls.current, ''];
    onChange([...imagesRef.current, { href: '' }]);
  };

  const remove = (index: number) => {
    detectedUrls.current = detectedUrls.current.filter((_, i) => i !== index);
    onChange(imagesRef.current.filter((_, i) => i !== index));
    // customRows indices are valid only because rows are never reordered (append/remove only).
    setCustomRows(prev => {
      const next = new Set<number>();
      prev.forEach(i => { if (i < index) next.add(i); else if (i > index) next.add(i - 1); });
      return next;
    });
  };

  // On URL entry, auto-detect dimensions/ratio/type and suggest a purpose if none set.
  const handleUrlBlur = async (index: number, url: string) => {
    if (!url) return;
    // Skip if we already auto-detected this exact URL for this row (e.g. a no-op re-blur).
    if (detectedUrls.current[index] === url) return;
    const meta = await detectImageMetadata(url);
    // Bail if the row was removed, or its URL changed, while the image was loading —
    // otherwise we'd write stale metadata onto the wrong (shifted) row.
    const current = imagesRef.current[index];
    if (!current || current.href !== url) return;
    detectedUrls.current[index] = url;
    // Only write fields we actually detected, so a failed/timed-out re-detect (which
    // yields just `type`) never erases previously detected width/height/aspectRatio
    // or edits the user made during the load window.
    const patch: Partial<PodcastImage> = {};
    if (meta.width !== undefined) patch.width = meta.width;
    if (meta.height !== undefined) patch.height = meta.height;
    if (meta.aspectRatio !== undefined) patch.aspectRatio = meta.aspectRatio;
    if (meta.type !== undefined) patch.type = meta.type;
    if (!current.purpose && meta.aspectRatio) {
      const suggested = suggestPurpose(meta.aspectRatio);
      if (suggested) patch.purpose = suggested;
    }
    update(index, patch);
  };

  const handlePurposeSelect = (index: number, value: string) => {
    if (value === CUSTOM) {
      setCustomRows(prev => new Set(prev).add(index));
      update(index, { purpose: '' });
    } else {
      setCustomRows(prev => { const next = new Set(prev); next.delete(index); return next; });
      update(index, { purpose: value });
    }
  };

  return (
    <div className="form-group" style={{ gridColumn: '1 / -1' }}>
      <label className="form-label">{label}<InfoIcon text={FIELD_INFO.podcastImages} /></label>
      <p style={{ fontSize: '0.85rem', opacity: 0.7, margin: '0 0 0.75rem' }}>
        Optional extra artwork apps can use in different places — e.g. a wide background for
        Now Playing screens or a banner.
      </p>
      <div className="repeatable-list">
        {images.map((img, index) => {
          const showCustom = customRows.has(index) || (!!img.purpose && !isPreset(img.purpose));
          const selectValue = showCustom ? CUSTOM : (img.purpose || '');
          return (
            <div key={index} className="repeatable-item">
              <div className="repeatable-item-content">
                <div className="form-grid">
                  <div className="form-group">
                    <label className="form-label">Image URL <span className="required">*</span></label>
                    <input
                      type="url"
                      className="form-input"
                      placeholder="https://example.com/background.jpg"
                      value={img.href}
                      onChange={e => update(index, { href: e.target.value })}
                      onBlur={e => handleUrlBlur(index, e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Purpose<InfoIcon text={FIELD_INFO.podcastImagePurpose} /></label>
                    <select className="form-input" value={selectValue} onChange={e => handlePurposeSelect(index, e.target.value)}>
                      <option value="">(none)</option>
                      {PODCAST_IMAGE_PURPOSES.map(opt => (
                        <option key={opt.value} value={opt.value} title={opt.description}>{opt.label} — {opt.description}</option>
                      ))}
                      <option value={CUSTOM}>Custom…</option>
                    </select>
                    {showCustom && (
                      <input
                        type="text"
                        className="form-input"
                        placeholder="custom purpose token(s)"
                        value={img.purpose || ''}
                        onChange={e => update(index, { purpose: e.target.value })}
                        style={{ marginTop: '0.5rem' }}
                      />
                    )}
                  </div>
                  <div className="form-group">
                    <label className="form-label">Alt text<InfoIcon text={FIELD_INFO.podcastImageAlt} /></label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="Describe the image (accessibility)"
                      value={img.alt || ''}
                      onChange={e => update(index, { alt: e.target.value })}
                    />
                  </div>
                </div>
                {(img.width || img.height || img.aspectRatio || img.type) && (
                  <div style={{ fontSize: '0.8rem', opacity: 0.7, marginTop: '0.25rem' }}>
                    {[img.width && img.height ? `${img.width}×${img.height}` : null, img.aspectRatio, img.type]
                      .filter(Boolean)
                      .join(' · ')}{' '}
                    <span style={{ opacity: 0.6 }}>(auto-detected)</span>
                  </div>
                )}
                {img.href && (
                  <img
                    src={img.href}
                    alt={img.alt || 'preview'}
                    style={{ maxHeight: '80px', maxWidth: '100%', marginTop: '0.5rem', borderRadius: '4px' }}
                    onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                )}
              </div>
              <div className="repeatable-item-actions">
                <button
                  type="button"
                  className="btn btn-icon btn-danger"
                  onClick={() => remove(index)}
                >
                  &#10005;
                </button>
              </div>
            </div>
          );
        })}
        <button type="button" className="add-item-btn" onClick={add}>
          + Add Image
        </button>
      </div>
    </div>
  );
}
