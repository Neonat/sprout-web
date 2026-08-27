import request from 'supertest';
import { getDb } from '../firebase';
import { clearFirestore } from './firestore-test-utils';

const mockAuthAdmin = { verifyIdToken: jest.fn() };

jest.mock('../firebase', () => {
  const actual = jest.requireActual('../firebase');
  return { ...actual, getAuthAdmin: () => mockAuthAdmin };
});

import app from '../app';

const ADMIN_EMAIL = 'hello.sprout.team@gmail.com';
const ADMIN_UID = 'ops-admin';
const MEMBER_UID = 'ops-member';

let previousAdminEmails: string | undefined;
let previousAuthDevBypass: string | undefined;

const asAdmin = () => `Bearer verified:${ADMIN_UID}:${ADMIN_EMAIL}`;
const asMember = () => `Bearer verified:${MEMBER_UID}:${MEMBER_UID}@example.com`;

const HOUR = 60 * 60 * 1000;

async function seedAvatar(
  id: string,
  options: { isTemporary: boolean; expiresAt: string | null; speciesName?: string }
): Promise<void> {
  await getDb()
    .collection('avatar_records')
    .doc(id)
    .set({
      userId: MEMBER_UID,
      speciesName: options.speciesName ?? 'Fagraea fragrans',
      speciesFamily: 'Gentianaceae',
      spriteUrl: '/plants/SPRITE_Test.png',
      discoveredAt: '2026-07-01T00:00:00.000Z',
      source: options.isTemporary ? 'web' : 'mobile',
      isTemporary: options.isTemporary,
      expiresAt: options.expiresAt,
      stats: { hp: 100, attack: 50, defense: 50, speed: 50 },
      metadata: {},
    });
}

async function seedFixtures(): Promise<void> {
  const now = Date.now();
  await Promise.all([
    seedAvatar('expired-upload', {
      isTemporary: true,
      expiresAt: new Date(now - HOUR).toISOString(),
      speciesName: 'Expired Upload',
    }),
    seedAvatar('live-upload', {
      isTemporary: true,
      expiresAt: new Date(now + HOUR).toISOString(),
      speciesName: 'Live Upload',
    }),
    seedAvatar('kept-scan', {
      isTemporary: false,
      expiresAt: null,
      speciesName: 'Kept Scan',
    }),
  ]);
}

async function avatarIds(): Promise<string[]> {
  const snapshot = await getDb().collection('avatar_records').get();
  return snapshot.docs.map((doc) => doc.id).sort();
}

beforeEach(async () => {
  previousAdminEmails = process.env.SUPER_ADMIN_EMAILS;
  previousAuthDevBypass = process.env.AUTH_DEV_BYPASS;
  // /api/admin answers to the operator tier.
  process.env.SUPER_ADMIN_EMAILS = ADMIN_EMAIL;
  process.env.AUTH_DEV_BYPASS = 'false';

  mockAuthAdmin.verifyIdToken.mockReset();
  mockAuthAdmin.verifyIdToken.mockImplementation(async (token: string) => {
    const [kind, uid, email] = token.split(':');
    if (kind !== 'verified' || !uid) throw new Error('invalid test token');
    return { uid, email: email ?? `${uid}@example.com`, email_verified: true };
  });

  await clearFirestore();
});

afterEach(() => {
  if (previousAdminEmails === undefined) delete process.env.SUPER_ADMIN_EMAILS;
  else process.env.SUPER_ADMIN_EMAILS = previousAdminEmails;
  if (previousAuthDevBypass === undefined) delete process.env.AUTH_DEV_BYPASS;
  else process.env.AUTH_DEV_BYPASS = previousAuthDevBypass;
});

describe('admin almanac', () => {
  it('is closed to anonymous callers and to ordinary members', async () => {
    const anonymous = await request(app).get('/api/admin/almanac');
    const member = await request(app)
      .get('/api/admin/almanac')
      .set('Authorization', asMember());

    expect(anonymous.status).toBe(401);
    expect(member.status).toBe(403);
  });

  it('returns the whole taxonomy with discovery detail', async () => {
    const response = await request(app)
      .get('/api/admin/almanac')
      .set('Authorization', asAdmin());

    expect(response.status).toBe(200);
    expect(response.body.total).toBe(50);
    expect(response.body.species).toHaveLength(50);
    // Sprite and stats, not the finder: uid-to-name resolution is per species
    // and the admin view lists all 50, so it stays a per-card lookup.
    expect(response.body.species[0]).toHaveProperty('spriteUrl');
    expect(response.body.species[0]).toHaveProperty('stats');
    expect(response.body.offTaxonomy).toEqual([]);
    expect(response.body.source).toContain('Chong');
  });

  // Anything a player scanned that is not one of the 200 is the signal that the
  // taxonomy needs extending, so it must not be silently dropped.
  it('surfaces discoveries made outside the taxonomy', async () => {
    await getDb().collection('dex').doc('monstera_deliciosa').set({
      speciesKey: 'monstera_deliciosa',
      speciesName: 'Monstera deliciosa',
      firstDiscoveredBy: MEMBER_UID,
      firstDiscoveredAt: '2026-08-01T00:00:00.000Z',
      discoveryCount: 3,
      spriteUrl: 'https://cdn.test/monstera.png',
    });

    const response = await request(app)
      .get('/api/admin/almanac')
      .set('Authorization', asAdmin());

    expect(response.body.offTaxonomy).toEqual([
      {
        speciesKey: 'monstera_deliciosa',
        speciesName: 'Monstera deliciosa',
        discoveredAt: '2026-08-01T00:00:00.000Z',
        discoveryCount: 3,
      },
    ]);
  });
});

describe('admin cleanup', () => {
  it('is closed to anonymous callers and to ordinary members', async () => {
    const anonymous = await request(app)
      .post('/api/admin/cleanup')
      .send({ target: 'expired-temp-avatars' });
    const member = await request(app)
      .post('/api/admin/cleanup')
      .set('Authorization', asMember())
      .send({ target: 'expired-temp-avatars' });

    expect(anonymous.status).toBe(401);
    expect(member.status).toBe(403);
  });

  it('defaults to a dry run that deletes nothing', async () => {
    await seedFixtures();

    const response = await request(app)
      .post('/api/admin/cleanup')
      .set('Authorization', asAdmin())
      .send({ target: 'expired-temp-avatars' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      target: 'expired-temp-avatars',
      dryRun: true,
      matched: 1,
      deleted: 0,
    });
    expect(response.body.sample).toEqual([
      { id: 'expired-upload', label: 'Expired Upload', detail: expect.any(String) },
    ]);
    expect(await avatarIds()).toEqual(['expired-upload', 'kept-scan', 'live-upload']);
  });

  it('refuses to delete without a matching confirmation', async () => {
    await seedFixtures();

    const response = await request(app)
      .post('/api/admin/cleanup')
      .set('Authorization', asAdmin())
      .send({ target: 'expired-temp-avatars', dryRun: false });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe(
      'Deleting requires confirmTarget to match the target.'
    );
    expect(await avatarIds()).toHaveLength(3);
  });

  it('deletes only the expired uploads once confirmed', async () => {
    await seedFixtures();

    const response = await request(app)
      .post('/api/admin/cleanup')
      .set('Authorization', asAdmin())
      .send({
        target: 'expired-temp-avatars',
        dryRun: false,
        confirmTarget: 'expired-temp-avatars',
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ dryRun: false, matched: 1, deleted: 1 });
    // A live upload has not run out yet, and a camera scan never does.
    expect(await avatarIds()).toEqual(['kept-scan', 'live-upload']);
  });

  it('rejects an unknown target', async () => {
    const response = await request(app)
      .post('/api/admin/cleanup')
      .set('Authorization', asAdmin())
      .send({ target: 'everything', dryRun: false, confirmTarget: 'everything' });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Unknown cleanup target');
  });
});
