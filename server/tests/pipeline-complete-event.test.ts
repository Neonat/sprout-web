/** The pipeline's `complete` frame, asserted at the wire.
 *
 *  This is where the discovery-shape bug lived and where only a boundary test
 *  could have caught it: the route put `persistScan`'s raw dex record on the
 *  stream — `{ speciesKey, speciesName, firstDiscoveredBy, ... }` — while the
 *  client read `{ firstDiscoveredByName, isFirstDiscoverer, ... }`. Both sides
 *  had passing tests. Nothing tested the frame between them, so "You discovered
 *  this first!" could never render and another user's Firebase UID shipped to
 *  the browser on every scan.
 *
 *  The upstream hops are mocked: this file is about what the route emits, not
 *  about sprite rendering, and every real stage either costs a network call or
 *  seconds of sharp work. Persistence itself is real, against the emulator.
 */
import request from 'supertest';

const mockAuthAdmin = { verifyIdToken: jest.fn() };
const mockIdentifyPlant = jest.fn();
/** Species keys handed to sprite storage, in call order. */
const mockSpriteSaves: string[] = [];
/* Handles on the two paid hops the dex cache gate exists to skip. The rest of
   the stages stay anonymous mocks — these are the ones a test needs to prove
   were never reached. */
const mockCraftPromptTiered = jest.fn();
const mockGenerateSprite = jest.fn();

jest.mock('../firebase', () => {
  const actual = jest.requireActual('../firebase');
  return { ...actual, getAuthAdmin: () => mockAuthAdmin };
});

jest.mock('../pipeline/stages/identify', () => {
  const actual = jest.requireActual('../pipeline/stages/identify');
  return { ...actual, identifyPlant: mockIdentifyPlant };
});

jest.mock('../pipeline/stages/promptCraft', () => ({
  craftPromptTiered: mockCraftPromptTiered,
}));

jest.mock('../pipeline/stages/generate', () => ({
  generateSprite: mockGenerateSprite,
}));

jest.mock('../pipeline/stages/removeBg', () => ({
  removeBackgroundSafe: jest
    .fn()
    .mockResolvedValue({ png: Buffer.from('cutout'), removeBgOk: true }),
}));

jest.mock('../pipeline/stages/finish', () => ({
  finishSprite: jest.fn().mockResolvedValue(Buffer.from('finished-sprite')),
  cropPhoto: jest.fn().mockResolvedValue(Buffer.from('cropped')),
}));

jest.mock('../pipeline/eval/programmatic', () => ({
  programmaticEval: jest.fn().mockResolvedValue({}),
}));

jest.mock('../pipeline/eval/judge', () => ({
  geminiJudgeEval: jest.fn().mockResolvedValue({}),
}));

jest.mock('../services/sprite-storage', () => ({
  __esModule: true,
  default: () => ({
    save: async (speciesKey: string) => {
      mockSpriteSaves.push(speciesKey);
      return { url: `https://cdn.test/${speciesKey}.png`, created: true };
    },
    saveVersion: async (speciesKey: string, version: number) =>
      `https://cdn.test/${speciesKey}-v${version}.png`,
  }),
}));

import app from '../app';
import dexRepository from '../repositories/dex';
import { clearFirestore, seedFirestoreUser } from './firestore-test-utils';
import { TINY_JPEG_DATA_URL } from './fixtures/tiny-image';

const SCANNER = 'user-scanner';
const FINDER = 'user-finder';

let previousAuthDevBypass: string | undefined;
let previousPlantApiKey: string | undefined;

interface PipelineFrame {
  event: string;
  [key: string]: unknown;
}

/** Runs a full scan and returns the SSE frames it wrote, plus the raw body. */
async function runScan(
  uid: string,
  body: Record<string, unknown> = {}
): Promise<{ frames: PipelineFrame[]; raw: string }> {
  const response = await request(app)
    .post('/api/pipeline/run-stream')
    .set('Authorization', `Bearer verified:${uid}`)
    /* A real 32x32 JPEG, not a placeholder. The route validates the upload
       before the pipeline starts (pipeline/ingest/imageIngest), so the old
       `data:image/jpeg;base64,AAAA` is now correctly refused and no `complete`
       frame is ever emitted. The upstream hops stay mocked; only the bytes had
       to become genuine. */
    .send({ imageBase64: TINY_JPEG_DATA_URL, pauseAt2b: false, ...body });

  expect(response.status).toBe(200);
  const frames = response.text
    .split('\n\n')
    .map((chunk) => chunk.match(/^data:\s*(.*)$/m))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map((match) => JSON.parse(match[1]) as PipelineFrame);

  return { frames, raw: response.text };
}

function completeFrame(frames: PipelineFrame[]): PipelineFrame {
  const frame = frames.find((candidate) => candidate.event === 'complete');
  expect(frame).toBeDefined();
  return frame!;
}

beforeEach(async () => {
  previousAuthDevBypass = process.env.AUTH_DEV_BYPASS;
  previousPlantApiKey = process.env.PLANT_API_KEY;
  process.env.AUTH_DEV_BYPASS = 'false';
  // A configured key is what makes identifyPlant's answer a real one; without
  // it the route treats every identification as the keyless mock (see below).
  process.env.PLANT_API_KEY = 'test-plant-key';

  mockAuthAdmin.verifyIdToken.mockReset();
  mockAuthAdmin.verifyIdToken.mockImplementation(async (token: string) => {
    const [kind, uid] = token.split(':');
    if (kind !== 'verified' || !uid) throw new Error('invalid test token');
    return { uid, email: `${uid}@example.com`, email_verified: true };
  });

  mockIdentifyPlant.mockReset();
  mockIdentifyPlant.mockResolvedValue({
    name: 'Fern',
    probability: 0.93,
    common_names: ['fern'],
    taxonomy: { kingdom: 'Plantae', family: 'Polypodiaceae' },
  });

  mockCraftPromptTiered.mockReset();
  mockCraftPromptTiered.mockResolvedValue({ prompt: 'a cute fern', tier: 'gemini' });
  mockGenerateSprite.mockReset();
  mockGenerateSprite.mockResolvedValue({
    png: Buffer.from('raw-sprite'),
    model: 'test-model',
    fromModel: true,
  });

  mockSpriteSaves.length = 0;
  await clearFirestore();
});

afterEach(() => {
  if (previousAuthDevBypass === undefined) delete process.env.AUTH_DEV_BYPASS;
  else process.env.AUTH_DEV_BYPASS = previousAuthDevBypass;
  if (previousPlantApiKey === undefined) delete process.env.PLANT_API_KEY;
  else process.env.PLANT_API_KEY = previousPlantApiKey;
});

describe('pipeline complete event discovery block', () => {
  it('emits the resolved discoverer name and never the raw UID', async () => {
    await seedFirestoreUser({
      id: FINDER,
      email: 'finder@example.test',
      displayName: 'Justin',
      isVerified: true,
    });
    await dexRepository.recordDiscovery('fern', FINDER, 'Fern');

    const { frames, raw } = await runScan(SCANNER);
    const complete = completeFrame(frames);

    expect(complete.saved).toBe(true);
    expect(complete.discovery).toEqual({
      firstDiscoveredByName: 'Justin',
      firstDiscoveredAt: expect.any(String),
      discoveryCount: 2,
      isFirstDiscoverer: false,
    });
    // The three fields the old wire shape carried, none of which any client
    // reads, and one of which is another account's identifier.
    expect(complete.discovery).not.toHaveProperty('firstDiscoveredBy');
    expect(complete.discovery).not.toHaveProperty('speciesKey');
    expect(raw).not.toContain(FINDER);
    expect(raw).not.toContain('finder@example.test');
  });

  it('marks the scanner when they are the first discoverer', async () => {
    await seedFirestoreUser({
      id: SCANNER,
      email: 'scanner@example.test',
      displayName: 'Zhi Feng',
      isVerified: true,
    });

    const { frames } = await runScan(SCANNER);
    const discovery = completeFrame(frames).discovery as Record<string, unknown>;

    expect(discovery.isFirstDiscoverer).toBe(true);
    expect(discovery.firstDiscoveredByName).toBe('Zhi Feng');
  });

  it('emits discovery: null rather than failing when the profile is missing', async () => {
    const { frames } = await runScan(SCANNER);
    const complete = completeFrame(frames);

    expect(complete.saved).toBe(true);
    expect(complete.avatarId).toBeTruthy();
    expect(complete.discovery).toBeNull();
  });
});

describe('pipeline complete event species scoping', () => {
  it('keeps a real identification canonical across users', async () => {
    await runScan(SCANNER);
    await runScan(FINDER);

    /* One save, not two. The species is canonical across users exactly as
       before — what changed is where that is decided. Storage used to be
       asked on every scan and quietly decline the second write, after the
       render had already been paid for; the dex cache gate now answers before
       the first paid call, so the second scanner never reaches storage. */
    expect(mockSpriteSaves).toEqual(['fern']);
  });

  /**
   * A failed identification used to become "Unknown Plant Species" and run to
   * completion — a render, a cutout and a judge call spent on a name nobody
   * chose, then filed under a label that says nothing. It stops and asks now,
   * so there is no sprite to scope until the player has answered.
   */
  it('stops and asks rather than generating for a plant it could not name', async () => {
    mockIdentifyPlant.mockResolvedValue({ error: 'Not identified as a plant.', needsName: true });

    const { frames } = await runScan(SCANNER);

    expect(frames.map((f) => f.event)).toContain('needs_name');
    expect(frames.map((f) => f.event)).not.toContain('complete');
    expect(mockSpriteSaves).toHaveLength(0);
  });

  it('scopes the named retry to the scanning user', async () => {
    mockIdentifyPlant.mockResolvedValue({ error: 'Not identified as a plant.', needsName: true });

    // What the naming dialog sends back on the second run.
    await runScan(SCANNER, { customName: 'Mystery Fern' });

    expect(mockSpriteSaves[0]).toContain('mystery_fern');
  });

  it('scopes the keyless mock identification to the scanning user', async () => {
    // The mock path reports high confidence for one hardcoded species on every
    // photo, so from the route it is indistinguishable from a real success —
    // except by the absence of the key that selects it.
    delete process.env.PLANT_API_KEY;
    delete process.env.PLANTID_API_KEY;

    await runScan(SCANNER);
    await runScan(FINDER);

    expect(mockSpriteSaves[0]).toContain('fern__u_');
    expect(mockSpriteSaves[0]).not.toBe(mockSpriteSaves[1]);
  });

  it('treats a name the player typed as a real species even in mock mode', async () => {
    delete process.env.PLANT_API_KEY;
    delete process.env.PLANTID_API_KEY;

    await runScan(SCANNER, { customName: 'Monstera deliciosa' });
    await runScan(FINDER, { customName: 'Monstera deliciosa' });

    /* One save, then a cache hit — and the hit is itself the proof. A typed
       name that had been scoped per user would produce two different keys,
       miss the cache and save a second object; sharing the canonical key is
       exactly why the second scanner never reaches storage. */
    expect(mockSpriteSaves).toEqual(['monstera_deliciosa']);
    expect(mockSpriteSaves[0]).not.toContain('__u_');
  });
});

/**
 * The dex cache gate.
 *
 * The pipeline spec has always said "cache hit calls no generation provider",
 * and until now nothing did: the only question ever asked about an
 * already-known species was asked by persistScan, after prompt crafting,
 * rendering, cutout, finishing and the judge had all been paid for. Storage
 * then declined to write a second object and the render was discarded. The
 * dedupe was real; the saving was not.
 *
 * These tests pin both halves — that a hit skips the paid hops, and that the
 * two surfaces which legitimately need a fresh render still get one.
 */
describe('pipeline dex cache gate', () => {
  const PUBLISHED = 'https://cdn.test/fern/v1.png';

  it('reuses the published sprite and calls no generation provider', async () => {
    await dexRepository.recordDiscovery('fern', FINDER, 'Fern', PUBLISHED);

    const { frames } = await runScan(SCANNER);
    const complete = completeFrame(frames);

    expect(complete.spriteReused).toBe(true);
    expect(complete.finalSpriteUrl).toBe(PUBLISHED);
    // The generating path's field must be absent, not empty — the client picks
    // its branch on the url being present.
    expect(complete).not.toHaveProperty('finalSpriteB64');

    expect(mockCraftPromptTiered).not.toHaveBeenCalled();
    expect(mockGenerateSprite).not.toHaveBeenCalled();
    expect(mockSpriteSaves).toHaveLength(0);

    // A reused sprite is still a scan: the player gets their archive record
    // and the species' discovery count moves.
    expect(complete.saved).toBe(true);
    expect(complete.avatarId).toBeTruthy();
    expect((await dexRepository.get('fern'))?.discoveryCount).toBe(2);
  });

  it('files no candidate, because nothing new was drawn', async () => {
    await dexRepository.recordDiscovery('fern', FINDER, 'Fern', PUBLISHED);

    const complete = completeFrame((await runScan(SCANNER)).frames);

    // Filing the incumbent back as a candidate would queue the published
    // sprite to compete against itself in the dex gate.
    expect(complete.candidate).toBeNull();
  });

  it('returns the currently published sprite, not the first one ever drawn', async () => {
    // What the dex holds after a superadmin publishes a later candidate.
    const laterCandidate = 'https://cdn.test/fern/v3.png';
    await dexRepository.recordDiscovery('fern', FINDER, 'Fern', laterCandidate);

    const complete = completeFrame((await runScan(SCANNER)).frames);

    /* Deriving the object path from the species key would have answered
       sprites/fern/v1.png here — art the archive and almanac no longer show.
       The gate reads dex.spriteUrl precisely so it cannot drift from them. */
    expect(complete.finalSpriteUrl).toBe(laterCandidate);
  });

  it('generates when the species is known but carries no sprite', async () => {
    // A dex record written before the dex carried sprite urls at all.
    await dexRepository.recordDiscovery('fern', FINDER, 'Fern', '');

    const complete = completeFrame((await runScan(SCANNER)).frames);

    expect(mockGenerateSprite).toHaveBeenCalled();
    expect(complete.spriteReused).toBeUndefined();
    expect(complete.finalSpriteB64).toBeTruthy();
    expect(mockSpriteSaves).toEqual(['fern']);
  });

  it('generates for a species nobody has scanned', async () => {
    const complete = completeFrame((await runScan(SCANNER)).frames);

    expect(mockGenerateSprite).toHaveBeenCalled();
    expect(complete.finalSpriteB64).toBeTruthy();
  });

  /**
   * The studio's manual run exists to produce a NEW render for the dex gate to
   * judge. If it took the cache too, the gate would have nothing to review and
   * a bad first sprite could never be replaced — the cache would make itself
   * permanent.
   */
  it('still generates for the studio run, so the dex gate keeps a candidate supply', async () => {
    await dexRepository.recordDiscovery('fern', FINDER, 'Fern', PUBLISHED);

    const { frames } = await runScan(SCANNER, { pauseAt2b: true });

    expect(mockGenerateSprite).toHaveBeenCalled();
    expect(frames.map((frame) => frame.event)).toContain(
      'awaiting_stage2c_confirmation'
    );
  });

  it('honours an explicit forceRegenerate from the game side', async () => {
    await dexRepository.recordDiscovery('fern', FINDER, 'Fern', PUBLISHED);

    const complete = completeFrame(
      (await runScan(SCANNER, { forceRegenerate: true })).frames
    );

    expect(mockGenerateSprite).toHaveBeenCalled();
    expect(complete.spriteReused).toBeUndefined();
    expect(complete.finalSpriteB64).toBeTruthy();
  });

  /**
   * Mock-mode scans are user-scoped (`fern__u_<hex uid>`) so two users'
   * placeholder plants never share a sprite. The gate must key on exactly the
   * same scoped key, or a rescan would miss its own cache — or worse, hit
   * somebody else's.
   */
  it('scopes the lookup to the user when the identification is a placeholder', async () => {
    delete process.env.PLANT_API_KEY;
    mockIdentifyPlant.mockResolvedValue({
      name: 'Fern',
      probability: 0.92,
      common_names: ['fern'],
      taxonomy: { kingdom: 'Plantae', family: 'Polypodiaceae' },
    });

    // Another user's scoped record for the same species name must not match.
    const otherKey = `fern__u_${Buffer.from(FINDER, 'utf8').toString('hex')}`;
    await dexRepository.recordDiscovery(otherKey, FINDER, 'Fern', PUBLISHED);

    const complete = completeFrame((await runScan(SCANNER)).frames);

    expect(complete.spriteReused).toBeUndefined();
    expect(mockGenerateSprite).toHaveBeenCalled();
    expect(mockSpriteSaves).toEqual([
      `fern__u_${Buffer.from(SCANNER, 'utf8').toString('hex')}`,
    ]);
  });
});
