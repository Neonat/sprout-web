/**
 * The almanac, as a page of its own.
 *
 * The grid and the public endpoint behind it both already existed — the grid
 * was written with a `tone: 'dark'` branch documented as "for the landing page
 * over the green field", and `GET /api/almanac` is deliberately unauthenticated
 * so a visitor can read it. Nothing rendered either one: the only caller of the
 * almanac was the admin dashboard, so the fifty plants the game is about were
 * visible to operators and to nobody else.
 *
 * A document page rather than a game screen, for the same reason the landing
 * page is: it scrolls, and `.screen` pins to 100dvh and clips overflow, which
 * a fifty-card grid does not want.
 *
 * Public. A signed-out visitor sees exactly what a player sees here — which
 * species exist, and which have been found by anyone — because that is the
 * page's job: it is the answer to "what is this game about".
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlmanacGrid } from '../components/common/AlmanacGrid';
import { AlmanacSpecimen } from '../components/common/AlmanacSpecimen';
import { useAlmanacFilter } from '../hooks/useAlmanacFilter';
import { useAuth } from '../hooks/useAuth';
import { extractApiError } from '../services/apiClient';
import {
  getAlmanac,
  getAlmanacEntry,
  type AlmanacEntry,
  type AlmanacEntryDetail,
  type AlmanacSummary,
} from '../services/sproutApi';

export default function AlmanacPage() {
  const { status } = useAuth();
  const signedIn = status === 'authenticated' || status === 'unverified';
  const [almanac, setAlmanac] = useState<AlmanacSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AlmanacEntryDetail | null>(null);
  const [opening, setOpening] = useState(false);
  const { query, setQuery, foundOnly, setFoundOnly, filtered } = useAlmanacFilter(
    almanac?.species ?? []
  );

  useEffect(() => {
    // `live` guards the unmount race: a visitor who navigates away before the
    // request lands would otherwise set state on a dead component.
    let live = true;
    void getAlmanac()
      .then((data) => live && setAlmanac(data))
      .catch(
        (err) => live && setError(extractApiError(err, 'Could not load the almanac.'))
      );
    return () => {
      live = false;
    };
  }, []);

  /* The grid carries no sprite — fifty of them would be megabytes on a page a
     visitor may only skim — so opening a card fetches the one record. */
  const openSpecies = useCallback(async (entry: AlmanacEntry) => {
    setOpening(true);
    setSelected(null);
    try {
      setSelected(await getAlmanacEntry(entry.id));
    } catch (err) {
      setError(extractApiError(err, 'Could not open that record.'));
    } finally {
      setOpening(false);
    }
  }, []);

  return (
    <div className="bg-sprout min-h-full text-white">
      <section className="relative isolate overflow-hidden">
        <img
          src="/img/bg_garden.jpeg"
          alt=""
          className="absolute inset-0 -z-20 h-full w-full object-cover"
        />
        {/* Same scrim as the landing hero: enough to hold white copy without
            flattening the painted scene, solid at the foot so the grid below
            joins onto it. */}
        <div className="from-sprout/70 via-sprout/60 to-sprout absolute inset-0 -z-10 bg-gradient-to-b" />

        <div className="mx-auto max-w-3xl px-6 py-16 text-center sm:py-20">
          <h1 className="font-pixel text-outline text-2xl leading-tight sm:text-4xl">
            The Almanac
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-white/75 sm:text-base">
            Fifty plants you can find in Singapore. Scan one and it is recorded
            here for everyone — the first person to bring each species in is the
            one the record remembers.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-20">
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        {!almanac ? (
          !error && <p className="py-10 text-center text-white/60">Loading the almanac…</p>
        ) : (
          <>
            <div className="flex flex-wrap items-end justify-between gap-4 py-6">
              <p className="font-pixel text-sm sm:text-base">
                {almanac.discovered} of {almanac.total} found
              </p>

              <div className="flex flex-wrap items-center gap-4">
                {/* Labelled, not placeholder-only: a placeholder disappears on
                    focus and is not a label to a screen reader. */}
                <label className="flex items-center gap-2 text-xs sm:text-sm">
                  <span className="sr-only sm:not-sr-only">Search</span>
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Name, common name or family"
                    className="min-w-0 rounded border border-white/20 bg-black/25 px-3 py-1.5 text-sm text-white placeholder:text-white/40"
                  />
                </label>

                <label className="flex items-center gap-2 text-xs sm:text-sm">
                  <input
                    type="checkbox"
                    checked={foundOnly}
                    onChange={(event) => setFoundOnly(event.target.checked)}
                  />
                  Found only
                </label>
              </div>
            </div>

            {filtered.length === 0 ? (
              <p className="py-10 text-center text-white/60">
                Nothing matches “{query}”.
              </p>
            ) : (
              /* No `visibleRows`: that window exists so the grid can sit inside
                 a longer page without burying what follows it. Here the grid is
                 the page, so it scrolls with the document. */
              <AlmanacGrid
                species={filtered}
                tone="dark"
                onSelect={(entry) => void openSpecies(entry)}
              />
            )}

            {(opening || selected) && (
              <AlmanacSpecimen
                entry={selected}
                signedIn={signedIn}
                loading={opening}
                onClose={() => setSelected(null)}
              />
            )}

            <p className="mt-10 text-xs leading-relaxed text-white/45">{almanac.source}</p>

            <p className="mt-6 text-sm">
              <Link className="text-link" to="/scan">
                Scan a plant
              </Link>{' '}
              to add to it.
            </p>
          </>
        )}
      </section>
    </div>
  );
}
