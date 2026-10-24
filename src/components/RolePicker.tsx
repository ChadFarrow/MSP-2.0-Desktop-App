import { ROLE_TOKENS, roleTokens, withRoleToken } from '../utils/publisherRole';
import { BetaTag } from './BetaTag';
import { InfoIcon } from './InfoIcon';

const KNOWN_TOKENS: readonly string[] = ROLE_TOKENS.map(role => role.value);

/**
 * The roles of one publisher link: one checkbox for each starting token of
 * podcast-namespace PR #793. Several can be on, for one party with several
 * roles (rel="artist producer"). None on means "not stated", and MSP writes no
 * rel. A token MSP does not know, from an imported feed, stays on and is shown
 * so it is not lost.
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
  const tokens = roleTokens(rel);
  const unknown = tokens.filter(token => !KNOWN_TOKENS.includes(token));

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
      {tokens.length === 0 && (
        <p style={{ color: 'var(--text-tertiary)', fontSize: '12px', marginTop: '4px', marginBottom: 0 }}>
          Not stated: MSP writes no role.
        </p>
      )}
    </div>
  );
}
