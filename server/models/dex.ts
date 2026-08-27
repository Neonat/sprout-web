/** Species dex — one record per species, shared across all users.
 *  Spec 2026-08-02 section E. */

export interface DexDiscovery {
  speciesKey: string;
  speciesName: string;
  /** UID of whoever scanned this species first. Never an email. */
  firstDiscoveredBy: string;
  firstDiscoveredAt: string;
  discoveryCount: number;
  /** The canonical sprite for the species, as stored by sprite-storage.
   *  Empty on records written before the almanac needed it. */
  spriteUrl: string;
}

export interface DexRepository {
  /** Creates the species record, or increments its count if it already exists.
   *
   *  `forceSpriteUrl` replaces an existing record's spriteUrl instead of
   *  keeping it. Normally the canonical url is written once and never changed,
   *  but when storage had to repair a token-less object the url the record
   *  already holds is a dead link, so the fresh one must overwrite it. */
  recordDiscovery(
    speciesKey: string,
    userId: string,
    speciesName: string,
    spriteUrl?: string,
    forceSpriteUrl?: boolean
  ): Promise<DexDiscovery>;
  get(speciesKey: string): Promise<DexDiscovery | null>;
  /** The first of `speciesKeys` that has a record, in the order given, in one
   *  batched read.
   *
   *  A species can be addressed by more than one key: the taxon-id key it
   *  would be filed under today, and the name-derived keys anything scanned
   *  before that change is still filed under. A scan has to find its existing
   *  record wherever it actually lives — writing to the preferred key while an
   *  older one holds the discovery count and the first discoverer would fork
   *  the species rather than move it. Order is priority, not preference of
   *  storage: the caller lists the newest scheme first. */
  findFirstExisting(speciesKeys: string[]): Promise<DexDiscovery | null>;
  /** Current sprite url per species key, for a set of keys, in one batched
   *  read. Keys with no record (or an empty url) are simply absent from the
   *  map. Used by the archive to overlay the currently-published sprite onto a
   *  player's records without a per-record round trip. */
  getSpriteUrls(speciesKeys: string[]): Promise<Map<string, string>>;
  /** Every species found so far. The almanac renders 200 cards in one pass, so
   *  it reads the collection rather than calling get() per species. */
  list(): Promise<DexDiscovery[]>;
}
