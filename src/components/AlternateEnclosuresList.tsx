import { useRef } from 'react';
import type { AlternateEnclosure } from '../types/feed';
import { createEmptyAlternateEnclosure } from '../types/feed';
import { AUDIO_EXTENSION_LIST, AUDIO_FILE_TYPES, detectMediaSize, isKnownAudioFormat } from '../utils/audioUtils';
import { createMeasurer, isVideoType, typeChange, urlChange, type MeasuredField } from '../utils/alternateEnclosure';
import { detectVideoHeight, matchVideoExtension, VIDEO_EXTENSION_LIST, VIDEO_FILE_TYPES } from '../utils/videoUtils';
import { FIELD_INFO } from '../data/fieldInfo';
import { BetaTag } from './BetaTag';
import { InfoIcon } from './InfoIcon';

interface AlternateEnclosuresListProps {
  enclosures: AlternateEnclosure[];
  onChange: (enclosures: AlternateEnclosure[]) => void;
  // A measured file size or video height. It lands up to ~10 s after the
  // lookup starts, when this editor may be gone and its props stale, so the
  // caller writes it by track id and version id
  // (SET_ALTERNATE_ENCLOSURE_MEASURED), never through onChange, whose index
  // came from an old render.
  onMeasured: (versionId: string, url: string, field: MeasuredField, value: string) => void;
  // False hides "+ Add Alternate Version" (adding is a beta feature), leaving
  // the versions a track already has to edit or remove.
  canAdd?: boolean;
}

// The spec caps title at 32 characters.
const TITLE_MAX_LEN = 32;
const KNOWN_TYPES = [...AUDIO_FILE_TYPES, ...VIDEO_FILE_TYPES];

/**
 * Editor for a track's <podcast:alternateEnclosure> list: a title, file type,
 * file size and URL per version, and a height for a video (the song's music
 * video). The type follows the URL's extension until the user picks one, and
 * the size and height are measured from the file. Rows are keyed
 * and updated by `id`, never by index. The rules live in
 * utils/alternateEnclosure.ts, where they are unit-tested.
 *
 * Attributes the editor has no field for (default, rel, bitrate, integrity,
 * extra sources...) are kept from an imported feed and written back as is.
 */
export function AlternateEnclosuresList({ enclosures, onChange, onMeasured, canAdd = true }: AlternateEnclosuresListProps) {
  const update = (id: string, patch: Partial<AlternateEnclosure>) =>
    onChange(enclosures.map(enc => (enc.id === id ? { ...enc, ...patch } : enc)));

  // One measurer per value and instance, made on first use (from an event
  // handler, never during render), so each in-flight set spans every call. They
  // keep the first onMeasured, which is safe because that names this track by
  // id. Unlike the main file there is no size estimate: length is optional
  // here, and one from the main file's duration would be wrong for a lossless
  // or low-bitrate copy.
  const measurers = useRef<Record<MeasuredField, ReturnType<typeof createMeasurer>> | null>(null);
  const measureMissing = (version: AlternateEnclosure, url: string) => {
    measurers.current ??= {
      length: createMeasurer({ detect: detectMediaSize, write: (id, at, value) => onMeasured(id, at, 'length', value) }),
      height: createMeasurer({ detect: url => detectVideoHeight(url), write: (id, at, value) => onMeasured(id, at, 'height', value) })
    };
    if (!version.length) measurers.current.length(version.id, url);
    if (isVideoType(version.type) && !version.height) measurers.current.height(version.id, url);
  };

  const add = () => onChange([...enclosures, createEmptyAlternateEnclosure()]);
  const remove = (id: string) => onChange(enclosures.filter(enc => enc.id !== id));

  return (
    <div className="form-group beta-field" style={{ gridColumn: '1 / -1' }}>
      <label className="form-label">Alternate Versions <BetaTag /><InfoIcon text={FIELD_INFO.alternateEnclosures} /></label>
      <div className="repeatable-list">
        {enclosures.map((enc, index) => {
          const url = enc.sources[0]?.uri || '';
          const isVideoVersion = isVideoType(enc.type);
          return (
            <div key={enc.id} className="repeatable-item">
              <div className="repeatable-item-content">
                <div className="form-grid">
                  <div className="form-group">
                    <label className="form-label">Title<InfoIcon text={FIELD_INFO.alternateEnclosureTitle} /></label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g., Lossless or Music Video"
                      maxLength={TITLE_MAX_LEN}
                      value={enc.title || ''}
                      onChange={e => update(enc.id, { title: e.target.value || undefined })}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">File Type <span className="required">*</span></label>
                    <select
                      className="form-select"
                      aria-label={`Alternate version ${index + 1} file type`}
                      value={enc.type}
                      onChange={e => {
                        const patch = typeChange(enc, e.target.value);
                        update(enc.id, patch);
                        // Picked as a video: read the height from the file already there.
                        if (isVideoType(e.target.value)) measureMissing({ ...enc, ...patch }, url);
                      }}
                    >
                      <optgroup label="Audio">
                        {AUDIO_FILE_TYPES.map(t => (
                          <option key={t.value} value={t.value}>{t.label}</option>
                        ))}
                      </optgroup>
                      {/* A music video of the song */}
                      <optgroup label="Video">
                        {VIDEO_FILE_TYPES.map(t => (
                          <option key={t.value} value={t.value}>{t.label}</option>
                        ))}
                      </optgroup>
                      {/* An imported feed may carry any type (a streaming playlist,
                          an unusual MIME). Show it rather than snapping to MP3. */}
                      {!KNOWN_TYPES.some(t => t.value === enc.type) && (
                        <option value={enc.type}>{enc.type}</option>
                      )}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">File Size (bytes)<InfoIcon text={FIELD_INFO.alternateEnclosureLength} /></label>
                    <input
                      type="text"
                      inputMode="numeric"
                      className="form-input"
                      placeholder="e.g., 31200000"
                      value={enc.length || ''}
                      onChange={e => update(enc.id, { length: e.target.value.trim() || undefined })}
                    />
                  </div>
                  {isVideoVersion && (
                    <div className="form-group">
                      <label className="form-label">Height (pixels)<InfoIcon text={FIELD_INFO.alternateEnclosureHeight} /></label>
                      <input
                        type="text"
                        inputMode="numeric"
                        className="form-input"
                        placeholder="e.g., 1080"
                        value={enc.height || ''}
                        onChange={e => update(enc.id, { height: e.target.value.trim() || undefined })}
                      />
                    </div>
                  )}
                </div>
                <div className="form-group" style={{ marginTop: '1rem' }}>
                  <label className="form-label">
                    {isVideoVersion ? 'Video URL' : 'Audio URL'} <span className="required">*</span>
                  </label>
                  <input
                    type="url"
                    className="form-input"
                    aria-label={`Alternate version ${index + 1} URL`}
                    placeholder={isVideoVersion ? 'https://example.com/music-video.mp4' : 'https://example.com/track.flac'}
                    value={url}
                    onChange={e => update(enc.id, urlChange(enc, e.target.value))}
                    onPaste={e => {
                      const pasted = e.clipboardData.getData('text').trim();
                      if (!pasted.startsWith('http')) return;
                      e.preventDefault();
                      const patch = urlChange(enc, pasted);
                      update(enc.id, patch);
                      // Not what the paste kept or brought back with the old URL.
                      measureMissing({ ...enc, ...patch }, pasted);
                    }}
                    onBlur={e => measureMissing(enc, e.target.value)}
                  />
                  {url.trim() && !isKnownAudioFormat(url) && !matchVideoExtension(url) && (
                    <div style={{ color: 'var(--warning, #b8860b)', fontSize: '0.85em', marginTop: '4px' }}>
                      URL doesn't end with a recognized audio extension ({AUDIO_EXTENSION_LIST}) or video extension ({VIDEO_EXTENSION_LIST}). Podcast apps may not play it.
                    </div>
                  )}
                  {enc.sources.length > 1 && (
                    <div style={{ fontSize: '0.8rem', opacity: 0.7, marginTop: '4px' }}>
                      The imported feed also lists {enc.sources.length - 1} more address{enc.sources.length > 2 ? 'es' : ''} for this file. MSP keeps {enc.sources.length > 2 ? 'them' : 'it'} unchanged.
                    </div>
                  )}
                  {url.trim() && (
                    isVideoVersion ? (
                      // preload="none": a URL being typed must not fetch the
                      // file on every keystroke. The height is read on paste/blur.
                      <video
                        key={url}
                        src={url}
                        controls
                        preload="none"
                        style={{ width: '100%', marginTop: '8px', maxHeight: '300px' }}
                        onError={e => { (e.target as HTMLVideoElement).style.display = 'none'; }}
                      />
                    ) : (
                      <audio
                        key={url}
                        src={url}
                        controls
                        preload="none"
                        style={{ width: '100%', marginTop: '8px' }}
                        onError={e => { (e.target as HTMLAudioElement).style.display = 'none'; }}
                      />
                    )
                  )}
                </div>
              </div>
              <div className="repeatable-item-actions">
                <button
                  type="button"
                  className="btn btn-icon btn-danger"
                  aria-label={`Remove alternate version ${index + 1}`}
                  onClick={() => remove(enc.id)}
                >
                  &#10005;
                </button>
              </div>
            </div>
          );
        })}
        {canAdd && (
          <button type="button" className="add-item-btn" onClick={add}>
            + Add Alternate Version
          </button>
        )}
      </div>
    </div>
  );
}
