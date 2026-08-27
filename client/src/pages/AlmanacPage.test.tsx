import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AlmanacPage from './AlmanacPage';
import type { AlmanacEntry, AlmanacSummary } from '../services/sproutApi';

/**
 * The almanac page.
 *
 * Both halves of it existed and neither was reachable: the grid was written
 * with a dark tone "for the landing page", `GET /api/almanac` was built public
 * on purpose, and the only caller of either was the admin dashboard. These
 * tests hold the page in place — that it fetches on mount, that a visitor can
 * read it without a session, and that the fetch the grid deliberately does not
 * do (sprites) happens on open instead.
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

function entry(overrides: Partial<AlmanacEntry> = {}): AlmanacEntry {
  return {
    id: 'mimosa-pudica',
    speciesName: 'Mimosa pudica',
    commonName: 'Touch-me-not',
    family: 'Fabaceae',
    status: 'naturalised',
    origin: 'exotic',
    growthForm: 'shrub',
    discovered: false,
    discoveryCount: 0,
    ...overrides,
  };
}

const SUMMARY: AlmanacSummary = {
  source: 'Chong, Tan & Corlett (2009).',
  total: 2,
  discovered: 1,
  species: [
    entry({ discovered: true, discoveryCount: 3 }),
    entry({
      id: 'albizia-saman',
      speciesName: 'Albizia saman',
      commonName: 'Rain tree',
      growthForm: 'tree',
    }),
  ],
};

function renderPage() {
  return render(
    <MemoryRouter>
      <AlmanacPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  authMocks.status = 'unauthenticated';
  apiMocks.getAlmanac.mockResolvedValue(SUMMARY);
});

describe('almanac page', () => {
  it('fetches the almanac and reports the tally to a signed-out visitor', async () => {
    renderPage();

    expect(await screen.findByText('1 of 2 found')).toBeInTheDocument();
    // Public by design — the endpoint is unauthenticated so a visitor can see
    // what the game is about before signing up.
    expect(apiMocks.getAlmanac).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { level: 1, name: /almanac/i })).toBeInTheDocument();
  });

  it('leads each card with the common name', async () => {
    renderPage();

    // The card flip only became safe once every species had one; if a card is
    // ever nameless this is what notices.
    expect(await screen.findByText('Touch-me-not')).toBeInTheDocument();
    expect(screen.getByText('Rain tree')).toBeInTheDocument();
  });

  it('filters on the common name, not just the binomial', async () => {
    renderPage();
    await screen.findByText('Touch-me-not');

    await userEvent.type(screen.getByRole('searchbox'), 'rain');

    expect(screen.getByText('Rain tree')).toBeInTheDocument();
    expect(screen.queryByText('Touch-me-not')).not.toBeInTheDocument();
  });

  it('opens a found species and fetches the record the grid does not carry', async () => {
    apiMocks.getAlmanacEntry.mockResolvedValue({
      ...SUMMARY.species[0],
      spriteUrl: 'https://cdn.test/mimosa.png',
      stats: { hp: 120, attack: 50, defense: 60, speed: 40 },
    });
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: /Mimosa pudica/i }));

    await waitFor(() =>
      expect(apiMocks.getAlmanacEntry).toHaveBeenCalledWith('mimosa-pudica')
    );
    expect(
      await screen.findByRole('region', { name: /Mimosa pudica record/i })
    ).toBeInTheDocument();
  });

  it('reports a failed load rather than showing an empty almanac', async () => {
    // extractApiError keeps a client-side Error's own message — it was written
    // for a human somewhere up the stack — and only falls back when there is
    // nothing to keep. Both branches reach the same alert.
    apiMocks.getAlmanac.mockRejectedValue(new Error('Network unreachable'));
    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent('Network unreachable');
    expect(screen.queryByText(/of .* found/)).not.toBeInTheDocument();
  });

  it('falls back to its own copy when the failure carries no message', async () => {
    apiMocks.getAlmanac.mockRejectedValue(new Error(''));
    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load the almanac/i);
  });
});
