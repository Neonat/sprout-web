import { useState } from 'react';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AuthContext,
  type AuthContextValue,
} from '../../context/AuthContext';
import { NavigationLockProvider } from '../../context/NavigationLockProvider';
import type {
  AvatarRecord,
  BattleMove,
  BattleSession,
  PaginatedAvatars,
} from '../../services/sproutApi';
import BattlePage from '../../pages/BattlePage';
import AppHeader from './AppHeader';

const apiMocks = vi.hoisted(() => ({
  abandonPveBattle: vi.fn(),
  getPveBattle: vi.fn(),
  listOwnedAvatars: vi.fn(),
  startPveBattle: vi.fn(),
  submitPveAction: vi.fn(),
}));

vi.mock('../../services/sproutApi', () => apiMocks);

const moves: BattleMove[] = [
  {
    id: 'vine-tap',
    name: 'Vine Tap',
    kind: 'quick',
    power: 18,
    accuracy: 100,
    energyGain: 1,
    energyCost: 0,
  },
];

const ownedAvatar: AvatarRecord = {
  id: 'fern-1',
  userId: 'user-1',
  speciesName: 'Nephrolepis exaltata',
  speciesFamily: 'Nephrolepidaceae',
  spriteUrl: '/static/sprites/fern.png',
  discoveredAt: '2026-07-22T00:00:00.000Z',
  source: 'mobile',
  isTemporary: false,
  expiresAt: null,
  battleEligible: true,
  stats: { hp: 132, attack: 54, defense: 88, speed: 57 },
  metadata: { displayName: 'Fern Ward' },
};

const roster: PaginatedAvatars = {
  items: [ownedAvatar],
  total: 1,
  page: 1,
  pageSize: 100,
};

function battleSession(status: BattleSession['status'] = 'active'): BattleSession {
  return {
    id: status === 'active' ? 'battle-active' : 'battle-terminal',
    avatarId: ownedAvatar.id,
    status,
    phase: status === 'active' ? 'PLAYER_ACTION' : 'TERMINAL',
    turnNumber: 1,
    botIntent: status === 'active' ? 'building' : null,
    player: {
      id: ownedAvatar.id,
      name: 'Fern Ward',
      spriteUrl: ownedAvatar.spriteUrl,
      stats: ownedAvatar.stats,
      currentHp: 132,
      maxHp: 132,
      energy: 0,
      maxEnergy: 2,
      healUsed: false,
      moves,
    },
    bot: {
      id: 'thornback-v1',
      name: 'Thornback',
      spriteUrl: '',
      stats: { hp: 140, attack: 66, defense: 72, speed: 43 },
      currentHp: status === 'won' ? 0 : 140,
      maxHp: 140,
      energy: 0,
      maxEnergy: 2,
      healUsed: false,
    },
    log: [
      {
        turnNumber: 0,
        type: 'battle_started',
        actor: 'system',
        message: 'Battle started.',
      },
    ],
    xpAwarded: status === 'won' ? 20 : 0,
    createdAt: '2026-07-23T01:00:00.000Z',
    updatedAt: '2026-07-23T01:00:01.000Z',
    completedAt:
      status === 'active' ? null : '2026-07-23T01:00:02.000Z',
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const logout = vi.fn<() => Promise<void>>();

const authValue: AuthContextValue = {
  status: 'authenticated',
  firebaseUser: null,
  profile: {
    uid: 'user-1',
    email: 'owner@example.com',
    displayName: 'Owner',
    emailVerified: true,
    isAdmin: false,
    isSuperAdmin: false,
  },
  login: vi.fn(),
  loginWithGoogle: vi.fn(),
  logout,
  refreshProfile: vi.fn(),
};

function LocationProbe() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}

function TestShell({ allowBattleUnmount = false }) {
  const [showBattle, setShowBattle] = useState(true);

  return (
    <AuthContext.Provider value={authValue}>
      <NavigationLockProvider>
        {/* Battle is a game page, so the header under test is the game nav —
            Archive is the tab these tests lock and unlock. */}
        <AppHeader variant="game" />
        {allowBattleUnmount && (
          <button type="button" onClick={() => setShowBattle(false)}>
            Unmount battle view
          </button>
        )}
        {showBattle ? (
          <Routes>
            <Route path="/battle" element={<BattlePage />} />
            <Route path="/archive" element={<p>Owned archive destination</p>} />
            <Route path="/" element={<p>Home destination</p>} />
          </Routes>
        ) : (
          <p>Battle view unmounted</p>
        )}
        <LocationProbe />
      </NavigationLockProvider>
    </AuthContext.Provider>
  );
}

function renderIntegration(options: { allowBattleUnmount?: boolean } = {}) {
  const user = userEvent.setup();
  const view = render(
    <MemoryRouter
      initialEntries={[{ pathname: '/battle', state: { avatarId: ownedAvatar.id } }]}
    >
      <TestShell allowBattleUnmount={options.allowBattleUnmount} />
    </MemoryRouter>
  );
  return { ...view, user };
}

describe('battle navigation lock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    logout.mockResolvedValue();
    apiMocks.listOwnedAvatars.mockResolvedValue(roster);
  });

  it('locks all header and battle navigation while start is pending, then restores it', async () => {
    const pendingStart = deferred<BattleSession>();
    apiMocks.startPveBattle.mockReturnValueOnce(pendingStart.promise);
    const { user } = renderIntegration();

    await user.click(
      await screen.findByRole('button', { name: /start match/i })
    );

    const header = screen.getByRole('banner');
    expect(within(header).queryAllByRole('link')).toHaveLength(0);
    expect(
      within(header).getByText('Sprout').closest('.brand-link')
    ).toHaveAttribute('aria-disabled', 'true');
    const lockedArchive = within(header).getByText('Archive');
    expect(lockedArchive).toHaveAttribute('aria-disabled', 'true');
    await user.click(lockedArchive);
    expect(screen.getByTestId('location')).toHaveTextContent('/battle');

    const logoutButton = within(header).getByRole('button', {
      name: /log out/i,
    });
    expect(logoutButton).toBeDisabled();
    await user.click(logoutButton);
    expect(logout).not.toHaveBeenCalled();
    expect(screen.getByText('Return to Archive').closest('a')).toBeNull();

    const beforeUnload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(beforeUnload);
    expect(beforeUnload.defaultPrevented).toBe(true);

    await act(async () => {
      pendingStart.resolve(battleSession());
      await pendingStart.promise;
    });

    expect(
      await screen.findByRole('heading', { name: /turn 1/i })
    ).toBeInTheDocument();
    expect(
      within(header).getByRole('link', { name: 'Archive' })
    ).toBeInTheDocument();
    expect(logoutButton).toBeEnabled();

    const releasedBeforeUnload = new Event('beforeunload', {
      cancelable: true,
    });
    window.dispatchEvent(releasedBeforeUnload);
    expect(releasedBeforeUnload.defaultPrevented).toBe(false);

    await user.click(within(header).getByRole('link', { name: 'Archive' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/archive');
    await user.click(logoutButton);
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('locks the real header during replay and restores controls after rejection', async () => {
    const pendingReplay = deferred<BattleSession>();
    apiMocks.startPveBattle
      .mockResolvedValueOnce(battleSession('won'))
      .mockReturnValueOnce(pendingReplay.promise);
    const { user } = renderIntegration();

    await user.click(
      await screen.findByRole('button', { name: /start match/i })
    );
    await screen.findByRole('heading', { name: /victory/i });
    await user.click(screen.getByRole('button', { name: /replay/i }));

    const header = screen.getByRole('banner');
    expect(within(header).queryAllByRole('link')).toHaveLength(0);
    expect(
      within(header).getByRole('button', { name: /log out/i })
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: /change plant/i })
    ).toBeDisabled();

    await act(async () => {
      pendingReplay.reject(new Error('Replay unavailable'));
      await pendingReplay.promise.catch(() => undefined);
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Replay unavailable'
    );
    expect(
      within(header).getByRole('link', { name: 'Archive' })
    ).toBeInTheDocument();
    expect(
      within(header).getByRole('button', { name: /log out/i })
    ).toBeEnabled();
  });

  it('releases a pending start lock when BattlePage unmounts', async () => {
    const pendingStart = deferred<BattleSession>();
    apiMocks.startPveBattle.mockReturnValueOnce(pendingStart.promise);
    const { user } = renderIntegration({ allowBattleUnmount: true });

    await user.click(
      await screen.findByRole('button', { name: /start match/i })
    );
    expect(
      within(screen.getByRole('banner')).queryAllByRole('link')
    ).toHaveLength(0);

    await user.click(
      screen.getByRole('button', { name: /unmount battle view/i })
    );

    expect(
      within(screen.getByRole('banner')).getByRole('link', { name: 'Archive' })
    ).toBeInTheDocument();

    const releasedBeforeUnload = new Event('beforeunload', {
      cancelable: true,
    });
    window.dispatchEvent(releasedBeforeUnload);
    expect(releasedBeforeUnload.defaultPrevented).toBe(false);
  });
});
