import { test as base, expect, type Page } from '@playwright/test';

/**
 * Shared setup for the end-to-end specs.
 *
 * The only thing worth abstracting is establishing a session. Everything else
 * is written out in each spec: a helper that clicks three things and asserts
 * two of them hides the journey the test exists to describe.
 */

/** The local-only sign-in shortcut. See client/src/services/devSession.ts — it
 *  is fenced behind import.meta.env.DEV, so it exists in the dev build the E2E
 *  stack runs and cannot exist in a deployed one. */
export const DEV_EMAIL = 'test@sprout.com';

/**
 * The uid that owns the seeded creatures.
 *
 * `server/scripts/seed-firestore.ts` writes its five demo avatars against
 * DEMO_USER_ID (`demo-user-0001`), while the UI's sign-in shortcut mints
 * `dev-admin-0001`. Signing in through the form therefore lands on an account
 * with an empty archive — which is a perfectly valid state, and exactly what
 * `newAccountSignIn` below covers, but it is not the account that can
 * demonstrate the archive-to-battle journey.
 *
 * This is not a workaround for a bug. The two ids serve different purposes:
 * the seeded user is the fixture, the dev admin is the operator. E2E needs both.
 */
export const SEEDED_OWNER_UID = 'demo-user-0001';

/** The uid the UI's own sign-in shortcut creates. Owns nothing until it scans. */
export const DEV_ADMIN_UID = 'dev-admin-0001';

const DEV_SESSION_STORAGE_KEY = 'sprout-dev-session';

/**
 * Establishes a session for a specific uid by writing the same localStorage
 * record the UI's shortcut writes.
 *
 * `getDevSession()` accepts any well-formed `{uid, email}`, so this is the
 * supported shape rather than a forged one — and it is the only way to sign in
 * *as the seeded owner*, whose uid the login form cannot produce.
 *
 * addInitScript, not an evaluate() after navigation: the record has to exist
 * before the app's first render, or AuthContext resolves to signed-out and the
 * first paint redirects away before the session is readable.
 */
export async function signInAs(page: Page, uid: string): Promise<void> {
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [DEV_SESSION_STORAGE_KEY, JSON.stringify({ uid, email: DEV_EMAIL })] as const
  );
}

/** Signs in as the account that owns the seeded creatures. */
export async function signInAsSeededOwner(page: Page): Promise<void> {
  await signInAs(page, SEEDED_OWNER_UID);
}

/**
 * Signs in through the actual login form.
 *
 * Slower than seeding localStorage, and that is the point: this is the only
 * place the real form, its validation and the AuthContext handoff are exercised
 * by a browser. Everything else takes the fast path.
 */
export async function signInThroughForm(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email address').fill(DEV_EMAIL);
  await page.getByLabel('Password').fill('any-password-is-accepted-locally');
  await page.getByRole('button', { name: /log in/i }).click();

  // Both header variants show Log out once the session is ready; Archive is
  // only present in the game header, not the admin page this account opens.
  await expect(
    page.getByRole('banner').getByRole('button', { name: /^log out$/i })
  ).toBeVisible({ timeout: 20_000 });
}

export const test = base;
export { expect };
