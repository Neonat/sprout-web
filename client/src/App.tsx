import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { NavigationLockProvider } from './context/NavigationLockProvider';
import AppHeader from './components/common/AppHeader';
import ProtectedRoute from './components/common/ProtectedRoute';
import { ToastProvider } from './components/common/Toast';
import DisplayNameNotice from './components/common/DisplayNameNotice';
import SuperAdminRoute from './components/common/SuperAdminRoute';
import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import VerifyEmailPage from './pages/VerifyEmailPage';
import ContactPage from './pages/ContactPage';
import AlmanacPage from './pages/AlmanacPage';
import ArchivePage from './pages/ArchivePage';
import ScanPage from './pages/ScanPage';
import BattlePage from './pages/BattlePage';
import LeaderboardPage from './pages/LeaderboardPage';
import BackendTestPage from './pages/BackendTestPage';
import AdminPage from './pages/AdminPage';
import TicketManagerPage from './pages/TicketManagerPage';
import StudioPage from './pages/StudioPage';
import NotFoundPage from './pages/NotFoundPage';
import './App.css';

/** The nav is eight tab stops, repeated on every page, and a keyboard user had
 *  no way past it — WCAG 2.4.1. First focusable thing in the document, visible
 *  only while focused, and it targets the id each shell puts on its content
 *  box. `tabIndex={-1}` on that box is what lets the jump actually move focus:
 *  without it the browser scrolls but leaves focus in the header, so the next
 *  Tab returns to nav item two. */
const MAIN_CONTENT_ID = 'main-content';

function SkipLink() {
  return (
    <a className="skip-link" href={`#${MAIN_CONTENT_ID}`}>
      Skip to main content
    </a>
  );
}

/**
 * Chrome for the document pages: the painted app shell and the primary nav.
 * The landing page lives here too — it is a scrolling document, and the header
 * is how a signed-out visitor reaches log in / sign up.
 *
 * The content box is a plain wrapper rather than a styled one: `.app-shell` is
 * a flex column and `.screen` carries its own `min-height`, so an unstyled
 * flex item around it lands at exactly the size the page had before.
 */
function DocumentLayout() {
  return (
    <div className="app-shell">
      <SkipLink />
      <AppHeader />
      <div id={MAIN_CONTENT_ID} tabIndex={-1}>
        <Outlet />
      </div>
    </div>
  );
}

/**
 * The game boards. These used to render bare, on the reasoning that a nav bar
 * above a 100dvh board would cut the art in half — but that left the nav
 * vanishing the moment a player started playing, and every screen needing its
 * own way home. The header is permanent here now; `.game-shell-body > .screen`
 * sizes each board to the space the header leaves rather than to a fresh
 * viewport, so nothing is pushed past the bottom edge.
 */
function GameLayout() {
  return (
    <div className="game-shell">
      <SkipLink />
      <AppHeader variant="game" />
      {/* The id rides the existing body box rather than a new wrapper —
          `.game-shell-body > .screen` is a direct-child selector. */}
      <div className="game-shell-body" id={MAIN_CONTENT_ID} tabIndex={-1}>
        <Outlet />
      </div>
    </div>
  );
}

/**
 * The sprite-pipeline studio, under the same site nav as everywhere else.
 *
 * The studio ships its own chrome — a `position: fixed` sidebar and a sticky
 * top bar — and none of it is touched here. `.studio-shell-body` carries a
 * transform, which makes it the containing block for those fixed children, so
 * the sidebar resolves against the wrapper and starts below the nav instead of
 * overlapping it. That keeps the accommodation entirely in the layout: no
 * studio component knows the nav exists.
 */
function StudioLayout() {
  return (
    <div className="studio-shell">
      <SkipLink />
      {/* The studio is an operator tool reached from the operator group, which
          both navs carry. It takes the game nav so leaving it lands a player
          back among the boards rather than on the marketing pages. */}
      <AppHeader variant="game" />
      {/* No id here, unlike the other two shells: StudioPage renders its own
          <main id="main-content">, and putting the id on this wrapper too made
          it a duplicate — invalid, and the skip link resolved to whichever
          came first, landing above the studio's own topbar rather than at the
          content. The page owns the target here. */}
      <div className="studio-shell-body">
        <Outlet />
      </div>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <DisplayNameNotice />
          <NavigationLockProvider>
            <Routes>
              <Route element={<DocumentLayout />}>
                <Route path="/" element={<LandingPage />} />
                <Route path="/login" element={<LoginPage />} />
                <Route path="/signup" element={<SignupPage />} />
                <Route path="/verify-email" element={<VerifyEmailPage />} />
                <Route path="/contact" element={<ContactPage />} />
                {/* Public, and in the document shell rather than the game one:
                    it is a scrolling page a visitor reads to find out what the
                    game is about, and `.screen` would pin it to 100dvh. */}
                <Route path="/almanac" element={<AlmanacPage />} />
                {/* Operator tools. SuperAdminRoute is presentational; the
                    server re-resolves the grant on every /api/admin and
                    /api/platform call and returns 403 to everyone else. */}
                <Route
                  path="/admin"
                  element={
                    <SuperAdminRoute>
                      <AdminPage />
                    </SuperAdminRoute>
                  }
                />
                <Route
                  path="/tickets"
                  element={
                    <SuperAdminRoute>
                      <TicketManagerPage />
                    </SuperAdminRoute>
                  }
                />
                {/* Was public. It enumerates the API surface and fires real
                    requests at it, which is an operator's tool, not a
                    visitor's. */}
                <Route
                  path="/test"
                  element={
                    <SuperAdminRoute>
                      <BackendTestPage />
                    </SuperAdminRoute>
                  }
                />
              </Route>

              {/* `/home` (the old "Play" hub) is archived: HomePage.tsx stays in
                  the tree but nothing routes to or links at it any more, so the
                  nav goes straight from the landing page to Scan. The catch-all
                  below sends any stale /home bookmark back to `/`. */}
              <Route element={<GameLayout />}>
                <Route
                  path="/scan"
                  element={
                    <ProtectedRoute>
                      <ScanPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/archive"
                  element={
                    <ProtectedRoute>
                      <ArchivePage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/battle"
                  element={
                    <ProtectedRoute>
                      <BattlePage />
                    </ProtectedRoute>
                  }
                />
                {/* Open, unlike its neighbours: Ranking is one of the three tabs
                    a signed-out visitor can use. The boards read anonymously;
                    only the "where do I rank" panel needs a session, and the API
                    returns an empty standing for callers without one. */}
                <Route path="/leaderboard" element={<LeaderboardPage />} />
                {/* The nav labels this tab "Ranking", so /ranking is what a
                    visitor types or bookmarks after reading it. It used to
                    fall through to the catch-all and land on the home page. */}
                <Route
                  path="/ranking"
                  element={<Navigate to="/leaderboard" replace />}
                />
              </Route>

              <Route element={<StudioLayout />}>
                <Route
                  path="/studio"
                  element={
                    <SuperAdminRoute>
                      <StudioPage />
                    </SuperAdminRoute>
                  }
                />
              </Route>

              {/* A real 404 rather than a silent redirect home. Inside
                  DocumentLayout so the page keeps the nav and the skip link —
                  the whole point is to give someone who is lost a way out. */}
              <Route element={<DocumentLayout />}>
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Routes>
          </NavigationLockProvider>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
