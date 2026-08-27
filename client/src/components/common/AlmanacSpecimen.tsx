/**
 * A found species, opened up under the almanac grid.
 *
 * Borderless and the full width of the grid above it, so it reads as the grid
 * unfolding rather than as a separate panel: the creature on the left, its
 * record on the right, stacking on a narrow screen.
 *
 * It takes focus when it opens. The grid scrolls inside its own window, so a
 * card that merely appeared below the fold would be invisible to a player who
 * had scrolled the list — and to a keyboard user the focus would still be up in
 * the grid.
 */
import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import type { AlmanacEntryDetail } from '../../services/sproutApi';
import { PlantSilhouette } from './AlmanacGrid';

export function AlmanacSpecimen({
  entry,
  signedIn,
  loading,
  onClose,
}: {
  entry: AlmanacEntryDetail | null;
  signedIn: boolean;
  loading: boolean;
  onClose: () => void;
}) {
  const panel = useRef<HTMLElement>(null);

  useEffect(() => {
    if (loading || !entry) return;
    panel.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    panel.current?.focus({ preventScroll: true });
  }, [entry, loading]);

  if (loading || !entry) {
    return (
      <section className="mt-6 bg-black/25 p-6" aria-busy="true">
        <p className="font-pixel text-[10px] text-white/40" role="status">
          Opening the record…
        </p>
      </section>
    );
  }


  return (
    <section
      ref={panel}
      // -1 keeps it out of the tab order once read, but allows programmatic focus.
      tabIndex={-1}
      aria-label={`${entry.speciesName} record`}
      className="mt-6 bg-black/25 p-6 focus:outline-none sm:p-8"
    >
      <div className="flex flex-col gap-6 sm:flex-row sm:gap-8">
        {/* Left half: the creature the game made of this species. */}
        <div className="flex shrink-0 items-center justify-center sm:w-1/2">
          {entry.spriteUrl ? (
            <img
              src={entry.spriteUrl}
              alt={`Pixel-art Plantemon of ${entry.speciesName}`}
              className="pixelated h-48 w-48 object-contain sm:h-64 sm:w-64"
            />
          ) : (
            <PlantSilhouette className="h-40 w-40 text-white/15" />
          )}
        </div>

        {/* Right half: what it is, and what it fights like. */}
        <div className="min-w-0 sm:w-1/2">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h3 className="text-xl leading-tight font-semibold italic">
                {entry.speciesName}
              </h3>
              <p className="mt-1 text-sm text-white/60">
                {[entry.commonName, entry.family, entry.growthForm]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="press pixel-button shrink-0 px-3 py-2 text-[9px]"
            >
              Close
            </button>
          </div>

          {/* Derived from the species key, exactly as the archive derives
              them, so the almanac and the game never disagree. */}
          <dl className="mt-5 grid grid-cols-4 gap-2">
              {(
                [
                  ['HP', entry.stats.hp],
                  ['ATK', entry.stats.attack],
                  ['DEF', entry.stats.defense],
                  ['SPD', entry.stats.speed],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="border-2 border-white/15 px-2 py-2 text-center">
                  <dt className="font-pixel text-[9px] text-white/40">{label}</dt>
                  <dd className="font-pixel mt-1 text-sm">{value}</dd>
                </div>
            ))}
          </dl>

          <p className="mt-5 text-xs leading-relaxed text-white/50">
            {/* The dex counts scans, not scanners — repeat scans by one player
                are included — so this must never be read as a headcount. */}
            Scanned {entry.discoveryCount} time
            {entry.discoveryCount === 1 ? '' : 's'}.
          </p>

          {/* The person, not the plant — the half that needs an account. */}
          {signedIn ? (
            <div className="mt-3">
              <p className="text-xs leading-relaxed text-white/60">
                First found by{' '}
                <span className="text-white">{entry.discoveredByName ?? 'a Sprout player'}</span>
                {entry.discoveredAt
                  ? ` on ${new Intl.DateTimeFormat('en-GB', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                      timeZone: 'UTC',
                    }).format(Date.parse(entry.discoveredAt))}`
                  : ''}
                {entry.isFirstDiscoverer ? ' — that was you.' : '.'}
              </p>
            </div>
          ) : (
            <p className="mt-3 text-xs leading-relaxed text-white/50">
              <Link to="/login" className="underline">
                Sign in
              </Link>{' '}
              to see who found it first.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
