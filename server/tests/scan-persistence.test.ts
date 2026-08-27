import {
  binomialKeyFor,
  persistScan,
  scopeSpeciesKeyToUser,
  speciesKeyCandidates,
  taxonSpeciesKey,
  type ScanPersistenceDependencies,
} from '../services/scan-persistence';
import type { AvatarRecord } from '../models/avatar';
import { sanitizeSpeciesKey } from '../pipeline/dex';

const PNG = Buffer.from('png');

const RECORD = { id: 'avatar-1' } as AvatarRecord;

const DEX = {
  speciesKey: 'fern',
  speciesName: 'Fern',
  firstDiscoveredBy: 'user-a',
  firstDiscoveredAt: '2026-08-02T00:00:00.000Z',
  discoveryCount: 1,
};

const RESOLVED = {
  firstDiscoveredByName: 'Justin',
  firstDiscoveredAt: '2026-08-02T00:00:00.000Z',
  discoveryCount: 1,
  isFirstDiscoverer: false,
};

function deps(overrides: Partial<ScanPersistenceDependencies> = {}): ScanPersistenceDependencies {
  return {
    storage: {
      save: jest
        .fn()
        .mockResolvedValue({ url: 'https://cdn.test/fern.png', created: true, repaired: false }),
      saveVersion: jest.fn().mockResolvedValue('https://cdn.test/fern-v2.png'),
    },
    dex: {
      recordDiscovery: jest.fn().mockResolvedValue(DEX),
      get: jest.fn(),
      // No pre-existing record by default, so the write key is the preferred
      // candidate — the behaviour every test here was written against.
      findFirstExisting: jest.fn().mockResolvedValue(null),
      getSpriteUrls: jest.fn().mockResolvedValue(new Map()),
      list: jest.fn(),
    },
    candidates: {
      maxVersion: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue(undefined),
    },
    avatars: { upsertFromScan: jest.fn().mockResolvedValue({ record: RECORD, created: true }) },
    resolveDiscovery: jest.fn().mockResolvedValue(RESOLVED),
    ...overrides,
  };
}

/** A storage fake whose save() rejects — the two-method shape in one place. */
function failingStorage(error: Error) {
  return { save: jest.fn().mockRejectedValue(error), saveVersion: jest.fn() };
}

/** Identification succeeded and named a real species — the canonical case. */
const IDENTIFIED = { identified: true, source: 'mobile' as const };

describe('persistScan', () => {
  it('stores the sprite, records the discovery, and writes the archive row', async () => {
    const dependencies = deps();
    const result = await persistScan(
      dependencies,
      'user-a',
      'Fern',
      'Polypodiaceae',
      PNG,
      IDENTIFIED
    );

    expect(dependencies.storage.save).toHaveBeenCalledWith('fern', PNG);
    expect(dependencies.dex.recordDiscovery).toHaveBeenCalledWith(
      'fern',
      'user-a',
      'Fern',
      'https://cdn.test/fern.png',
      false // not a token-less repair, so the url is not forced
    );
    expect(result.saved).toBe(true);
    expect(result.avatarId).toBe('avatar-1');
  });

  it('passes the stored sprite URL through to the archive record', async () => {
    const dependencies = deps();
    await persistScan(dependencies, 'user-a', 'Fern', null, PNG, IDENTIFIED);

    expect(dependencies.avatars.upsertFromScan).toHaveBeenCalledWith(
      'user-a',
      expect.objectContaining({ spriteUrl: 'https://cdn.test/fern.png' })
    );
  });

  it('reports a storage failure without throwing', async () => {
    const dependencies = deps({
      storage: failingStorage(new Error('bucket unreachable')),
    });
    const result = await persistScan(dependencies, 'user-a', 'Fern', null, PNG, IDENTIFIED);

    expect(result.saved).toBe(false);
    expect(result.avatarId).toBeNull();
    expect(result.saveError).toBeTruthy();
  });

  it('reports a dex discovery failure without throwing', async () => {
    const dependencies = deps({
      dex: {
        recordDiscovery: jest.fn().mockRejectedValue(new Error('dex write conflict')),
        getSpriteUrls: jest.fn().mockResolvedValue(new Map()),
        get: jest.fn(),
        findFirstExisting: jest.fn().mockResolvedValue(null),
        list: jest.fn(),
      },
    });
    const result = await persistScan(dependencies, 'user-a', 'Fern', null, PNG, IDENTIFIED);

    expect(result.saved).toBe(false);
    expect(result.avatarId).toBeNull();
  });

  it('reports a Firestore failure without throwing', async () => {
    const dependencies = deps({
      avatars: { upsertFromScan: jest.fn().mockRejectedValue(new Error('firestore down')) },
    });
    const result = await persistScan(dependencies, 'user-a', 'Fern', null, PNG, IDENTIFIED);

    expect(result.saved).toBe(false);
  });

  it('refuses a species name with no usable characters', async () => {
    const dependencies = deps();
    const result = await persistScan(dependencies, 'user-a', '!!!', null, PNG, IDENTIFIED);

    expect(result.saved).toBe(false);
    expect(dependencies.storage.save).not.toHaveBeenCalled();
  });
});

/**
 * saveError is streamed to the browser and rendered verbatim in the result
 * dialog. Firestore and Cloud Storage exceptions routinely carry the bucket
 * name, the project id, the full object path and the acting service-account
 * principal, so the raw text must stay in the log and never on the wire.
 */
describe('persistScan save error reporting', () => {
  const leaky = new Error(
    'Permission denied on gs://sprout-prod.appspot.com/sprites/fern/v1.png for ' +
      'service account pipeline@sprout-prod.iam.gserviceaccount.com (project sprout-prod)'
  );

  it('does not put the exception text on the wire', async () => {
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const dependencies = deps({ storage: failingStorage(leaky) });
      const result = await persistScan(dependencies, 'user-a', 'Fern', null, PNG, IDENTIFIED);

      expect(result.saveError).toBeTruthy();
      expect(result.saveError).not.toContain('gs://');
      expect(result.saveError).not.toContain('sprout-prod');
      expect(result.saveError).not.toContain('iam.gserviceaccount.com');
      expect(result.saveError).not.toContain('sprites/fern');
    } finally {
      errorLog.mockRestore();
    }
  });

  it('keeps the raw detail in the log', async () => {
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const dependencies = deps({ storage: failingStorage(leaky) });
      await persistScan(dependencies, 'user-a', 'Fern', null, PNG, IDENTIFIED);

      expect(errorLog).toHaveBeenCalledWith(
        'Scan persistence failed:',
        expect.stringContaining('gs://sprout-prod.appspot.com')
      );
    } finally {
      errorLog.mockRestore();
    }
  });

  it('reports the same fixed line whatever the underlying fault was', async () => {
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const storageFault = await persistScan(
        deps({ storage: failingStorage(new Error('bucket unreachable')) }),
        'user-a',
        'Fern',
        null,
        PNG,
        IDENTIFIED
      );
      const firestoreFault = await persistScan(
        deps({
          avatars: { upsertFromScan: jest.fn().mockRejectedValue(new Error('firestore down')) },
        }),
        'user-a',
        'Fern',
        null,
        PNG,
        IDENTIFIED
      );

      expect(storageFault.saveError).toBe(firestoreFault.saveError);
      expect(storageFault.saveError).not.toContain('bucket unreachable');
      expect(firestoreFault.saveError).not.toContain('firestore down');
    } finally {
      errorLog.mockRestore();
    }
  });
});

/** Spec section E: the client reads a resolved display name, never a UID. */
describe('persistScan discovery block', () => {
  it('returns the resolved block rather than the raw dex record', async () => {
    const dependencies = deps();
    const result = await persistScan(dependencies, 'user-b', 'Fern', null, PNG, IDENTIFIED);

    expect(dependencies.resolveDiscovery).toHaveBeenCalledWith(DEX, 'user-b');
    expect(result.discovery).toEqual(RESOLVED);
    expect(result.discovery).not.toHaveProperty('firstDiscoveredBy');
    expect(JSON.stringify(result)).not.toContain('user-a');
  });

  it('still saves the scan when the display-name lookup throws', async () => {
    const dependencies = deps({
      resolveDiscovery: jest.fn().mockRejectedValue(new Error('users collection unreadable')),
    });
    const result = await persistScan(dependencies, 'user-a', 'Fern', null, PNG, IDENTIFIED);

    expect(result.saved).toBe(true);
    expect(result.avatarId).toBe('avatar-1');
    expect(result.discovery).toBeNull();
  });

  it('carries a null resolution straight through', async () => {
    const dependencies = deps({ resolveDiscovery: jest.fn().mockResolvedValue(null) });
    const result = await persistScan(dependencies, 'user-a', 'Fern', null, PNG, IDENTIFIED);

    expect(result.saved).toBe(true);
    expect(result.discovery).toBeNull();
  });
});

/** A failed identification, or the keyless mock, is not a real species. */
describe('persistScan unidentified scans', () => {
  const UNIDENTIFIED = { identified: false, source: 'mobile' as const };

  it('scopes the species key to the scanning user', async () => {
    const dependencies = deps();
    await persistScan(
      dependencies,
      'user-a',
      'Unknown Plant Species',
      null,
      PNG,
      UNIDENTIFIED
    );

    const scoped = scopeSpeciesKeyToUser('unknown_plant_species', 'user-a');
    expect(dependencies.storage.save).toHaveBeenCalledWith(scoped, PNG);
    expect(dependencies.dex.recordDiscovery).toHaveBeenCalledWith(
      scoped,
      'user-a',
      'Unknown Plant Species',
      'https://cdn.test/fern.png',
      false
    );
  });

  it('gives two users different keys for the same placeholder name', async () => {
    const first = deps();
    const second = deps();
    await persistScan(first, 'user-a', 'Unknown Plant Species', null, PNG, UNIDENTIFIED);
    await persistScan(second, 'user-b', 'Unknown Plant Species', null, PNG, UNIDENTIFIED);

    const keyFor = (dependencies: ScanPersistenceDependencies) =>
      (dependencies.storage.save as jest.Mock).mock.calls[0][0];
    expect(keyFor(first)).not.toBe(keyFor(second));
  });

  it('leaves an identified species fully canonical', async () => {
    const first = deps();
    const second = deps();
    await persistScan(first, 'user-a', 'Fern', null, PNG, IDENTIFIED);
    await persistScan(second, 'user-b', 'Fern', null, PNG, IDENTIFIED);

    expect(first.storage.save).toHaveBeenCalledWith('fern', PNG);
    expect(second.storage.save).toHaveBeenCalledWith('fern', PNG);
  });
});

/**
 * The candidate flow: every identified render is kept for the studio's Dex
 * Gate. First discovery publishes v1; a rescan's render — which used to be
 * thrown away entirely — is stored as v<N> and queued PENDING.
 */
describe('persistScan dex candidates', () => {
  const alreadyExists = () => Object.assign(new Error('already exists'), { code: 6 });

  it('records the first discovery as v1, PUBLISHED', async () => {
    const dependencies = deps();
    const result = await persistScan(dependencies, 'user-a', 'Fern', null, PNG, IDENTIFIED);

    expect(dependencies.candidates.create).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'fern__v1', version: 1, status: 'PUBLISHED' })
    );
    expect(dependencies.storage.saveVersion).not.toHaveBeenCalled();
    expect(result.candidate).toEqual({ version: 1, status: 'PUBLISHED' });
  });

  it('stores a rescan render as the next version, PENDING', async () => {
    const dependencies = deps({
      storage: {
        save: jest.fn().mockResolvedValue({ url: 'https://cdn.test/fern.png', created: false }),
        saveVersion: jest.fn().mockResolvedValue('https://cdn.test/fern-v3.png'),
      },
      candidates: {
        maxVersion: jest.fn().mockResolvedValue(2),
        create: jest.fn().mockResolvedValue(undefined),
      },
    });
    const result = await persistScan(dependencies, 'user-b', 'Fern', null, PNG, IDENTIFIED);

    expect(dependencies.storage.saveVersion).toHaveBeenCalledWith('fern', 3, PNG);
    expect(dependencies.candidates.create).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'fern__v3', version: 3, status: 'PENDING' })
    );
    expect(result.candidate).toEqual({ version: 3, status: 'PENDING' });
  });

  it('backfills v1 attributed to the dex first-discoverer, not the rescanner or empty', async () => {
    const create = jest.fn().mockResolvedValue(undefined);
    const dependencies = deps({
      storage: {
        save: jest.fn().mockResolvedValue({ url: 'https://cdn.test/fern.png', created: false, repaired: false }),
        saveVersion: jest.fn().mockResolvedValue('https://cdn.test/fern-v2.png'),
      },
      candidates: { maxVersion: jest.fn().mockResolvedValue(0), create },
    });
    // user-b rescans, but DEX.firstDiscoveredBy is 'user-a' — the backfilled v1
    // must credit the real discoverer (from the dex record), never '' (which a
    // race could otherwise burn in) and never the rescanner.
    await persistScan(dependencies, 'user-b', 'Fern', null, PNG, IDENTIFIED);

    // The incumbent goes in first so the gate shows what v2 competes against.
    expect(create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        id: 'fern__v1',
        status: 'PUBLISHED',
        scannedBy: 'user-a',
        evaluation: null,
      })
    );
    expect(create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: 'fern__v2', status: 'PENDING' })
    );
  });

  it('retries one version higher when a concurrent rescan wins the id', async () => {
    const create = jest
      .fn()
      .mockRejectedValueOnce(alreadyExists())
      .mockResolvedValueOnce(undefined);
    const saveVersion = jest
      .fn()
      .mockResolvedValueOnce('https://cdn.test/fern-v2.png')
      .mockResolvedValueOnce('https://cdn.test/fern-v3.png');
    const dependencies = deps({
      storage: {
        save: jest.fn().mockResolvedValue({ url: 'https://cdn.test/fern.png', created: false }),
        saveVersion,
      },
      candidates: { maxVersion: jest.fn().mockResolvedValue(1), create },
    });
    const result = await persistScan(dependencies, 'user-b', 'Fern', null, PNG, IDENTIFIED);

    expect(saveVersion).toHaveBeenLastCalledWith('fern', 3, PNG);
    expect(result.candidate).toEqual({ version: 3, status: 'PENDING' });
  });

  it('keeps unidentified scans out of the gate entirely', async () => {
    const dependencies = deps();
    const result = await persistScan(dependencies, 'user-a', 'Mystery', null, PNG, {
      identified: false,
      source: 'mobile' as const,
    });

    expect(dependencies.candidates.create).not.toHaveBeenCalled();
    expect(result.candidate).toBeNull();
  });

  it('still saves the scan when candidate recording fails', async () => {
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const dependencies = deps({
        candidates: {
          maxVersion: jest.fn(),
          create: jest.fn().mockRejectedValue(new Error('candidates collection unwritable')),
        },
      });
      const result = await persistScan(dependencies, 'user-a', 'Fern', null, PNG, IDENTIFIED);

      // Best-effort by design: a candidate row exists purely for the gate.
      expect(result.saved).toBe(true);
      expect(result.candidate).toBeNull();
      expect(dependencies.avatars.upsertFromScan).toHaveBeenCalled();
    } finally {
      errorLog.mockRestore();
    }
  });
});

describe('scopeSpeciesKeyToUser', () => {
  it('produces a key valid as a Firestore id and a storage path segment', () => {
    const key = scopeSpeciesKeyToUser('unknown_plant_species', 'AbC123xyz');

    expect(key).toMatch(/^[a-z0-9_]+$/);
    expect(key).not.toContain('/');
    expect(key.length).toBeLessThan(1500);
  });

  it('separates on a marker no real species name can produce', () => {
    // sanitizeSpeciesKey collapses runs of underscores, so no canonical key can
    // contain '__' — a species literally named "Fern u <uid>" cannot collide.
    expect(sanitizeSpeciesKey('Fern  u  616263')).not.toContain('__');
    expect(scopeSpeciesKeyToUser('fern', 'abc')).toContain('__u_');
  });

  it('keeps case-different uids apart', () => {
    // Firebase UIDs are case-sensitive; sanitizeSpeciesKey lowercases, so the
    // uid is hex-encoded instead of sanitized.
    expect(scopeSpeciesKeyToUser('fern', 'AbC')).not.toBe(
      scopeSpeciesKeyToUser('fern', 'aBc')
    );
  });
});

/**
 * Species keying.
 *
 * The key names the dex document, the sprite object, the archive
 * de-duplication target and the stats hash, and it used to be
 * sanitizeSpeciesKey(whatever string Plant.id returned). That string is not
 * stable — the same plant comes back as "Fagraea fragrans", "Fagraea fragrans
 * Roxb." or, after a genus revision, "Cyrtophyllum fragrans" — so one species
 * became several, each with its own sprite, stats and first discoverer.
 */
describe('binomialKeyFor', () => {
  it.each([
    ['Fagraea fragrans Roxb.', 'fagraea_fragrans'],
    ['Fagraea fragrans', 'fagraea_fragrans'],
    ['Avicennia marina (Forsk.) Vierh. ssp. marina', 'avicennia_marina'],
    ['Lantana camara L.', 'lantana_camara'],
  ])('reduces %s to its binomial', (name, expected) => {
    expect(binomialKeyFor(name)).toBe(expected);
  });

  /**
   * The reason this is not data/almanac's almanacIdForSpecies, which reads
   * "Unknown Plant Species" as the binomial "unknown-plant". Truncating a
   * placeholder is harmless when the answer only looks up a fixed list; it is
   * not harmless when the answer names the record.
   */
  it.each([
    'Unknown Plant Species',
    'Mystery Fern',
    'Rose',
    'Plant Monster',
    '12345',
    '',
  ])('refuses to reduce %p', (name) => {
    expect(binomialKeyFor(name)).toBeNull();
  });
});

describe('speciesKeyCandidates', () => {
  it('prefers the taxon id, then the binomial, then the raw name', () => {
    expect(speciesKeyCandidates('Fagraea fragrans Roxb.', 'user-a', true, 5414325)).toEqual([
      'gbif_5414325',
      'fagraea_fragrans',
      'fagraea_fragrans_roxb',
    ]);
  });

  /* The whole point: two spellings of one plant agree on their first choice,
     so they file under one key however the identifier phrased itself. */
  it('agrees across spellings of the same taxon', () => {
    const withAuthority = speciesKeyCandidates('Fagraea fragrans Roxb.', 'user-a', true, 5414325);
    const withoutAuthority = speciesKeyCandidates('Fagraea fragrans', 'user-a', true, 5414325);
    // ...and across a genus revision, which no amount of string reduction can
    // reconcile: these two names share no word at all.
    const renamed = speciesKeyCandidates('Cyrtophyllum fragrans', 'user-a', true, 5414325);

    expect(withAuthority[0]).toBe(withoutAuthority[0]);
    expect(renamed[0]).toBe(withAuthority[0]);
  });

  it('falls back to the binomial when the identifier gave no taxon id', () => {
    expect(speciesKeyCandidates('Fagraea fragrans Roxb.', 'user-a', true, null)).toEqual([
      'fagraea_fragrans',
      'fagraea_fragrans_roxb',
    ]);
  });

  it('collapses to one candidate when the name is already the binomial', () => {
    expect(speciesKeyCandidates('Fern', 'user-a', true, null)).toEqual(['fern']);
  });

  it('never claims a taxon key for a placeholder identification', () => {
    const keys = speciesKeyCandidates('Fern', 'user-a', false, 5414325);

    expect(keys.every((key) => !key.startsWith(taxonSpeciesKey(5414325)))).toBe(true);
    expect(keys).toEqual([scopeSpeciesKeyToUser('fern', 'user-a')]);
  });

  it('scopes every candidate to the user when unidentified', () => {
    const keys = speciesKeyCandidates('Fagraea fragrans Roxb.', 'user-a', false, null);

    expect(keys).toEqual([
      scopeSpeciesKeyToUser('fagraea_fragrans', 'user-a'),
      scopeSpeciesKeyToUser('fagraea_fragrans_roxb', 'user-a'),
    ]);
  });

  it('yields nothing for a name with no usable characters', () => {
    expect(speciesKeyCandidates('   ', 'user-a', true, null)).toEqual([]);
  });
});

describe('persistScan species keying', () => {
  const IDENTIFIED_WITH_TAXON = { identified: true, source: 'mobile' as const, gbifId: 5414325 };

  it('files a new species under its taxon key', async () => {
    const dependencies = deps();

    await persistScan(
      dependencies,
      'user-a',
      'Fagraea fragrans Roxb.',
      null,
      PNG,
      IDENTIFIED_WITH_TAXON
    );

    expect(dependencies.storage.save).toHaveBeenCalledWith('gbif_5414325', PNG);
  });

  /**
   * The migration hazard this chain exists for. Everything discovered before
   * taxon keys is filed under a name. If a rescan simply took its preferred
   * key it would create a second document with a count of 1 and the rescanner
   * as first discoverer, orphaning the real record and its sprite.
   */
  it('stays on the key the species already lives under', async () => {
    const legacy = {
      speciesKey: 'fagraea_fragrans_roxb',
      speciesName: 'Fagraea fragrans Roxb.',
      firstDiscoveredBy: 'user-first',
      firstDiscoveredAt: '2026-01-01T00:00:00.000Z',
      discoveryCount: 4,
      spriteUrl: 'https://cdn.test/legacy.png',
    };
    const dependencies = deps();
    (dependencies.dex.findFirstExisting as jest.Mock).mockResolvedValue(legacy);

    await persistScan(
      dependencies,
      'user-b',
      'Fagraea fragrans Roxb.',
      null,
      PNG,
      IDENTIFIED_WITH_TAXON
    );

    expect(dependencies.dex.findFirstExisting).toHaveBeenCalledWith([
      'gbif_5414325',
      'fagraea_fragrans',
      'fagraea_fragrans_roxb',
    ]);
    expect(dependencies.storage.save).toHaveBeenCalledWith('fagraea_fragrans_roxb', PNG);
  });

  it('skips the lookup entirely when only one key is possible', async () => {
    const dependencies = deps();

    await persistScan(dependencies, 'user-a', 'Fern', null, PNG, {
      identified: true,
      source: 'mobile',
    });

    expect(dependencies.dex.findFirstExisting).not.toHaveBeenCalled();
    expect(dependencies.storage.save).toHaveBeenCalledWith('fern', PNG);
  });
});
