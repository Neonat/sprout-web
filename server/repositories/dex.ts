/** Firestore dex repository — spec 2026-08-02 section E.
 *
 *  The species key is the document id, which makes "has anyone found this
 *  before?" a single point read and keeps the increment inside one transaction.
 */
import { getDb } from '../firebase';
import type { DexDiscovery, DexRepository } from '../models/dex';

const COLLECTION = 'dex';

function toDiscovery(speciesKey: string, data: FirebaseFirestore.DocumentData): DexDiscovery {
  return {
    speciesKey,
    speciesName: String(data.speciesName ?? speciesKey),
    firstDiscoveredBy: String(data.firstDiscoveredBy ?? ''),
    firstDiscoveredAt: String(data.firstDiscoveredAt ?? ''),
    discoveryCount: Number(data.discoveryCount ?? 0),
    spriteUrl: String(data.spriteUrl ?? ''),
  };
}

export const firestoreDexRepository: DexRepository = {
  async recordDiscovery(speciesKey, userId, speciesName, spriteUrl = '', forceSpriteUrl = false) {
    const db = getDb();
    const ref = db.collection(COLLECTION).doc(speciesKey);

    return db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);

      if (!snapshot.exists) {
        const created: DexDiscovery = {
          speciesKey,
          speciesName,
          firstDiscoveredBy: userId,
          firstDiscoveredAt: new Date().toISOString(),
          discoveryCount: 1,
          spriteUrl,
        };
        transaction.create(ref, created);
        return created;
      }

      const existing = toDiscovery(speciesKey, snapshot.data() ?? {});
      const updated: DexDiscovery = {
        ...existing,
        discoveryCount: existing.discoveryCount + 1,
        // Backfill only, normally. A record written before the dex carried a
        // sprite has none, and an existing URL is never replaced since the
        // sprite is canonical per species — EXCEPT when forceSpriteUrl says the
        // stored url is a dead link storage just repaired, which must win.
        spriteUrl: forceSpriteUrl ? spriteUrl : existing.spriteUrl || spriteUrl,
      };
      // First-discoverer fields are deliberately untouched — being first is the
      // whole point of the feature, so a later scan must never overwrite it.
      transaction.update(ref, {
        discoveryCount: updated.discoveryCount,
        spriteUrl: updated.spriteUrl,
      });
      return updated;
    });
  },

  async get(speciesKey) {
    const snapshot = await getDb().collection(COLLECTION).doc(speciesKey).get();
    if (!snapshot.exists) return null;
    return toDiscovery(speciesKey, snapshot.data() ?? {});
  },

  async findFirstExisting(speciesKeys) {
    // Distinct, non-empty, order preserved — getAll() rejects an empty ref
    // list, and getAll() answers in the order asked, which is what makes
    // "first that exists" mean "highest priority that exists".
    const keys = [...new Set(speciesKeys.filter((k) => k))];
    if (keys.length === 0) return null;

    const db = getDb();
    const snapshots = await db.getAll(...keys.map((key) => db.collection(COLLECTION).doc(key)));
    for (const snapshot of snapshots) {
      if (snapshot.exists) return toDiscovery(snapshot.id, snapshot.data() ?? {});
    }
    return null;
  },

  async getSpriteUrls(speciesKeys) {
    const map = new Map<string, string>();
    // Distinct, non-empty keys only — getAll() rejects an empty ref list.
    const keys = [...new Set(speciesKeys.filter((k) => k))];
    if (keys.length === 0) return map;

    const db = getDb();
    const refs = keys.map((key) => db.collection(COLLECTION).doc(key));
    const snapshots = await db.getAll(...refs);
    for (const snapshot of snapshots) {
      if (!snapshot.exists) continue;
      const url = String(snapshot.data()?.spriteUrl ?? '');
      if (url) map.set(snapshot.id, url);
    }
    return map;
  },

  async list() {
    const snapshot = await getDb().collection(COLLECTION).get();
    return snapshot.docs.map((doc) => toDiscovery(doc.id, doc.data()));
  },
};

export default firestoreDexRepository;
