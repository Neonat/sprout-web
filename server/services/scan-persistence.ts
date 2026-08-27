/** Scan persistence — spec 2026-08-02 sections C, E and F.
 *
 *  Kept out of the route so the ordering (store sprite, record discovery, write
 *  the archive row) is testable without an HTTP stream, and so a failure here
 *  can be reported to the user rather than crashing the generation run.
 */
import { sanitizeSpeciesKey } from '../pipeline/dex';
import { deriveSpeciesStats } from '../data/species-stats';
import type { CaptureSource } from '../data/capture-source';
import type { AvatarRepository } from '../models/avatar';
import type { DexRepository } from '../models/dex';
import type { DexCandidate, DexCandidateRepository } from '../models/dexCandidate';
import { candidateId, isAlreadyExists } from '../repositories/dexCandidates';
import type { DiscoveryResolver, PublicDiscovery } from './discovery';
import type { SpriteStorage } from './sprite-storage';

export interface ScanPersistenceDependencies {
  storage: SpriteStorage;
  dex: DexRepository;
  candidates: Pick<DexCandidateRepository, 'maxVersion' | 'create'>;
  avatars: Pick<AvatarRepository, 'upsertFromScan'>;
  /** Turns the stored dex record into the block the client reads. Injected so
   *  this service stays testable without Firestore, and so the UID→display-name
   *  resolution has exactly one implementation (services/discovery.ts). */
  resolveDiscovery: DiscoveryResolver;
}

export interface ScanPersistOptions {
  /** How the photo reached the pipeline. Decides the archive record's lifetime
   *  — camera scans are kept, uploads expire in 24h (Req 6.12). */
  source: CaptureSource;
  /** False when the species name is a placeholder rather than a real
   *  identification — a failed Plant.id call, or the keyless mock path. Those
   *  scans get a per-user species key so they never share the canonical sprite
   *  object with a different user's plant. */
  identified: boolean;
  /** What Plant.id said about the species, for the archive to show. Omitted on
   *  an unidentified scan, where there is nothing true to record. */
  details?: PlantDetails;
  /** The pipeline's verdict on this render, recorded onto its candidate row so
   *  the dex gate can compare candidates without re-running the judge. */
  evaluation?: ScanEvaluation;
  /** Set when this scan reused the species' already-published sprite instead
   *  of rendering a new one (the dex cache hit in pipeline.routes.ts).
   *
   *  Two things are then deliberately skipped. The storage write, because the
   *  object is already there and re-deriving its url from `v1` would hand back
   *  the wrong art for a species whose gate has since published a later
   *  candidate — this url IS the published reference. And candidate recording,
   *  because nothing new was drawn: filing the bytes we just read back as a
   *  fresh candidate would queue the incumbent sprite to compete with itself. */
  reusedSpriteUrl?: string;
  /** GBIF's taxon id for the identification, when the identifier supplied one.
   *  Preferred over the species name for keying — see speciesKeyCandidates. */
  gbifId?: number | null;
}

/**
 * The Plant.id fields worth keeping, named as the archive reads them.
 *
 * Every one of these was already being fetched and thrown away: the route asks
 * Plant.id for seventeen detail fields, and persistScan wrote `metadata: null`,
 * so a scanned plant reached the archive with no description, no care notes and
 * no toxicity warning while the seeded demo plants carried a richer record than
 * anything a player could actually earn.
 *
 * Deliberately NOT here: habitat and conservation status. Plant.id returns
 * neither — verified against the live API, which silently ignores unknown
 * `details` names rather than erroring, so asking for them looks like it works
 * and yields nothing. See md/PLANT_DETAILS.md for the route to adding them.
 */
export interface PlantDetails {
  description?: string;
  commonNames?: string[];
  bestLightCondition?: string;
  bestSoilType?: string;
  bestWatering?: string;
  toxicity?: string;
  commonUses?: string;
  /** Plant.id's own probability for the top suggestion, 0..1. */
  confidence?: number;
}

/** Upstream prose is unbounded and this rides in every archive page payload.
 *  A provider that starts returning essays must not quietly inflate the
 *  collection; the client truncates for display anyway. */
const MAX_DETAIL_CHARS = 600;

function trimmedDetail(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (!text) return undefined;
  return text.length > MAX_DETAIL_CHARS ? `${text.slice(0, MAX_DETAIL_CHARS - 1)}…` : text;
}

/**
 * Drops every empty field, and returns null when nothing survives.
 *
 * Two reasons this is not merely tidy. Firestore rejects `undefined` outright,
 * so an absent field has to be absent rather than present-and-undefined. And
 * `metadata: {}` is not the same as `metadata: null` to the archive — an empty
 * object would render a details panel with nothing in it.
 */
export function buildScanMetadata(
  details: PlantDetails | undefined
): Record<string, unknown> | null {
  if (!details) return null;
  const metadata: Record<string, unknown> = {};

  const strings: [keyof PlantDetails, string | undefined][] = [
    ['description', trimmedDetail(details.description)],
    ['bestLightCondition', trimmedDetail(details.bestLightCondition)],
    ['bestSoilType', trimmedDetail(details.bestSoilType)],
    ['bestWatering', trimmedDetail(details.bestWatering)],
    ['toxicity', trimmedDetail(details.toxicity)],
    ['commonUses', trimmedDetail(details.commonUses)],
  ];
  for (const [key, value] of strings) {
    if (value !== undefined) metadata[key] = value;
  }

  const commonNames = (details.commonNames ?? [])
    .filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
    .map((name) => name.trim())
    .slice(0, 5);
  if (commonNames.length > 0) metadata.commonNames = commonNames;

  // 0 is a legitimate confidence and must not be dropped by a falsy check.
  if (typeof details.confidence === 'number' && Number.isFinite(details.confidence)) {
    metadata.confidence = details.confidence;
  }

  return Object.keys(metadata).length > 0 ? metadata : null;
}

/** What the pipeline knew about the render when it finished — carried onto the
 *  candidate row so the dex gate can rank candidates without re-judging. */
export interface ScanEvaluation {
  autoApproved: boolean;
  judgeCute: number | null;
  removeBgOk: boolean;
  paletteValid: boolean | null;
  dimsOk: boolean | null;
  notBlank: boolean | null;
}

export interface ScanPersistResult {
  saved: boolean;
  avatarId: string | null;
  created: boolean;
  saveError?: string;
  discovery: PublicDiscovery | null;
  /** Set when this scan's render was kept as a dex candidate: version 1 on a
   *  first discovery (published immediately), version >= 2 on a rescan
   *  (queued PENDING for the studio's dex gate). Null when the render was not
   *  a global candidate (unidentified scans) or candidate recording failed. */
  candidate: { version: number; status: DexCandidate['status'] } | null;
}

/** Firestore and Cloud Storage exceptions routinely name the bucket, the
 *  project, the full object path and the acting service-account principal.
 *  None of that belongs in a player-facing dialog, so the raw text stays in the
 *  console.error below and the client gets a fixed line. */
const SAVE_FAILED_MESSAGE = 'Please try scanning it again.';
const UNUSABLE_SPECIES_NAME_MESSAGE = 'That plant name could not be used to save the scan.';

/** Scopes a species key to one user.
 *
 *  Two users' "Unknown Plant Species" are not the same plant, but sprite
 *  storage is canonical per species: the second scanner would silently inherit
 *  the first scanner's sprite. Same for the mock identification path, which
 *  answers "Polygala calcarea" for every photo when PLANT_API_KEY is absent —
 *  a showcase run without a key would hand every user the first scanner's
 *  plant. Scoping the key to the scanner keeps those scans apart.
 *
 *  Two details make the derived key safe in all four of its roles (dex document
 *  id, storage path segment, archive de-duplication key, stats hash input):
 *
 *   - sanitizeSpeciesKey collapses runs of underscores, so a canonical key can
 *     never contain '__'. That makes '__u_' a separator no real species name
 *     can forge, however it is spelled.
 *   - The uid is hex-encoded rather than sanitized. sanitizeSpeciesKey
 *     lowercases, and Firebase UIDs are case-sensitive, so two distinct users
 *     could otherwise fold onto one key and share a sprite again. Hex is
 *     injective, and alphanumeric — valid as both a Firestore document id and a
 *     storage path segment.
 */
export function scopeSpeciesKeyToUser(speciesKey: string, userId: string): string {
  return `${speciesKey}__u_${Buffer.from(userId, 'utf8').toString('hex')}`;
}

/** Prefix for a key derived from a provider taxon id rather than a name. */
export const TAXON_KEY_PREFIX = 'gbif_';

/** The key a GBIF taxon is filed under. Single underscore by construction, so
 *  it can never be mistaken for the `__u_` user scope separator. */
export function taxonSpeciesKey(gbifId: number): string {
  return `${TAXON_KEY_PREFIX}${gbifId}`;
}

/**
 * The key a scientific binomial reduces to, with authority and infraspecific
 * rank dropped — `Fagraea fragrans Roxb.` and
 * `Avicennia marina (Forsk.) Vierh. ssp. marina` to `fagraea_fragrans` and
 * `avicennia_marina`. Null for anything that is not written like a binomial.
 *
 * Deliberately NOT data/almanac's almanacIdForSpecies, which looks like it
 * does this job and does a different one. That function answers "which of the
 * almanac's 200 species might this identification be?", so it lower-cases
 * before testing in order to tolerate whatever capitalisation an identifier
 * returns — which makes it read `Unknown Plant Species` as the binomial
 * `unknown-plant`, quietly truncating a placeholder into a species. Harmless
 * when the answer is only used to look up a fixed list that contains no such
 * entry; not harmless at all when the answer NAMES THE RECORD.
 *
 * The rule here is the written form: a binomial is `Genus epithet`, so the
 * genus must be capitalised and the epithet must not. That is exactly what
 * separates "Fagraea fragrans Roxb." from "Unknown Plant Species" — both are
 * three words, only one of them is a species. A name that fails it loses
 * nothing: it falls through to the raw sanitised key, which is where it would
 * have been filed anyway.
 */
export function binomialKeyFor(speciesName: string): string | null {
  const words = speciesName
    .trim()
    .split(/\s+/)
    .filter((word) => word && word !== '×' && word !== 'x');
  if (words.length < 2) return null;

  const [genus, epithet] = words;
  if (!/^[A-Z][a-z]+$/.test(genus)) return null;
  if (!/^[a-z][a-z-]+$/.test(epithet)) return null;

  return sanitizeSpeciesKey(`${genus} ${epithet}`);
}

/**
 * Every key this scan's species could be filed under, best first.
 *
 * The species key names the dex document, the sprite object, the archive
 * de-duplication target and the stats hash, and it used to be derived from
 * whatever string the identifier happened to return. That is not stable:
 * Plant.id answers "Fagraea fragrans", "Fagraea fragrans Roxb." and — once a
 * genus is revised — "Cyrtophyllum fragrans" for one plant, and each spelling
 * became its own species with its own sprite, stats and first discoverer.
 *
 * The chain, in order:
 *
 *  1. `gbif_<id>`, when the identifier gave a taxon id. Exact rather than
 *     heuristic: the id does not move when the authority, the rank or the
 *     accepted genus does, so it is the only one of the three that survives a
 *     synonym.
 *  2. The binomial the name reduces to — authority and infraspecific rank
 *     dropped. Covers a real identification GBIF does not carry, and a name
 *     the player typed that happens to be a binomial.
 *  3. The raw sanitised name, which is what every key written before this
 *     existed looks like, and the only option for a name that is not a
 *     binomial at all ("Mystery Fern").
 *
 * Callers resolve a WRITE key by taking the first entry that already has a dex
 * record, falling back to the first entry outright. That is what keeps this
 * from forking every existing species on its next scan: a species filed under
 * `fagraea_fragrans_roxb` stays there and keeps its discovery count and its
 * first discoverer, rather than starting again under a taxon key.
 *
 * Empty when the name yields nothing usable as a key.
 */
export function speciesKeyCandidates(
  speciesName: string,
  userId: string,
  identified: boolean,
  gbifId?: number | null
): string[] {
  const keys: string[] = [];

  // Never for a placeholder: a mock or unnamed scan must not claim a real
  // taxon's key, which is the one key guaranteed to be shared across users.
  if (identified && typeof gbifId === 'number' && Number.isSafeInteger(gbifId) && gbifId > 0) {
    keys.push(taxonSpeciesKey(gbifId));
  }

  const binomial = binomialKeyFor(speciesName);
  if (binomial) keys.push(binomial);

  const rawKey = sanitizeSpeciesKey(speciesName);
  if (rawKey) keys.push(rawKey);

  const ordered = [...new Set(keys.filter((key) => key))];
  return identified
    ? ordered
    : ordered.map((key) => scopeSpeciesKeyToUser(key, userId));
}

function toCandidateEvaluation(
  options: ScanPersistOptions
): DexCandidate['evaluation'] {
  const evaluation = options.evaluation;
  if (!evaluation) return null;
  // Firestore rejects `undefined`, so every absent field becomes an explicit
  // null — same reasoning as buildScanMetadata above.
  return {
    autoApproved: evaluation.autoApproved,
    judgeCute: evaluation.judgeCute ?? null,
    removeBgOk: evaluation.removeBgOk,
    paletteValid: evaluation.paletteValid ?? null,
    dimsOk: evaluation.dimsOk ?? null,
    notBlank: evaluation.notBlank ?? null,
    confidence:
      typeof options.details?.confidence === 'number' &&
      Number.isFinite(options.details.confidence)
        ? options.details.confidence
        : null,
  };
}

/** Records this scan's render as a dex candidate.
 *
 *  First discovery → the canonical v1 object was just created, so the row is
 *  version 1 and PUBLISHED (the gate model: the first sprite publishes so the
 *  almanac is never empty; everything later queues).
 *
 *  Rescan → the render that used to be thrown away is stored as
 *  `v<N>.png` plus a PENDING row for the studio's dex gate. The version is
 *  allocated by create()'s id conflict: a concurrent rescan that claims the
 *  same number fails the create and retries one higher. For a species that
 *  predates this collection, the canonical v1 is first backfilled as a
 *  PUBLISHED row (with no evaluation — nothing was recorded about it) so the
 *  gate always shows what the new candidate is competing against.
 */
async function recordCandidate(
  dependencies: ScanPersistenceDependencies,
  speciesKey: string,
  speciesName: string,
  userId: string,
  /** The species' first discoverer per the dex record. Used to attribute a
   *  backfilled v1 when this scan is a rescan of a species that predates the
   *  candidate collection — never the empty string, which would erase the real
   *  discoverer if a rescan's backfill won the race against their first scan. */
  firstDiscoveredBy: string,
  png: Buffer,
  stored: { url: string; created: boolean },
  options: ScanPersistOptions
): Promise<NonNullable<ScanPersistResult['candidate']>> {
  const now = new Date().toISOString();

  if (stored.created) {
    const row: DexCandidate = {
      id: candidateId(speciesKey, 1),
      speciesKey,
      speciesName,
      version: 1,
      spriteUrl: stored.url,
      status: 'PUBLISHED',
      scannedBy: userId,
      createdAt: now,
      evaluation: toCandidateEvaluation(options),
    };
    try {
      await dependencies.candidates.create(row);
    } catch (error) {
      // Two first-discoveries racing: storage picked one winner, and both
      // callers reached here with its URL. The row exists; nothing to add.
      if (!isAlreadyExists(error)) throw error;
    }
    return { version: 1, status: 'PUBLISHED' };
  }

  const maxVersion = await dependencies.candidates.maxVersion(speciesKey);
  let version = Math.max(2, maxVersion + 1);

  if (maxVersion === 0) {
    // No candidate rows yet: this species predates the collection. Backfill
    // the canonical sprite as v1/PUBLISHED so the gate shows the incumbent.
    // scannedBy comes from the dex record's first discoverer, not '': a
    // first-discovery scan and this rescan's backfill both try to create v1,
    // and if the backfill wins the race an empty scannedBy would permanently
    // discard the real discoverer's uid.
    try {
      await dependencies.candidates.create({
        id: candidateId(speciesKey, 1),
        speciesKey,
        speciesName,
        version: 1,
        spriteUrl: stored.url,
        status: 'PUBLISHED',
        scannedBy: firstDiscoveredBy,
        createdAt: now,
        evaluation: null,
      });
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
    }
  }

  // Allocate a version. saveVersion is create-only: a null return means a
  // concurrent rescan already claimed this version's object, so advance rather
  // than overwrite it. A Firestore create() conflict on the row means the same
  // thing from the other direction. Either way, try the next version.
  const MAX_ALLOCATION_ATTEMPTS = 5;
  for (let attempt = 1; ; attempt++) {
    if (attempt > MAX_ALLOCATION_ATTEMPTS) {
      throw new Error(
        `Could not allocate a candidate version for ${speciesKey} after ${MAX_ALLOCATION_ATTEMPTS} attempts`
      );
    }
    const spriteUrl = await dependencies.storage.saveVersion(speciesKey, version, png);
    if (spriteUrl === null) {
      version++;
      continue;
    }
    try {
      await dependencies.candidates.create({
        id: candidateId(speciesKey, version),
        speciesKey,
        speciesName,
        version,
        spriteUrl,
        status: 'PENDING',
        scannedBy: userId,
        createdAt: now,
        evaluation: toCandidateEvaluation(options),
      });
      return { version, status: 'PENDING' };
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      // The storage object at v<N> we just created is now an orphan the
      // winner's row does not reference. saveVersion is create-only, so it will
      // report that slot taken on any future reuse rather than clobbering it.
      version++;
    }
  }
}

export async function persistScan(
  dependencies: ScanPersistenceDependencies,
  userId: string,
  speciesName: string,
  speciesFamily: string | null,
  /** The finished render. Null only on the reused-sprite path, where nothing
   *  was drawn and neither the storage write nor candidate recording runs. */
  png: Buffer | null,
  options: ScanPersistOptions
): Promise<ScanPersistResult> {
  const failure = (saveError: string): ScanPersistResult => ({
    saved: false,
    avatarId: null,
    created: false,
    saveError,
    discovery: null,
    candidate: null,
  });

  try {
    // Key derivation lives inside this try, not above it: if speciesName were
    // ever not a string, the .toLowerCase() inside sanitizeSpeciesKey would
    // throw, and Section F's "never abort the run" guarantee must hold
    // unconditionally — that has to come back as saved: false, not an uncaught
    // exception out of runStage2cOnward. The empty-key behavior below is
    // unchanged: it still returns before any dependency I/O runs.
    const candidateKeys = speciesKeyCandidates(
      speciesName,
      userId,
      options.identified,
      options.gbifId
    );
    if (candidateKeys.length === 0) {
      return failure(UNUSABLE_SPECIES_NAME_MESSAGE);
    }

    /* Write where the species already lives, not where it would be filed
       today. Without this every species discovered before taxon keys existed
       would fork on its next scan: a new document under `gbif_<id>` with a
       discovery count of 1 and this scanner as its first discoverer, while the
       real record kept the history under its name-derived key — and a second
       sprite object to go with it. One batched read buys the continuity.

       Skipped when there is only one candidate, where the answer cannot
       differ and the read would be pure cost. */
    const existing =
      candidateKeys.length === 1
        ? null
        : await dependencies.dex.findFirstExisting(candidateKeys);
    const speciesKey = existing?.speciesKey ?? candidateKeys[0];

    // Pure computation, resolved ahead of the actual I/O calls so a bug here
    // is legible as its own thing rather than tangled up with the Firestore
    // write it happens to be constructed for.
    const stats = deriveSpeciesStats(speciesKey);

    // A cache hit already knows the published url and must not touch storage;
    // everything below still runs, because a reused sprite is still a scan:
    // the discovery count rises and the player gets their archive record.
    if (!options.reusedSpriteUrl && !png) {
      // A programming error rather than a user-facing one, but Section F says
      // this function never throws out into the run — so it reports instead.
      throw new Error('persistScan needs either a rendered png or a reusedSpriteUrl');
    }
    const stored = options.reusedSpriteUrl
      ? { url: options.reusedSpriteUrl, created: false, repaired: false }
      : await dependencies.storage.save(speciesKey, png!);
    const spriteUrl = stored.url;
    // The sprite goes on the dex record too: it is canonical per species, and
    // the almanac needs it without reading any player's avatar document.
    // stored.repaired forces the url onto the record: storage just stamped a
    // token onto a token-less object, so whatever url the dex holds is dead.
    const dex = await dependencies.dex.recordDiscovery(
      speciesKey,
      userId,
      speciesName,
      spriteUrl,
      stored.repaired
    );

    // Keep this render as a dex candidate. Best-effort by design: the player's
    // scan is already durably saved above, and a candidate row exists purely
    // for the studio's dex gate — its failure must degrade to "not reviewable",
    // never to saved: false.
    let candidate: ScanPersistResult['candidate'] = null;
    if (options.identified && !options.reusedSpriteUrl) {
      try {
        candidate = await recordCandidate(
          dependencies,
          speciesKey,
          speciesName,
          userId,
          dex.firstDiscoveredBy,
          png!,
          stored,
          options
        );
      } catch (error) {
        console.error(
          'Candidate recording failed after a successful save:',
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    const { record, created } = await dependencies.avatars.upsertFromScan(userId, {
      speciesName,
      speciesFamily,
      spriteUrl,
      stats,
      // Was unconditionally null, which is why nothing Plant.id returned ever
      // reached a player's archive. Still null for an unidentified scan.
      metadata: buildScanMetadata(options.details),
      source: options.source,
    });

    // Everything durable is written by this point. Resolving the discoverer's
    // display name is presentation, so it gets its own boundary: a lookup
    // failure must degrade to `discovery: null`, never turn a saved scan into
    // saved: false. (resolveDiscovery already swallows its own errors; this
    // guards an injected resolver that does not.)
    let discovery: PublicDiscovery | null = null;
    try {
      discovery = await dependencies.resolveDiscovery(dex, userId);
    } catch (error) {
      console.error(
        'Discovery resolution failed after a successful save:',
        error instanceof Error ? error.message : String(error)
      );
    }

    return { saved: true, avatarId: record.id, created, discovery, candidate };
  } catch (error) {
    // Deliberately swallowed: the sprite was generated successfully and the user
    // should still see it. Section F — a save fault must not look like a
    // pipeline crash.
    const message = error instanceof Error ? error.message : String(error);
    console.error('Scan persistence failed:', message);
    return failure(SAVE_FAILED_MESSAGE);
  }
}
