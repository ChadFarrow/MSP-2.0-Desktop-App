import { useState } from 'react';
import { MAX_CUSTOM_ROLE_LENGTH, ROLE_TOKENS, customRoleToken, roleTokens, withRoleToken } from '../utils/publisherRole';
import { BetaTag } from './BetaTag';
import { InfoIcon } from './InfoIcon';

const KNOWN_TOKENS: readonly string[] = ROLE_TOKENS.map(role => role.value);

/**
 * The roles of one publisher link: one checkbox for each role MSP offers
 * (ROLE_TOKENS), and a field to add a custom role. Several can be on, for one
 * party with several roles (rel="artist producer"). None on means "not
 * stated", and MSP writes no rel. A token MSP does not know (a custom role, or
 * one from an imported feed) stays on and is shown so it is not lost; turning
 * it off removes it.
 *
 * A beta field: it carries its own tag and box, unless `inBetaField` says it
 * sits inside one that already has them ("Other publishers").
 */
export function RolePicker({
  rel,
  onChange,
  label = 'This publisher is',
  info,
  inBetaField = false,
}: {
  rel?: string;
  onChange: (rel: string) => void;
  label?: string;
  info?: string;
  inBetaField?: boolean;
}) {
  const [custom, setCustom] = useState('');
  const tokens = roleTokens(rel);
  const unknown = tokens.filter(token => !KNOWN_TOKENS.includes(token));
  const customToken = customRoleToken(custom);
  const customPresent = customToken !== '' && tokens.some(token => token.toLowerCase() === customToken);

  const addCustom = () => {
    if (!customToken || customPresent) return;
    onChange(withRoleToken(rel, customToken, true));
    setCustom('');
  };

  return (
    <div className={inBetaField ? 'form-group' : 'form-group beta-field'}>
      <label className="form-label">
        {label}{!inBetaField && <> <BetaTag /></>}
        {info && <InfoIcon text={info} />}
      </label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px' }}>
        {ROLE_TOKENS.map(role => (
          <label key={role.value} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px' }}>
            <input
              type="checkbox"
              checked={tokens.includes(role.value)}
              onChange={e => onChange(withRoleToken(rel, role.value, e.target.checked))}
            />
            {role.label}
          </label>
        ))}
        {unknown.map(token => (
          <label key={token} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px' }}>
            <input
              type="checkbox"
              checked
              onChange={() => onChange(withRoleToken(rel, token, false))}
            />
            {token}
          </label>
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px', marginTop: '8px' }}>
        <input
          type="text"
          className="form-input"
          style={{ flex: '1 1 12rem', minWidth: 0, maxWidth: '20rem' }}
          placeholder="Other role, e.g. remixer"
          aria-label="Custom role"
          maxLength={MAX_CUSTOM_ROLE_LENGTH * 2}
          value={custom}
          onChange={e => setCustom(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addCustom();
            }
          }}
        />
        <button
          type="button"
          className="btn btn-secondary btn-small"
          onClick={addCustom}
          disabled={!customToken || customPresent}
        >
          Add role
        </button>
        {custom.trim() !== '' && customToken && customToken !== custom.trim() && !customPresent && (
          <span style={{ color: 'var(--text-tertiary)', fontSize: '12px' }}>Written as "{customToken}"</span>
        )}
        {customPresent && (
          <span style={{ color: 'var(--text-tertiary)', fontSize: '12px' }}>Already on</span>
        )}
      </div>
      {tokens.length === 0 && (
        <p style={{ color: 'var(--text-tertiary)', fontSize: '12px', marginTop: '4px', marginBottom: 0 }}>
          Not stated: MSP writes no role.
        </p>
      )}
    </div>
  );
}
