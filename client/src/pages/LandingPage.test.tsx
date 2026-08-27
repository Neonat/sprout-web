import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LandingPage from './LandingPage';

/**
 * The almanac is not on this page, and these tests hold that in place: the
 * landing page still renders, and it neither shows the grid nor asks the API
 * for it.
 *
 * That used to mean the feature was shelved. It no longer does — the almanac
 * came back as a page of its own at `/almanac`, reached from the nav, with its
 * own suite in AlmanacPage.test.tsx. What this file now pins is the division:
 * the landing page stays one fetch lighter on the first screen a visitor sees,
 * and the grid lives where someone has chosen to go and look at it.
 */

const apiMocks = vi.hoisted(() => ({
  getAlmanac: vi.fn(),
  getAlmanacEntry: vi.fn(),
}));
const authMocks = vi.hoisted(() => ({ status: 'unauthenticated' as string }));

vi.mock('../services/sproutApi', () => apiMocks);
vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ status: authMocks.status }),
}));

function renderLanding() {
  return render(
    <MemoryRouter>
      <LandingPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  authMocks.status = 'unauthenticated';
});

describe('landing page', () => {
  it('renders the hero for a signed-out visitor', async () => {
    renderLanding();

    expect(
      await screen.findByRole('heading', { name: /turn the plants around you/i })
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /start scanning/i })).toBeInTheDocument();
  });

  it('sends a signed-in visitor to the app instead of the sign-up', () => {
    authMocks.status = 'authenticated';
    renderLanding();

    // Both the hero and the closing call to action carry it.
    expect(screen.getAllByRole('link', { name: /open sprout/i })).toHaveLength(2);
    expect(screen.queryByRole('link', { name: /start scanning/i })).not.toBeInTheDocument();
  });

  it('shows no almanac section and never fetches one', () => {
    renderLanding();

    expect(screen.queryByText(/the almanac/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/search the almanac/i)).not.toBeInTheDocument();
    expect(apiMocks.getAlmanac).not.toHaveBeenCalled();
  });
});

/**
 * The hero and its footnote — the first thing a signed-out visitor reads, and
 * the only place the marketing copy lives.
 */
describe('LandingPage hero', () => {
  it('offers sign up before log in, matching the header order', async () => {
    renderLanding();

    const signUp = await screen.findByRole('link', {
      name: /start scanning \(sign up\)/i,
    });
    const logIn = screen.getByRole('link', { name: /i have an account/i });

    expect(signUp).toHaveAttribute('href', '/signup');
    expect(logIn).toHaveAttribute('href', '/login');
    // Sign up first in the DOM, so it is first for a keyboard and a reader too.
    expect(signUp.compareDocumentPosition(logIn)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
  });

  /* Two of these — the hero and the closing call to action. Both must lead to
   * Scan; one still pointing at the archived /home hub would be a dead end. */
  it('sends a signed-in visitor straight to Scan rather than to sign up', async () => {
    authMocks.status = 'authenticated';
    renderLanding();

    const opens = await screen.findAllByRole('link', { name: /open sprout/i });
    expect(opens.length).toBeGreaterThan(0);
    for (const link of opens) expect(link).toHaveAttribute('href', '/scan');
    expect(
      screen.queryByRole('link', { name: /start scanning \(sign up\)/i })
    ).toBeNull();
  });

  /* PVE Battle points at /battle unconditionally: ProtectedRoute carries the
   * path to /login, so signing in lands the visitor on the screen they clicked
   * rather than back here. */
  it('links the footnote to the battle screen and to login', async () => {
    renderLanding();

    expect(await screen.findByRole('link', { name: 'PVE Battle' })).toHaveAttribute(
      'href',
      '/battle'
    );
    expect(screen.getByRole('link', { name: 'Login' })).toHaveAttribute(
      'href',
      '/login'
    );
  });

  it('describes the plant as a Plantemon, not a sprite or a creature', async () => {
    renderLanding();

    expect(
      await screen.findByText(/into Plantemon that fight/i)
    ).toBeInTheDocument();
    // Hero paragraph and the "Grow" step both use it.
    expect(screen.getAllByText(/pixel-art Plantemon/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/creatures that fight/i)).toBeNull();
  });
});
