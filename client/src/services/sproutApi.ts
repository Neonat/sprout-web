import apiClient from './apiClient';

export interface HealthResponse {
  status: string;
  timestamp: string;
}

export interface AvatarStats {
  hp: number;
  attack: number;
  defense: number;
  speed: number;
}

export interface AvatarRecord {
  id: string;
  userId: string;
  speciesName: string;
  speciesFamily: string | null;
  spriteUrl: string;
  discoveredAt: string;
  source: 'mobile' | 'web';
  isTemporary: boolean;
  expiresAt: string | null;
  battleEligible: boolean;
  stats: AvatarStats;
  metadata: Record<string, unknown> | null;
}

export interface PaginatedAvatars {
  items: AvatarRecord[];
  page: number;
  pageSize: number;
  total: number;
}

export type BattleStatus = 'active' | 'won' | 'lost' | 'abandoned';
export type BattlePhase =
  | 'PREPARE_BOT_INTENT'
  | 'PLAYER_ACTION'
  | 'RESOLVE_ROUND'
  | 'CHECK_RESULT'
  | 'TERMINAL';
export type BattleMoveKind = 'quick' | 'guard' | 'signature' | 'heal';
export type BattleIntent = 'building' | 'committed' | 'uncertain';
export type BattleActor = 'player' | 'bot' | 'system';
export type BattleEventType =
  | 'battle_started'
  | 'bot_intent_prepared'
  | 'move_used'
  | 'move_missed'
  | 'damage_dealt'
  | 'healed'
  | 'player_action_skipped'
  | 'bot_action_skipped'
  | 'battle_won'
  | 'battle_lost'
  | 'battle_abandoned';

export interface BattleMove {
  id: string;
  name: string;
  kind: BattleMoveKind;
  power: number;
  accuracy: number;
  energyGain: number;
  energyCost: number;
}

export interface BattlePlayer {
  id: string;
  name: string;
  spriteUrl: string;
  stats: AvatarStats;
  currentHp: number;
  maxHp: number;
  energy: number;
  maxEnergy: number;
  healUsed: boolean;
  moves: BattleMove[];
}

export interface BattleBot {
  id: string;
  name: string;
  spriteUrl: string;
  stats: AvatarStats;
  currentHp: number;
  maxHp: number;
  energy: number;
  maxEnergy: number;
  healUsed: boolean;
}

interface BattleEventBase {
  turnNumber: number;
  type: BattleEventType;
  message: string;
  amount?: number;
}

export interface BotBattleEvent extends BattleEventBase {
  actor: 'bot';
  intent?: BattleIntent;
}

export interface PlayerBattleEvent extends BattleEventBase {
  actor: 'player';
  moveId?: string;
}

export interface SystemBattleEvent extends BattleEventBase {
  actor: 'system';
}

export type BattleEvent =
  | BotBattleEvent
  | PlayerBattleEvent
  | SystemBattleEvent;

export interface BattleSession {
  id: string;
  avatarId: string;
  status: BattleStatus;
  phase: BattlePhase;
  turnNumber: number;
  player: BattlePlayer;
  bot: BattleBot;
  botIntent: BattleIntent | null;
  log: BattleEvent[];
  xpAwarded: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface BattleActionResult {
  session: BattleSession;
  stale: boolean;
}

/** Inquiry types offered by the Contact Us form (UC8 step 1). Labels are
 *  shown to the user; values are what the API accepts. */
export const TICKET_CATEGORIES = [
  { value: 'general', label: 'General' },
  { value: 'partnership', label: 'Partnership' },
  { value: 'technical_support', label: 'Technical Support' },
  { value: 'feedback', label: 'Feedback' },
] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number]['value'];

export interface TicketInput {
  name: string;
  email: string;
  organisation?: string;
  subject: string;
  category: TicketCategory;
  message: string;
}

export interface TicketResponse {
  refNumber: string;
}

export interface TicketStatus {
  refNumber: string;
  subject: string;
  category: TicketCategory;
  status: 'open' | 'resolved';
  submittedAt: string | null;
  /** When an operator marked it resolved. Null while open, and also null for
   *  tickets resolved before this was tracked — so the UI must treat "resolved
   *  with no date" as a real case rather than assuming one exists. */
  resolvedAt: string | null;
}

/** Checks a ticket from the Contact page. The email is the proof of ownership —
 *  reference numbers are a daily sequence and guessable on their own. */
export async function getTicketStatus(input: {
  refNumber: string;
  email: string;
}): Promise<TicketStatus> {
  const { data } = await apiClient.post<TicketStatus>('/api/query/status', input);
  return data;
}

export interface SignupInput {
  email: string;
  password: string;
  displayName: string;
}

export interface SignupResponse {
  uid: string;
  email: string;
  displayName: string;
  emailVerified: boolean;
  verificationEmailSent: boolean;
  message: string;
}

export interface VerificationEmailResponse {
  verificationEmailSent: boolean;
  message: string;
}

/** Which credential Firebase Auth actually accepts for this account. 'google'
 *  means the password path is closed, whether or not one was ever set. */
export type AuthProviderTag = 'password' | 'google';

export interface AuthProfile {
  /** Present only on the sign-in where auto-provisioning found the name it
   *  derived from the email already taken and assigned a variant. Holds what
   *  was asked for; cleared once the player has been told. */
  displayNameAdjustedFrom?: string;
  uid: string;
  email: string;
  displayName: string;
  emailVerified: boolean;
  authProvider?: AuthProviderTag;
  /** The advisory ADMIN_EMAILS badge, OR'd with the grant (so every operator
   *  also carries it). A badge alone opens nothing: it is not the flag any
   *  gate should check. An earlier comment here called the two fields aliases
   *  of one level — that was wrong, and it is how SuperAdminRoute ended up
   *  admitting badge-holders to a shell of 403s. See auth.controller.ts:
   *  "Two values, because there are still two tiers." */
  isAdmin: boolean;
  /** The operator grant — the Firestore `isSuperAdmin` flag OR the
   *  SUPER_ADMIN_EMAILS allowlist, and the only flag that opens the operator
   *  surfaces (one operator actor in the use-case model: Super-admin).
   *  Client-side it is presentational: /api/admin and /api/platform
   *  re-resolve the grant on every request and answer 403 regardless. */
  isSuperAdmin?: boolean;
  lastLogin?: string | null;
  lastLogout?: string | null;
}

export interface MessageResponse {
  message: string;
}

export async function checkHealth(): Promise<HealthResponse> {
  const { data } = await apiClient.get<HealthResponse>('/api/health');
  return data;
}

export async function listAvatars(
  devUid: string,
  page = 1,
  pageSize = 20
): Promise<PaginatedAvatars> {
  const { data } = await apiClient.get<PaginatedAvatars>('/api/avatar', {
    params: { page, pageSize },
    headers: { 'x-dev-uid': devUid },
  });
  return data;
}

export async function listAvatarsWithToken(
  idToken: string,
  page = 1,
  pageSize = 20
): Promise<PaginatedAvatars> {
  const { data } = await apiClient.get<PaginatedAvatars>('/api/avatar', {
    params: { page, pageSize },
    headers: { Authorization: `Bearer ${idToken}` },
  });
  return data;
}

export async function listOwnedAvatars(
  page = 1,
  pageSize = 20
): Promise<PaginatedAvatars> {
  const { data } = await apiClient.get<PaginatedAvatars>('/api/avatar', {
    params: { page, pageSize },
  });
  return data;
}

/** One owned avatar (GET /api/avatar/:id). The scan result screen reads the
 *  persisted record for its full stat block — the pipeline's `complete` event
 *  only carries maxHealth/speed. */
export async function getAvatar(avatarId: string): Promise<AvatarRecord> {
  const { data } = await apiClient.get<AvatarRecord>(
    `/api/avatar/${encodeURIComponent(avatarId)}`
  );
  return data;
}

/** Removes one owned avatar for good (DELETE /api/avatar/:id → 204).
 *  The archive's shovel; the server answers 404 for anyone else's record. */
export async function deleteAvatar(avatarId: string): Promise<void> {
  await apiClient.delete(`/api/avatar/${encodeURIComponent(avatarId)}`);
}

export async function setDemoAvatars(
  enabled: boolean
): Promise<PaginatedAvatars> {
  const response = enabled
    ? await apiClient.post<PaginatedAvatars>('/api/avatar/demo')
    : await apiClient.delete<PaginatedAvatars>('/api/avatar/demo');
  return response.data;
}

/** Mirrors server/data/almanac.ts — the checklist's own categories, verbatim.
 *  `cultivated only` covers most roadside and garden planting here, so it is a
 *  normal value on a card rather than an exclusion. */
export type AlmanacStatus =
  | 'common'
  | 'naturalised'
  | 'casual'
  | 'cultivated only'
  | 'weed of uncertain origin'
  | 'vulnerable'
  | 'endangered'
  | 'critically endangered'
  | 'extinct'
  | 'globally extinct';

/** A card as the public landing page sees it: no finder, no date, no photo. */
export interface AlmanacEntry {
  id: string;
  speciesName: string;
  commonName: string | null;
  family: string;
  status: AlmanacStatus;
  origin: string | null;
  growthForm: string | null;
  discovered: boolean;
  discoveryCount: number;
}

/**
 * One species opened up.
 *
 * The sprite and stats come back for anyone — they describe the plant. The
 * finder's name and the discovery date describe a *person* and are present only
 * when the request carried a login.
 */
export interface AlmanacEntryDetail extends AlmanacEntry {
  spriteUrl: string | null;
  stats: AvatarStats;
  discoveredByName?: string | null;
  discoveredAt?: string | null;
  /** True when the signed-in caller is the one who found it first. */
  isFirstDiscoverer?: boolean;
}

export interface AlmanacSummary {
  source: string;
  total: number;
  discovered: number;
  species: AlmanacEntry[];
}

export interface AdminAlmanac extends Omit<AlmanacSummary, 'species'> {
  species: AlmanacEntryDetail[];
  /* Mirrors OffTaxonomyDiscovery in server/services/almanac.service.ts.
     It previously declared `speciesId` and `discoveredByName`, neither of
     which the server sends — the payload carries `speciesKey` and no finder
     name at all. Nothing caught it: the type is hand-written, so TypeScript
     was checking the UI against a fiction. The cost was a React key of
     `undefined` on every row and a "first by" line that rendered blank. */
  offTaxonomy: Array<{
    speciesKey: string;
    speciesName: string;
    discoveredAt: string;
    discoveryCount: number;
  }>;
}

/** Public — no Authorization header required (GET /api/almanac). */
export async function getAlmanac(): Promise<AlmanacSummary> {
  const { data } = await apiClient.get<AlmanacSummary>('/api/almanac');
  return data;
}

/** Public. A signed-in caller additionally gets the finder, date and photo. */
export async function getAlmanacEntry(
  speciesId: string
): Promise<AlmanacEntryDetail> {
  const { data } = await apiClient.get<AlmanacEntryDetail>(
    `/api/almanac/${encodeURIComponent(speciesId)}`
  );
  return data;
}

export async function getAdminAlmanac(): Promise<AdminAlmanac> {
  const { data } = await apiClient.get<AdminAlmanac>('/api/admin/almanac');
  return data;
}

export interface CleanupReport {
  target: string;
  dryRun: boolean;
  matched: number;
  deleted: number;
  sample: Array<{ id: string; label: string; detail: string }>;
  ranAt: string;
}

/**
 * Runs an admin cleanup target. Dry run unless `confirmTarget` is passed, which
 * the server also insists on — one accidental click cannot delete anything.
 */
export async function runAdminCleanup(
  target: string,
  options: { dryRun: boolean } = { dryRun: true }
): Promise<CleanupReport> {
  const { data } = await apiClient.post<CleanupReport>('/api/admin/cleanup', {
    target,
    dryRun: options.dryRun,
    ...(options.dryRun ? {} : { confirmTarget: target }),
  });
  return data;
}

export interface ApiProbe {
  status: 'PASS' | 'FAIL' | 'WARN' | 'SKIP';
  /** null when the provider was deliberately not probed — Flux and withoutBG
   *  bill per call, so the health page reports "key present, liveness unknown"
   *  rather than spending a credit on every page load. */
  latencyMs?: number | null;
  remainingCredits?: number | null;
  limit?: number | null;
  used?: number | null;
  detail: string;
  model?: string;
}

export interface ApiHealth {
  timestamp: string;
  overallStatus: 'HEALTHY' | 'DEGRADED';
  probes: Record<string, ApiProbe>;
}

/** Live provider probes. Admin-only, same ADMIN_EMAILS gate as /api/admin. */
export async function getApiHealth(): Promise<ApiHealth> {
  const { data } = await apiClient.get<ApiHealth>('/api/platform/health-check');
  return data;
}

export async function startPveBattle(avatarId: string): Promise<BattleSession> {
  const { data } = await apiClient.post<BattleSession>('/api/battle/pve/start', {
    avatarId,
  });
  return data;
}

export async function getPveBattle(sessionId: string): Promise<BattleSession> {
  const { data } = await apiClient.get<BattleSession>(
    `/api/battle/pve/${sessionId}`
  );
  return data;
}

export async function submitPveAction(
  sessionId: string,
  moveId: string,
  expectedTurn: number
): Promise<BattleActionResult> {
  const { data } = await apiClient.post<BattleActionResult>(
    `/api/battle/pve/${sessionId}/action`,
    { moveId, expectedTurn }
  );
  return data;
}

export async function abandonPveBattle(
  sessionId: string
): Promise<BattleSession> {
  const { data } = await apiClient.post<BattleSession>(
    `/api/battle/pve/${sessionId}/abandon`
  );
  return data;
}

export async function submitTicket(input: TicketInput): Promise<TicketResponse> {
  const { data } = await apiClient.post<TicketResponse>('/api/query/submit', input);
  return data;
}

export async function signupUser(input: SignupInput): Promise<SignupResponse> {
  const { data } = await apiClient.post<SignupResponse>('/api/auth/signup', input);
  return data;
}

export async function resendVerification(): Promise<VerificationEmailResponse> {
  const { data } = await apiClient.post<VerificationEmailResponse>(
    '/api/auth/resend-verification'
  );
  return data;
}

/** Confirms the player has seen the "your name was taken" notice, so it is not
 *  shown again (POST /api/auth/display-name-notice/ack -> 204). */
export async function acknowledgeDisplayNameNotice(): Promise<void> {
  await apiClient.post('/api/auth/display-name-notice/ack');
}

export async function getCurrentUser(idToken?: string): Promise<AuthProfile> {
  // Without an explicit token the apiClient request interceptor attaches the
  // signed-in Firebase user's token automatically.
  const { data } = await apiClient.get<AuthProfile>('/api/auth/me', {
    headers: idToken ? { Authorization: `Bearer ${idToken}` } : undefined,
  });
  return data;
}

export async function recordSessionLogin(idToken?: string): Promise<AuthProfile> {
  const { data } = await apiClient.post<AuthProfile>(
    '/api/auth/session/login',
    undefined,
    { headers: idToken ? { Authorization: `Bearer ${idToken}` } : undefined }
  );
  return data;
}

export async function recordSessionLogout(idToken?: string): Promise<AuthProfile> {
  const { data } = await apiClient.post<AuthProfile>(
    '/api/auth/session/logout',
    undefined,
    { headers: idToken ? { Authorization: `Bearer ${idToken}` } : undefined }
  );
  return data;
}

export interface AdminAccount {
  id: string;
  email: string;
  displayName: string;
  isVerified: boolean;
  /** Holds the grant by either route. */
  isAdmin: boolean;
  /** The persisted flag specifically — what promote/revoke writes. */
  isSuperAdmin: boolean;
  /** Granted by ADMIN_EMAILS. Revoke is refused for these: clearing the flag
   *  would leave the allowlist still granting. */
  isAllowlisted: boolean;
  pveXp: number;
  pveWins: number;
  pveLosses: number;
  createdAt: string | null;
  lastLogin: string | null;
}

export interface AdminAccountList {
  items: AdminAccount[];
  total: number;
}

export interface DeleteAccountResult {
  id: string;
  firebaseIdentityDeleted: boolean;
  profileDeleted: boolean;
}

/** Superadmin-only: 403 for anyone without the flag or the allowlist. */
export async function listAdminAccounts(): Promise<AdminAccountList> {
  const { data } = await apiClient.get<AdminAccountList>('/api/admin/users');
  return data;
}

/** Grant or revoke the Firestore superadmin flag on another account. The
 *  server refuses your own row, and refuses to revoke an allowlisted address
 *  (clearing the flag would not remove the grant). */
export async function setAccountSuperAdmin(
  uid: string,
  isSuperAdmin: boolean
): Promise<AdminAccount> {
  const { data } = await apiClient.patch<AdminAccount>(
    `/api/admin/users/${encodeURIComponent(uid)}/superadmin`,
    { isSuperAdmin }
  );
  return data;
}

export interface ManagedTicket {
  id: string;
  refNumber: string;
  name: string;
  email: string;
  organisation?: string;
  subject: string;
  category: TicketCategory;
  message: string;
  status: 'open' | 'resolved';
  submitterEmailStatus: 'pending' | 'sent' | 'failed';
  adminEmailStatus: 'pending' | 'sent' | 'failed';
  createdAt?: string;
  resolvedAt?: string | null;
}

export async function listManagedTickets(): Promise<{
  items: ManagedTicket[];
  total: number;
}> {
  const { data } = await apiClient.get<{ items: ManagedTicket[]; total: number }>(
    '/api/admin/tickets'
  );
  return data;
}

export async function setManagedTicketStatus(
  id: string,
  status: ManagedTicket['status']
): Promise<ManagedTicket> {
  const { data } = await apiClient.patch<ManagedTicket>(
    `/api/admin/tickets/${encodeURIComponent(id)}/status`,
    { status }
  );
  return data;
}

export async function deleteAdminAccount(uid: string): Promise<DeleteAccountResult> {
  const { data } = await apiClient.delete<DeleteAccountResult>(
    `/api/admin/users/${encodeURIComponent(uid)}`
  );
  return data;
}

/** Asked only after a password login has already failed, to tell "wrong
 *  password" apart from "this address is Google-only". Answers 'unknown' for
 *  everything that is not Google-linked, including addresses with no account. */
export async function getSignInMethod(
  email: string
): Promise<{ method: 'google' | 'unknown' }> {
  const { data } = await apiClient.post<{ method: 'google' | 'unknown' }>(
    '/api/auth/sign-in-method',
    { email }
  );
  return data;
}

export async function requestPasswordReset(email: string): Promise<MessageResponse> {
  const { data } = await apiClient.post<MessageResponse>('/api/auth/request-reset', {
    email,
  });
  return data;
}

export async function verifyPasswordReset(input: {
  email: string;
  otp: string;
  newPassword: string;
}): Promise<MessageResponse> {
  const { data } = await apiClient.post<MessageResponse>(
    '/api/auth/verify-reset',
    input
  );
  return data;
}

/* ---------------------------------------------------------------------------
   Leaderboards

   Authenticated: every row is a display name bound to a play record. Rows carry
   `isCaller` rather than a uid, so the client can highlight your own standing
   without ever holding another player's identifier.
   ------------------------------------------------------------------------- */

export interface XpLeaderboardEntry {
  rank: number;
  displayName: string;
  xp: number;
  wins: number;
  losses: number;
  bestWinStreak: number;
  isCaller: boolean;
}

export interface DiscoveryLeaderboardEntry {
  rank: number;
  displayName: string;
  discoveries: number;
  isCaller: boolean;
}

/** The caller's true standing across all players, not their index in the
 *  visible slice — `rank` is null when they do not appear on that board. */
export interface CallerXpStanding {
  rank: number | null;
  displayName: string;
  xp: number;
  wins: number;
  losses: number;
  bestWinStreak: number;
}

export interface CallerDiscoveryStanding {
  rank: number | null;
  displayName: string;
  discoveries: number;
}

export interface Leaderboards {
  xp: {
    entries: XpLeaderboardEntry[];
    caller: CallerXpStanding;
    totalPlayers: number;
  };
  discovery: {
    entries: DiscoveryLeaderboardEntry[];
    caller: CallerDiscoveryStanding;
    totalPlayers: number;
  };
}

export async function getLeaderboards(): Promise<Leaderboards> {
  const { data } = await apiClient.get<Leaderboards>('/api/leaderboard');
  return data;
}
