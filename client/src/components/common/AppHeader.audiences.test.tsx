import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import {
  AuthContext,
  type AuthContextValue,
  type AuthStatus,
} from '../../context/AuthContext';
import { NavigationLockProvider } from '../../context/NavigationLockProvider';
import type { AuthProfile } from '../../services/sproutApi';
import AppHeader from './AppHeader';

/**
 * Two navs, and three states a label can be in. The difference between
 * "greyed" and "absent" carries meaning, and the variant decides which applies:
 *
 *   greyed  — this nav is for you, but you must verify to use this tab
 *             (Scan, Archive, PVE Battle on the game nav)
 *   absent  — this nav is not where that lives, or no amount of signing in
 *             gets you there (the operator tools, anywhere)
 *
 * Showing an operator tool as disabled would read as "log in to access", which
 * is a lie. Greying the game tabs on the GAME nav is honest — verifying really
 * does open them. Showing them at all on the document nav is what stopped
 * making sense: a visitor reading the landing page was given three dead tabs
 * before they had any reason to want them.
 */

const PLAYER_TABS = ['Scan', 'Archive', 'PVE Battle'];
const DOCUMENT_TABS = ['Home', 'Almanac', 'Ranking', 'Contact'];
const OPERATOR_TABS = ['Studio', 'API Test', 'Ticket Manager', 'Admin'];

function authValue(
  status: AuthContextValue['status'],
  profile: AuthProfile | null
): AuthContextValue {
  return {
    status,
    firebaseUser: null,
    profile,
    login: vi.fn(),
    loginWithGoogle: vi.fn(),
    logout: vi.fn(),
    refreshProfile: vi.fn(),
  };
}

function profileFor(isAdmin: boolean): AuthProfile {
  return {
    uid: 'user-1',
    email: 'player@example.com',
    displayName: 'Player',
    emailVerified: true,
    isAdmin,
    isSuperAdmin: isAdmin,
  };
}

function renderNav(
  status: AuthStatus,
  profile: AuthProfile | null,
  variant: 'document' | 'game' = 'document'
) {
  render(
    <MemoryRouter>
      <AuthContext.Provider value={authValue(status, profile)}>
        <NavigationLockProvider>
          <AppHeader variant={variant} />
        </NavigationLockProvider>
      </AuthContext.Provider>
    </MemoryRouter>
  );
  return screen.getByRole('navigation', { name: /primary/i });
}

/** Present and clickable. */
function expectOpen(nav: HTMLElement, labels: string[]) {
  for (const label of labels) {
    expect(within(nav).getByRole('link', { name: label })).toBeInTheDocument();
  }
}

/** Present, but inert — rendered as a span rather than a link. */
function expectGreyed(nav: HTMLElement, labels: string[]) {
  for (const label of labels) {
    expect(within(nav).getByText(label)).toHaveAttribute('aria-disabled', 'true');
    expect(within(nav).queryByRole('link', { name: label })).not.toBeInTheDocument();
  }
}

function expectAbsent(nav: HTMLElement, labels: string[]) {
  for (const label of labels) {
    expect(within(nav).queryByText(label)).not.toBeInTheDocument();
  }
}

describe('AppHeader nav by audience', () => {
  it('gives a signed-out visitor the document tabs and none of the game', () => {
    const nav = renderNav('signed-out', null);

    expectOpen(nav, DOCUMENT_TABS);
    // Absent, not greyed. They belong to the other nav now.
    expectAbsent(nav, PLAYER_TABS);
    expectAbsent(nav, OPERATOR_TABS);
  });

  /* An unverified account has a session but cannot pass ProtectedRoute, so on
   * the game nav it gets the greyed tabs rather than live ones — showing Scan
   * as live would promise a page that immediately redirects to
   * /verify-email. */
  it('treats an unverified account as a visitor on the game nav', () => {
    const nav = renderNav('unverified', null, 'game');

    expectGreyed(nav, PLAYER_TABS);
    expectOpen(nav, ['Ranking']);
    expectAbsent(nav, OPERATOR_TABS);
  });

  it('greys the game tabs for a signed-out visitor who reaches a game page', () => {
    // Ranking is public but lives in the game shell, so this is reachable.
    const nav = renderNav('signed-out', null, 'game');

    expectGreyed(nav, PLAYER_TABS);
    expectOpen(nav, ['Ranking']);
  });

  it('opens the game to a verified player but still hides the tools', () => {
    const nav = renderNav('authenticated', profileFor(false), 'game');

    expectOpen(nav, [...PLAYER_TABS, 'Ranking']);
    expectAbsent(nav, OPERATOR_TABS);
  });

  it('shows the operator group on both navs, to a superadmin only', () => {
    expectOpen(renderNav('authenticated', profileFor(true)), [
      ...DOCUMENT_TABS,
      ...OPERATOR_TABS,
    ]);
    // Auto-cleanup runs between tests, not within one, and a second render
    // would leave two navs in the document for getByRole to choose between.
    cleanup();
    expectOpen(renderNav('authenticated', profileFor(true), 'game'), [
      ...PLAYER_TABS,
      ...OPERATOR_TABS,
    ]);
  });

  /** The almanac is public and belongs to the document half. A player reaches
   *  it from the Archive rather than from a fifth game tab. */
  it('puts Almanac on the document nav and not the game nav', () => {
    expectOpen(renderNav('signed-out', null), ['Almanac']);
    cleanup();
    expectAbsent(renderNav('authenticated', profileFor(false), 'game'), ['Almanac']);
  });

  it('orders each nav\'s own tabs first, then a divider, then the tools', () => {
    const labelsOf = (nav: HTMLElement) =>
      Array.from(nav.children).map((child) =>
        child.classList.contains('nav-divider') ? '|' : child.textContent
      );

    expect(labelsOf(renderNav('authenticated', profileFor(true)))).toEqual([
      'Home',
      'Almanac',
      'Ranking',
      'Contact',
      '|',
      'Admin',
      'Studio',
      'API Test',
      'Ticket Manager',
    ]);
  });

  it('orders the game nav the same way', () => {
    const nav = renderNav('authenticated', profileFor(true), 'game');
    const labels = Array.from(nav.children).map((child) =>
      child.classList.contains('nav-divider') ? '|' : child.textContent
    );
    expect(labels).toEqual([
      'Scan',
      'Archive',
      'PVE Battle',
      'Ranking',
      '|',
      'Admin',
      'Studio',
      'API Test',
      'Ticket Manager',
    ]);
  });

  /* The rule is drawn before the first tool in the rendered list, not at a
   * fixed index — so a nav with no tools must not end in a dangling rule. */
  it('draws no divider for a player, who has no tools to separate', () => {
    expect(
      renderNav('authenticated', profileFor(false)).querySelector('.nav-divider')
    ).toBeNull();
  });

  it('draws no divider for a signed-out visitor', () => {
    expect(renderNav('signed-out', null).querySelector('.nav-divider')).toBeNull();
  });

  /* API Test used to be public. It enumerates the API surface and fires real
   * requests at it, so it moved behind the grant with the other tools. */
  it('keeps API Test away from signed-out visitors and ordinary players', () => {
    expectAbsent(renderNav('signed-out', null), ['API Test']);
    cleanup();
    expectAbsent(renderNav('authenticated', profileFor(false), 'game'), ['API Test']);
  });
});
