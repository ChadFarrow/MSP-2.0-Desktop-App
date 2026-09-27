import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';

/**
 * The /charts trend graphs, drawn as inline SVG. There is no chart library on purpose:
 * this repo keeps a close eye on its bundle (see BoostCoverage.tsx), and two kinds of
 * column graph do not need one.
 *
 * Both graphs mark this month the same way — fainter, and called "so far" — because a
 * month in progress would otherwise read as a drop on every graph on the page.
 */

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LONG_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

function monthParts(month: string): [number, number] {
  const [year, m] = month.split('-').map(Number);
  return [year, m];
}

function shortMonth(month: string, withYear = false): string {
  const [year, m] = monthParts(month);
  return withYear ? `${SHORT_MONTHS[m - 1]} ${year}` : SHORT_MONTHS[m - 1];
}

function longMonth(month: string): string {
  const [year, m] = monthParts(month);
  return `${LONG_MONTHS[m - 1]} ${year}`;
}

function plural(n: number, unit: string): string {
  return `${n} ${n === 1 ? unit : `${unit}s`}`;
}

/** A clean top for the y-axis, at or just above the largest value. */
function niceMax(max: number): number {
  if (max <= 1) return 1;
  const power = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (step * power >= max) return step * power;
  }
  return 10 * power;
}

/** A column rising from `base` to `top`: rounded at the data end, square at the baseline. */
function columnPath(x: number, top: number, width: number, base: number, radius: number): string {
  const height = base - top;
  if (height < 0.5) return '';
  const r = Math.min(radius, width / 2, height);
  return `M${x},${base}V${top + r}Q${x},${top} ${x + r},${top}H${x + width - r}` +
    `Q${x + width},${top} ${x + width},${top + r}V${base}Z`;
}

function useWidth<T extends Element>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

const PLOT = 88;      // column area
const CAP = 18;       // room above the tallest column for its value
const AXIS = 22;      // month labels under the baseline
const HEIGHT = CAP + PLOT + AXIS;

/**
 * One measure per month as columns, for the activity graphs. Hover or focus a column to
 * read it; the arrow keys move along the months. Every value is also in the table that
 * `SupportPerMonth` puts under the graphs, so the tooltip never gates a number.
 */
function MonthColumns({ title, unit, months, values, thisMonth }: {
  title: string;
  unit: string;
  months: string[];
  values: number[];
  thisMonth: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);

  const n = months.length;
  const slot = n > 0 ? width / n : 0;
  const columnWidth = Math.max(2, Math.min(24, slot * 0.7));
  const top = niceMax(Math.max(0, ...values));
  const base = CAP + PLOT;
  const y = (v: number) => base - (v / top) * PLOT;

  // Label the peak and the latest month, and let the tooltip and table carry the rest.
  const peak = values.lastIndexOf(Math.max(0, ...values));
  const labelled = new Set([peak, n - 1].filter(i => i >= 0 && values[i] > 0));

  const pick = (e: PointerEvent<SVGSVGElement>) => {
    if (slot <= 0) return;
    const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
    setActive(Math.min(n - 1, Math.max(0, Math.floor(x / slot))));
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1 };
    if (e.key in moves) {
      e.preventDefault();
      setActive(i => Math.min(n - 1, Math.max(0, (i ?? n - 1) + moves[e.key])));
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      setActive(e.key === 'Home' ? 0 : n - 1);
    }
  };

  const tipLeft = active === null ? 0 : Math.min(Math.max(slot * active + slot / 2, 48), Math.max(width - 48, 48));

  return (
    <figure className="chart-trend">
      <figcaption className="chart-trend-title">{title}</figcaption>
      <div
        ref={ref}
        className="chart-trend-plot"
        tabIndex={0}
        role="group"
        aria-label={`${title} per month. Use the arrow keys to read each month.`}
        onKeyDown={onKey}
        onFocus={() => setActive(a => a ?? n - 1)}
        onBlur={() => setActive(null)}
      >
        {width > 0 && (
          <svg width={width} height={HEIGHT} aria-hidden="true" onPointerMove={pick} onPointerLeave={() => setActive(null)}>
            <line className="chart-trend-grid" x1={0} x2={width} y1={CAP + 0.5} y2={CAP + 0.5} />
            <text className="chart-trend-tick" x={0} y={CAP - 5}>{top}</text>
            {values.map((v, i) => {
              const x = slot * i + (slot - columnWidth) / 2;
              const partial = months[i] === thisMonth;
              return (
                <g key={months[i]}>
                  <path
                    className={`chart-trend-col${partial ? ' is-partial' : ''}${active === i ? ' is-active' : ''}`}
                    d={columnPath(x, y(v), columnWidth, base, 4)}
                  />
                  {labelled.has(i) && (
                    <text className="chart-trend-value" x={x + columnWidth / 2} y={y(v) - 4} textAnchor="middle">{v}</text>
                  )}
                </g>
              );
            })}
            <line className="chart-trend-grid" x1={0} x2={width} y1={base + 0.5} y2={base + 0.5} />
            {n > 0 && (
              <>
                <text className="chart-trend-tick" x={0} y={base + 15}>{shortMonth(months[0], true)}</text>
                {n > 1 && (
                  <text className="chart-trend-tick" x={width} y={base + 15} textAnchor="end">
                    {shortMonth(months[n - 1])}{months[n - 1] === thisMonth ? ' · so far' : ''}
                  </text>
                )}
              </>
            )}
          </svg>
        )}
        {active !== null && months[active] && (
          <div className="chart-trend-tooltip" role="status" style={{ left: tipLeft }}>
            <strong>{plural(values[active], unit)}</strong>
            <span>{longMonth(months[active])}{months[active] === thisMonth ? ', so far' : ''}</span>
          </div>
        )}
      </div>
    </figure>
  );
}

export interface Trend {
  months: string[];
  boosts: number[];
  streams: number[];
  listeners: number[];
  /** The first month whose counts are complete; earlier months come from Helipad. */
  completeFrom: string;
}

/** The "Support per month" panel: boosts, streams and listeners as three small graphs. */
export function SupportPerMonth({ trend, thisMonth }: { trend: Trend; thisMonth: string }) {
  const early = trend.months.length > 0 && trend.months[0] < trend.completeFrom;
  return (
    <section className="chart-panel chart-trends-panel">
      <h2 className="chart-panel-title">Support per month</h2>
      <p className="chart-panel-blurb">
        How many boosts, streams and listeners music made with MSP got each month. Each graph
        has its own scale. The last, fainter column is this month so far.
      </p>

      <div className="chart-trends">
        <MonthColumns title="Boosts" unit="boost" months={trend.months} values={trend.boosts} thisMonth={thisMonth} />
        <MonthColumns title="Streams" unit="stream" months={trend.months} values={trend.streams} thisMonth={thisMonth} />
        <MonthColumns title="Listeners" unit="listener" months={trend.months} values={trend.listeners} thisMonth={thisMonth} />
      </div>

      {early && (
        <p className="chart-trend-note">
          Months before {longMonth(trend.completeFrom)} come from an older source that missed
          some payments, so they read low.
        </p>
      )}

      <details className="chart-trend-table">
        <summary>Show the numbers</summary>
        <table>
          <thead>
            <tr><th scope="col">Month</th><th scope="col">Boosts</th><th scope="col">Streams</th><th scope="col">Listeners</th></tr>
          </thead>
          <tbody>
            {trend.months.map((month, i) => (
              <tr key={month}>
                <th scope="row">{longMonth(month)}{month === thisMonth ? ' (so far)' : ''}</th>
                <td>{trend.boosts[i]}</td>
                <td>{trend.streams[i]}</td>
                <td>{trend.listeners[i]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}

const SPARK_MONTHS = 12;
const SPARK_SLOT = 6;
const SPARK_WIDTH = SPARK_MONTHS * SPARK_SLOT;
const SPARK_HEIGHT = 18;

/**
 * A row's last twelve months as tiny columns, each row on its own scale — the shape is
 * the point: rising, steady or fading. The numbers are in the label, for hover and for
 * screen readers, so the graph never holds a value nothing else says.
 */
export function Sparkline({ months, values, unit, thisMonth }: {
  months: string[];
  values: number[];
  unit: string;
  thisMonth: string;
}) {
  const shownMonths = months.slice(-SPARK_MONTHS);
  const shown = values.slice(-SPARK_MONTHS);
  const top = Math.max(1, ...shown);
  const offset = SPARK_WIDTH - shown.length * SPARK_SLOT;
  const label = `${unit[0].toUpperCase()}${unit.slice(1)}s per month: ` +
    shownMonths.map((m, i) => `${shortMonth(m)}${m === thisMonth ? ' so far' : ''} ${shown[i]}`).join(', ');

  return (
    <svg className="chart-spark" width={SPARK_WIDTH} height={SPARK_HEIGHT} role="img" aria-label={label}>
      <title>{label}</title>
      <line className="chart-trend-grid" x1={offset} x2={SPARK_WIDTH} y1={SPARK_HEIGHT - 0.5} y2={SPARK_HEIGHT - 0.5} />
      {shown.map((v, i) => (
        <path
          key={shownMonths[i]}
          className={`chart-trend-col${shownMonths[i] === thisMonth ? ' is-partial' : ''}`}
          d={columnPath(offset + i * SPARK_SLOT + 1, SPARK_HEIGHT - 1 - (v / top) * (SPARK_HEIGHT - 2), SPARK_SLOT - 2, SPARK_HEIGHT - 1, 1)}
        />
      ))}
    </svg>
  );
}
