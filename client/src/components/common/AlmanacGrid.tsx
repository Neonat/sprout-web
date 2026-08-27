/**
 * The almanac grid: the fifty Singapore plants of the almanac, found and
 * unfound.
 *
 * Undiscovered species show a silhouette — the species is named, because an
 * almanac that tells you what to go and look for is the point, but the creature
 * behind it is not revealed until someone brings one in.
 *
 * The silhouette is drawn rather than loaded. One image request per card for
 * art that is a single flat shape would be fifty requests for one picture, and
 * an SVG takes the surrounding text colour, so the same component covers the
 * dark almanac page and the light admin dashboard.
 */
import type { AlmanacEntry } from '../../services/sproutApi';

/** A generic leafy silhouette: pot, stem, three leaves. */
export function PlantSilhouette({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      className={className}
      aria-hidden="true"
      focusable="false"
      fill="currentColor"
    >
      <path d="M23 44h2V25h-2z" />
      <path d="M24 26c-7 0-12-4-13-11 7-1 12 3 13 11z" />
      <path d="M24 26c7 0 12-4 13-11-7-1-12 3-13 11z" />
      <path d="M24 20c0-6 2-10 6-13 3 5 1 11-6 13z" />
      <path d="M14 36h20l-2 8H16z" />
    </svg>
  );
}

export interface AlmanacGridProps {
  species: AlmanacEntry[];
  /** Called when a found card is activated. Unfound cards are never clickable —
   *  there is nothing behind them yet. */
  onSelect?: (entry: AlmanacEntry) => void;
  /** 'dark' for the landing page over the green field, 'light' for /admin. */
  tone?: 'dark' | 'light';
  /** Rows visible before the grid scrolls inside itself. A full grid part-way
   *  down a longer page buries everything under it; a few rows is a window onto
   *  the list. Omit it where the grid IS the page, as on /almanac. */
  visibleRows?: number;
}

/** Card height plus the gap, in rem — the unit the scroll window is cut from. */
const ROW_HEIGHT_REM = 9.5;

export function AlmanacGrid({
  species,
  onSelect,
  tone = 'dark',
  visibleRows,
}: AlmanacGridProps) {
  const dark = tone === 'dark';
  const windowed = typeof visibleRows === 'number' && visibleRows > 0;

  return (
    <ul
      className={`grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5${
        // overscroll-contain stops a flick inside the grid from running on and
        // scrolling the page once it bottoms out.
        windowed ? ' overflow-y-auto overscroll-contain pr-2' : ''
      }`}
      style={windowed ? { maxHeight: `${visibleRows! * ROW_HEIGHT_REM}rem` } : undefined}
      // The list is long; the label is what a screen reader announces on entry.
      aria-label={`${species.length} species`}
      tabIndex={windowed ? 0 : undefined}
    >
      {species.map((entry) => {
        const card = (
          <>
            <PlantSilhouette
              className={`mx-auto h-14 w-14 shrink-0 ${
                entry.discovered
                  ? 'text-[color:var(--color-hp-high)]'
                  : dark
                    ? 'text-white/15'
                    : 'text-black/15'
              }`}
            />
            {/* Common name first, binomial beneath.
                This was the other way round, and could not safely be flipped:
                the generated 200 had a common name for only 68 of them, so the
                other 132 cards would have led with the family — worse than the
                binomial for actually finding a plant. The curated 50 all carry
                one, so the useful line can lead. The binomial stays because it
                is what the scanner matches on, and because a card that only
                said "Rain tree" would teach a player nothing. */}
            <p
              className={`mt-2 text-[11px] leading-snug font-semibold ${
                dark ? 'text-white/85' : ''
              }`}
            >
              {entry.commonName ?? entry.speciesName}
            </p>
            <p
              className={`text-[10px] leading-snug italic ${
                dark ? 'text-white/45' : 'opacity-60'
              }`}
            >
              {entry.commonName ? entry.speciesName : entry.family}
            </p>
            <p
              className={`font-pixel mt-2 text-[9px] ${
                entry.discovered
                  ? 'text-[color:var(--color-hp-high)]'
                  : dark
                    ? 'text-white/30'
                    : 'opacity-40'
              }`}
            >
              {entry.discovered
                ? `Found ×${entry.discoveryCount}`
                : 'Not yet found'}
            </p>
          </>
        );

        const shell = dark
          ? 'pixel-panel-dark h-full w-full p-3 text-center'
          : 'pixel-panel h-full w-full p-3 text-center';

        return (
          <li key={entry.id}>
            {onSelect && entry.discovered ? (
              <button
                type="button"
                onClick={() => onSelect(entry)}
                className={`press ${shell} cursor-pointer`}
              >
                {card}
              </button>
            ) : (
              <div className={shell}>{card}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
