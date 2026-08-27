/**
 * The almanac's fixed taxonomy: 50 flowering plants a person in Singapore can
 * name on sight.
 *
 * The species themselves are curated — `scripts/almanac-curated.json` is the
 * list, and it is the honest place for a recognisability judgement to live.
 * Everything *about* each species comes from the published checklist, so no
 * family, status, origin or growth form here is invented:
 *
 *   Chong, K. Y., Tan, H. T. W. & Corlett, R. T. (2009). A Checklist of the
 *   Total Vascular Plant Flora of Singapore: Native, Naturalised and Cultivated
 *   Species. Raffles Museum of Biodiversity Research, NUS.
 *
 * One row is not from the checklist and says so: Vanda Miss Joaquim is the
 * national flower and a man-made hybrid (Papilionanthe Miss Joaquim), so a
 * checklist of species has no entry for it. That row carries `source:
 * 'cultivar'`; the other 49 carry `source: 'checklist'`.
 *
 * This list used to be 200 species selected mechanically, and the selection is
 * why bougainvillea, lalang and the touch-me-not were all missing: the rules
 * excluded `cultivated only` (1,491 species, which in Singapore means most
 * roadside and garden planting) and `weed of uncertain origin` (208), then
 * broke ties alphabetically twice over, so half the almanac was genera starting
 * A-E. See the script's docstring for the full account.
 *
 * Common names are not in the source. They are part of the curated list rather
 * than a lookup applied afterwards, which is why all 50 have one.
 */
import taxonomy from './almanac-taxonomy.json';

/** The checklist's own conservation/occurrence categories, verbatim.
 *
 *  All of them, not just the three the old selector kept: curation decides what
 *  belongs in the almanac now, so the status is something a card reports rather
 *  than a filter. `cultivated only` is the interesting one here — it is what
 *  the source calls a plant that grows in Singapore only because someone
 *  planted it, which describes most of what a person actually walks past. */
export type AlmanacStatus =
  | 'common'
  | 'naturalised'
  | 'casual'
  | 'cultivated only'
  | 'weed of uncertain origin'
  | 'vulnerable'
  | 'endangered'
  | 'critically endangered'
  | 'extinct'
  | 'globally extinct';
export type AlmanacOrigin = 'native' | 'exotic' | 'weed of uncertain origin';
export type AlmanacGrowthForm =
  | 'tree'
  | 'herb'
  | 'shrub'
  | 'climber'
  | 'epiphyte'
  | 'strangler';

export interface AlmanacSpecies {
  /** Slugified binomial — the stable key for a species everywhere. */
  id: string;
  speciesName: string;
  family: string;
  commonName: string | null;
  status: AlmanacStatus;
  origin: AlmanacOrigin | null;
  growthForm: AlmanacGrowthForm | null;
  /** Where this row's details came from. 'cultivar' means the checklist has no
   *  entry for it and the metadata is hand-written — see the note above. */
  source: 'checklist' | 'cultivar';
}

export const ALMANAC_SPECIES = taxonomy as AlmanacSpecies[];

export const ALMANAC_SOURCE =
  'Species details from Chong, Tan & Corlett (2009), A Checklist of the Total ' +
  'Vascular Plant Flora of Singapore. Raffles Museum of Biodiversity Research, ' +
  'NUS. Selection is our own; Vanda Miss Joaquim is a cultivar not in the ' +
  'checklist.';

/**
 * The almanac key for a scientific name.
 *
 * Identifications arrive with whatever the upstream service returned — an
 * authority, a subspecies, odd capitalisation — so this reduces a name to the
 * binomial the almanac is keyed on. Anything that is not a plausible binomial
 * gets null rather than a guess: an unmatched scan is simply not an almanac
 * discovery, which is the honest outcome for "Unknown Plant Species".
 */
export function almanacIdForSpecies(speciesName: string): string | null {
  // Drop hybrid markers as whole words only. Stripping them by pattern ate the
  // "x " inside names like Cyathocalyx ramuliflorus and Ilex cymosa, which
  // silently made three of the almanac's own species unmatchable.
  const words = speciesName
    .trim()
    .split(/\s+/)
    .filter((word) => word && word !== '×' && word !== 'x');
  if (words.length < 2) return null;

  const genus = words[0].toLowerCase();
  const epithet = words[1].toLowerCase();
  if (!/^[a-z]+$/.test(genus) || !/^[a-z][a-z-]+$/.test(epithet)) return null;
  return `${genus}-${epithet}`;
}

const BY_ID = new Map(ALMANAC_SPECIES.map((species) => [species.id, species]));

/** The same species, keyed on the whole name slugified rather than reduced to
 *  a binomial.
 *
 *  Needed for the cultivar. `Papilionanthe Miss Joaquim` is three words, and
 *  almanacIdForSpecies keeps two — it is built to strip an authority, and a
 *  cultivar epithet looks exactly like one to it. Reducing the id to
 *  `papilionanthe-miss` to satisfy the binomial rule would name the card after
 *  half a plant, so the name stays whole and the lookup learns a second key. */
const BY_NAME_SLUG = new Map(
  ALMANAC_SPECIES.map((species) => [
    species.speciesName.toLowerCase().replace(/\s+/g, '-'),
    species,
  ])
);

/** The almanac entry a scientific name belongs to, if the almanac lists it. */
export function findAlmanacSpecies(speciesName: string): AlmanacSpecies | null {
  const slug = speciesName.trim().toLowerCase().replace(/\s+/g, '-');
  const exact = BY_NAME_SLUG.get(slug);
  if (exact) return exact;

  const id = almanacIdForSpecies(speciesName);
  return id ? (BY_ID.get(id) ?? null) : null;
}

export function almanacSpeciesById(id: string): AlmanacSpecies | null {
  return BY_ID.get(id) ?? null;
}
