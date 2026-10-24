import { useExperimental } from '../store/experimentalStore';
import './BetaBanner.css';

// Every feature behind showBeta, in editor order. Gate a new feature on showBeta
// and it belongs here too, or the banner tells the user less than is switched on.
// The names match the field labels, which carry a <BetaTag /> in the editor.
const BETA_FEATURES = [
  {
    name: 'Alternate Versions',
    where: 'album tracks',
    what: 'extra files for a track, such as a lossless copy or its music video',
  },
  {
    name: 'Recommended first listen',
    where: 'tracks and publisher catalog albums',
    what: 'marks where new listeners should start',
  },
];

/**
 * Shown under the header while beta features are on, so the user can see that
 * they are and which ones without first finding a highlighted field — those are
 * scattered through collapsed track rows.
 */
export function BetaBanner() {
  const { showBeta, toggleBeta } = useExperimental();
  if (!showBeta) return null;

  return (
    <section className="beta-banner" aria-label="Beta features">
      <div className="beta-banner-body">
        <p className="beta-banner-title">
          <strong>🧪 Beta features are on.</strong>{' '}
          <span className="beta-banner-hint">Look for the 🧪 BETA tag in the editor:</span>
        </p>
        <ul className="beta-banner-list">
          {BETA_FEATURES.map(feature => (
            <li key={feature.name}>
              <strong>{feature.name}</strong>
              {/* Hidden on phones: the banner sits outside the scrolling editor,
                  so every line it takes there is lost for the whole session. */}
              <span className="beta-banner-detail">
                {' '}<span className="beta-banner-where">({feature.where})</span> — {feature.what}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <button className="btn btn-secondary btn-small beta-banner-off" onClick={toggleBeta}>
        Turn off
      </button>
    </section>
  );
}
