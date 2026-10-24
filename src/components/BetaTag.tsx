import './BetaTag.css';

/**
 * The "🧪 BETA" tag on a beta field's label. Its field's wrapper also takes the
 * `beta-field` class, which draws the highlight box; both are in BetaTag.css.
 * The text is "Beta" and the CSS uppercases it, so a screen reader says the
 * word rather than spelling it out.
 */
export function BetaTag() {
  return (
    <span className="beta-tag">
      <span aria-hidden="true">🧪</span> Beta
    </span>
  );
}
