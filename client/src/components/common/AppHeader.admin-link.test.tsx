import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '../../context/AuthContext';
import { NavigationLockProvider } from '../../context/NavigationLockProvider';
import type { AuthProfile } from '../../services/sproutApi';
import AppHeader from './AppHeader';

/** The operator entries — Admin, Studio, API Test — are the only nav items that
 *  are hidden rather than disabled for someone who cannot use them. A disabled
 *  item reads "Log in to access", which would be false for a signed-in player:
 *  nothing they can do gets them past the server's SUPER_ADMIN_EMAILS
 *  allowlist. */

const OPERATOR_LINKS = ['Admin', 'Studio', 'API Test'] as const;

function authValue(profile: AuthProfile | null): AuthContextValue {
  return {
    status: profile ? 'authenticated' : 'signed-out',
    firebaseUser: null,
    profile,
    login: vi.fn(),
    loginWithGoogle: vi.fn(),
    logout: vi.fn(),
    refreshProfile: vi.fn(),
  };
}

function profileFor({
  isAdmin = false,
  isSuperAdmin = false,
}: {
  isAdmin?: boolean;
  isSuperAdmin?: boolean;
}): AuthProfile {
  return {
    uid: 'user-1',
    email: isSuperAdmin ? 'sprout@gmail.com' : 'player@example.com',
    displayName: isSuperAdmin ? 'Sprout Admin' : 'Player',
    emailVerified: true,
    isAdmin: isAdmin || isSuperAdmin,
    isSuperAdmin,
  };
}

function renderHeader(profile: AuthProfile | null) {
  return render(
    <MemoryRouter>
      <AuthContext.Provider value={authValue(profile)}>
        <NavigationLockProvider>
          {/* The game nav: this file asserts on the operator group and on
              Scan being live for a player, and both live there. */}
          <AppHeader variant="game" />
        </NavigationLockProvider>
      </AuthContext.Provider>
    </MemoryRouter>
  );
}

describe('AppHeader operator links', () => {
  it('offers the operator tools to a super admin', () => {
    renderHeader(profileFor({ isSuperAdmin: true }));

    const nav = screen.getByRole('navigation', { name: /primary/i });
    expect(within(nav).getByRole('link', { name: 'Admin' })).toHaveAttribute(
      'href',
      '/admin'
    );
    expect(within(nav).getByRole('link', { name: 'Studio' })).toHaveAttribute(
      'href',
      '/studio'
    );
    expect(within(nav).getByRole('link', { name: 'API Test' })).toHaveAttribute(
      'href',
      '/test'
    );
  });

  it('hides them from a signed-in player entirely', () => {
    renderHeader(profileFor({}));

    const nav = screen.getByRole('navigation', { name: /primary/i });
    for (const label of OPERATOR_LINKS) {
      expect(within(nav).queryByText(label)).not.toBeInTheDocument();
    }
    // The player's own nav is untouched.
    expect(within(nav).getByRole('link', { name: 'Scan' })).toBeInTheDocument();
  });

  it('hides them from a plain admin — the tools answer to the operator tier', () => {
    renderHeader(profileFor({ isAdmin: true }));

    const nav = screen.getByRole('navigation', { name: /primary/i });
    for (const label of OPERATOR_LINKS) {
      expect(within(nav).queryByText(label)).not.toBeInTheDocument();
    }
  });

  it('hides them from a signed-out visitor', () => {
    renderHeader(null);

    const nav = screen.getByRole('navigation', { name: /primary/i });
    for (const label of OPERATOR_LINKS) {
      expect(within(nav).queryByText(label)).not.toBeInTheDocument();
    }
  });
});
