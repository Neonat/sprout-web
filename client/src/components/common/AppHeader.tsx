import { Fragment } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useNavigationLock } from '../../hooks/useNavigationLock';
import { SproutMark } from './PlantVisuals';

interface NavItem {
  to: string;
  label: string;
  requiresAuth: boolean;
  /** Hidden from non-superadmins rather than shown disabled: the disabled
   *  state reads as "log in to access", which would be a lie here — no amount
   *  of logging in gets a player the operator tools. */
  requiresSuperAdmin?: boolean;
}

/**
 * Two navs, chosen by which shell is rendering.
 *
 *   document pages (/, /almanac, /contact, the auth screens, 404)
 *     Home, Almanac, Ranking, Contact
 *   game pages (/scan, /archive, /battle, /leaderboard)
 *     Scan, Archive, PVE Battle, Ranking
 *
 * It used to be one flat list shown everywhere, which meant a visitor reading
 * the landing page saw three greyed-out game tabs they could not use, and a
 * player mid-game carried Contact around with them. Splitting it lets each
 * context show only what it is for — and it is what makes room for Almanac,
 * which belongs to the public half.
 *
 * Both navs keep the operator group. An admin needs the tools from wherever
 * they happen to be, and the divider is drawn before the first one rather than
 * at a fixed index, so it appears only when the tools do.
 *
 * No Home in the game nav: the brand mark is a link to `/` on every page, so
 * the way back already exists and a second one would just cost a tab stop.
 *
 * Ranking is in both. The boards read without a session, so it is a public
 * page, but it lives in the game shell — a signed-out visitor who follows
 * Ranking from the landing page lands on the game nav. That is the one seam in
 * this split, and it is preferred to giving one page a nav of its own.
 */
const documentNavItems: NavItem[] = [
  { to: '/', label: 'Home', requiresAuth: false },
  { to: '/almanac', label: 'Almanac', requiresAuth: false },
  { to: '/leaderboard', label: 'Ranking', requiresAuth: false },
  { to: '/contact', label: 'Contact', requiresAuth: false },
];

const gameNavItems: NavItem[] = [
  { to: '/scan', label: 'Scan', requiresAuth: true },
  { to: '/archive', label: 'Archive', requiresAuth: true },
  { to: '/battle', label: 'PVE Battle', requiresAuth: true },
  { to: '/leaderboard', label: 'Ranking', requiresAuth: false },
];

const operatorNavItems: NavItem[] = [
  { to: '/admin', label: 'Admin', requiresAuth: true, requiresSuperAdmin: true },
  { to: '/studio', label: 'Studio', requiresAuth: true, requiresSuperAdmin: true },
  { to: '/test', label: 'API Test', requiresAuth: true, requiresSuperAdmin: true },
  {
    to: '/tickets',
    label: 'Ticket Manager',
    requiresAuth: true,
    requiresSuperAdmin: true,
  },
];

export type AppHeaderVariant = 'document' | 'game';

export interface AppHeaderProps {
  /**
   * Which nav to show. Passed by the shell rather than read off the location:
   * the shell already knows which kind of page it is wrapping, and deriving it
   * from the pathname would mean a second list of routes to keep in step with
   * the router.
   */
  variant?: AppHeaderVariant;
}

export default function AppHeader({ variant = 'document' }: AppHeaderProps = {}) {
  const { status, profile, firebaseUser, logout } = useAuth();
  const { isNavigationLocked } = useNavigationLock();
  const navigate = useNavigate();

  // Two different questions, deliberately not the same flag.
  //   signedIn — is there a session to show an identity and a log-out for?
  //              An unverified account has one.
  //   verified — may this account actually open the game screens? An
  //              unverified account may not: ProtectedRoute bounces it to
  //              /verify-email, so showing Scan as live would promise a page
  //              that immediately redirects.
  const signedIn = status === 'authenticated' || status === 'unverified';
  const verified = status === 'authenticated';
  // Firebase has not yet said who this is. Until it does, the header must not
  // claim "signed out" — on a fresh tab a signed-in player was shown
  // Sign up / Log in and greyed game tabs for ~2s before the swap. Render a
  // neutral pending state instead of the wrong one.
  const authPending = status === 'loading';
  const identity = profile?.displayName ?? firebaseUser?.email ?? 'Account';
  const visibleNavItems = [
    ...(variant === 'game' ? gameNavItems : documentNavItems),
    ...operatorNavItems,
  ].filter((item) => !item.requiresSuperAdmin || profile?.isSuperAdmin);

  async function handleLogout() {
    if (isNavigationLocked) return;
    await logout();
    navigate('/');
  }

  const navigationDisabledTitle = 'Battle setup is being saved';
  const brandContent = (
    <>
      <SproutMark />
      <span>Sprout</span>
    </>
  );

  return (
    <header className="site-header">
      {isNavigationLocked ? (
        <span
          className="brand-link is-disabled"
          aria-disabled="true"
          title={navigationDisabledTitle}
        >
          {brandContent}
        </span>
      ) : (
        <Link className="brand-link" to="/">
          {brandContent}
        </Link>
      )}

      <nav className="primary-nav" aria-label="Primary">
        {visibleNavItems.map((item, index) => (
          <Fragment key={item.to}>
            {/* Rule between the player tabs and the operator tools. Drawn
                before the first tool in the rendered list, so it never trails
                a nav that has no tools after it. */}
            {item.requiresSuperAdmin &&
              !visibleNavItems[index - 1]?.requiresSuperAdmin && (
                <span className="nav-divider" aria-hidden="true" />
              )}
            {isNavigationLocked ||
            (item.requiresAuth && (authPending || !verified)) ? (
              <span
                className="nav-link is-disabled"
                aria-disabled="true"
                title={
                  isNavigationLocked
                    ? navigationDisabledTitle
                    : authPending
                      ? 'Checking session…'
                      : 'Log in to access'
                }
              >
                {item.label}
              </span>
            ) : (
              <NavLink
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  isActive ? 'nav-link is-active' : 'nav-link'
                }
              >
                {item.label}
              </NavLink>
            )}
          </Fragment>
        ))}
      </nav>

      <div className="header-actions">
        {authPending ? null : signedIn ? (
          <>
            <span className="header-user" title={firebaseUser?.email ?? undefined}>
              {identity}
              {status === 'unverified' && <em> (unverified)</em>}
            </span>
            <span className="header-divider" aria-hidden="true" />
            <button
              className="text-link"
              type="button"
              disabled={isNavigationLocked}
              aria-disabled={isNavigationLocked || undefined}
              title={
                isNavigationLocked ? navigationDisabledTitle : undefined
              }
              onClick={handleLogout}
            >
              Log out
            </button>
          </>
        ) : (
          /* Sign up first, then Log in — the same order as the hero's
             "Start Scanning (Sign Up)" / "I have an account" pair, so the eye
             meets the two choices in one consistent order on the page. */
          <>
            {isNavigationLocked ? (
              <span
                className="text-link is-disabled"
                aria-disabled="true"
                title={navigationDisabledTitle}
              >
                Sign up
              </span>
            ) : (
              <Link className="text-link" to="/signup">
                Sign up
              </Link>
            )}
            <span className="header-divider" aria-hidden="true" />
            {isNavigationLocked ? (
              <span
                className="text-link is-disabled"
                aria-disabled="true"
                title={navigationDisabledTitle}
              >
                Log in
              </span>
            ) : (
              <Link className="text-link" to="/login">
                Log in
              </Link>
            )}
          </>
        )}
      </div>
    </header>
  );
}
