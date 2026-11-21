import request from 'supertest';

const mockAuthAdmin = { verifyIdToken: jest.fn() };
const mockJudge = jest.fn();

jest.mock('../firebase', () => ({
  ...jest.requireActual('../firebase'),
  getAuthAdmin: () => mockAuthAdmin,
}));
jest.mock('../pipeline/stages/removeBg', () => ({
  removeBackgroundSafe: jest.fn().mockResolvedValue({ png: Buffer.from('cutout'), removeBgOk: true }),
}));
jest.mock('../pipeline/stages/finish', () => ({
  finishSprite: jest.fn().mockResolvedValue(Buffer.from('finished')),
}));
jest.mock('../pipeline/eval/programmatic', () => ({
  programmaticEval: jest.fn().mockResolvedValue({ paletteValid: true, dimsOk: true, notBlank: true }),
}));
jest.mock('../pipeline/eval/judge', () => ({ geminiJudgeEval: mockJudge }));
jest.mock('../services/scan-persistence', () => ({
  ...jest.requireActual('../services/scan-persistence'),
  persistScan: jest.fn().mockResolvedValue({
    saved: true, avatarId: 'test-avatar', saveError: null, discovery: null, candidate: null,
  }),
}));

import app from '../app';
import { TINY_JPEG_DATA_URL } from './fixtures/tiny-image';

const previousAllowlist = process.env.SUPER_ADMIN_EMAILS;
beforeAll(() => {
  process.env.SUPER_ADMIN_EMAILS = 'operator@sprout.test';
  mockAuthAdmin.verifyIdToken.mockResolvedValue({
    uid: 'test-operator', email: 'operator@sprout.test', email_verified: true,
  });
});
afterAll(() => {
  if (previousAllowlist === undefined) delete process.env.SUPER_ADMIN_EMAILS;
  else process.env.SUPER_ADMIN_EMAILS = previousAllowlist;
});

it.each([
  { cute: undefined, displayed: 'not scored', approved: false },
  { cute: 0, displayed: '0/5', approved: false },
  { cute: 2, displayed: '2/5', approved: false },
  { cute: 5, displayed: null, approved: true },
])('emits the actual judge result for $cute', async ({ cute, displayed, approved }) => {
  mockJudge.mockResolvedValue(cute === undefined ? {} : { judgeCute: cute });

  const response = await request(app)
    .post('/api/pipeline/run-stage2c')
    .set('Authorization', 'Bearer test-operator')
    .send({ rawSpriteB64: TINY_JPEG_DATA_URL, plantName: 'Fern', identified: true });
  const frames = response.text.split('\n\n').filter(Boolean)
    .map((chunk) => JSON.parse(chunk.replace(/^data:\s*/, '')));
  const evaluation = frames.find((frame) => frame.event === 'step_done' && frame.step === '4');

  expect(response.status).toBe(200);
  expect(evaluation).toBeDefined();
  expect(evaluation.evalScores.judgeCute).toBe(cute);
  expect(evaluation.autoApproved).toBe(approved);
  if (displayed) expect(evaluation.details).toContain(`Cute Judge: ${displayed}`);
  expect(frames.find((frame) => frame.event === 'complete')).toMatchObject({ saved: true });
});
