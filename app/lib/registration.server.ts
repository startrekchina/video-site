import { APIError } from "better-auth/api";
import { createAuth } from "./auth.server";
import { settings } from "./settings.server";

type RegistrationInput = { username: string; email: string; password: string; invitationCode: string };
type Attempt = { id: string; invitation_id: string; expected_user_id: string; identity_key: string; state: string; expires_at: number };
type Invitation = { id: string; used_by_user_id: string | null; revoked_at: number | null; created_at: number; expires_at: number; issuer_valid: number };
type NativeUser = { id: string; username: string; email: string };
type RegistrationResult =
  | { status: "registered"; alreadyCompleted: boolean; attemptToken: string }
  | { status: "rejected" | "retry"; code: string; attemptToken?: string };

export async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

/** Internal only: the HTTP caller must enforce CSRF/captcha/rate limits and keep attemptToken in an HttpOnly cookie. */
export async function registerWithInvitation(env: Env, input: RegistrationInput, attemptToken?: string): Promise<RegistrationResult> {
  if ([input?.username, input?.email, input?.password, input?.invitationCode].some(value => typeof value !== "string") || !input.invitationCode || input.invitationCode.length > 512
    || (attemptToken !== undefined && !/^[a-f0-9]{64}$/.test(attemptToken))) {
    return { status: "rejected", code: "REGISTRATION_INPUT_INVALID" };
  }
  const token = attemptToken ?? Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join("");
  const id = await sha256(token);
  const identity = await sha256(JSON.stringify([input.username.toLowerCase(), input.email.toLowerCase()]));
  const codeHash = await sha256(input.invitationCode);
  const db = env.DB;
  const readAttempt = () => db.prepare("SELECT * FROM registration_attempts WHERE id = ?").bind(id).first<Attempt>();
  let attempt = await readAttempt();
  const invitation = await db.prepare(`SELECT i.*,
    (i.issuer_user_id IS NULL OR EXISTS (SELECT 1 FROM member_profiles AS p JOIN "user" AS u ON u.id = p.user_id
      WHERE p.user_id = i.issuer_user_id AND p.status = 'active' AND p.registration_state = 'completed' AND u.emailVerified = 1)) AS issuer_valid
    FROM invitations AS i WHERE code_hash = ?`).bind(codeHash).first<Invitation>();
  if (attempt && (!attempt.expected_user_id || attempt.identity_key !== identity || attempt.invitation_id !== invitation?.id)) {
    return { status: "rejected", code: "REGISTRATION_ATTEMPT_INVALID" };
  }
  if (attemptToken && !attempt) return { status: "rejected", code: "REGISTRATION_ATTEMPT_INVALID" };
  if (attempt?.state !== "completed") {
    const now = Date.now();
    const invalid = !invitation || !invitation.issuer_valid || invitation.created_at > now ? "INVITATION_INVALID"
      : invitation.used_by_user_id ? "INVITATION_USED" : invitation.revoked_at !== null ? "INVITATION_REVOKED"
        : invitation.expires_at <= now ? "INVITATION_EXPIRED" : null;
    if (invalid) return { status: "rejected", code: invalid, ...(attempt && { attemptToken: token }) };
    await db.prepare(`UPDATE registration_attempts SET state = 'failed', updated_at = ?
      WHERE invitation_id = ? AND state IN ('reserved', 'created') AND expires_at <= ?`)
      .bind(now, invitation!.id, now).run();
    const available = `EXISTS (SELECT 1 FROM invitations AS i WHERE i.id = ? AND i.used_by_user_id IS NULL
      AND i.revoked_at IS NULL AND i.expires_at > ? AND (i.issuer_user_id IS NULL OR EXISTS (
        SELECT 1 FROM member_profiles AS p JOIN "user" AS u ON u.id = p.user_id
        WHERE p.user_id = i.issuer_user_id AND p.status = 'active' AND p.registration_state = 'completed' AND u.emailVerified = 1)))
      AND NOT EXISTS (SELECT 1 FROM registration_attempts WHERE invitation_id = ? AND state IN ('reserved', 'created') AND id <> ?)`;
    const expires = now + settings.registrationReservationTtl * 1000;
    if (!attempt) {
      await db.prepare(`INSERT INTO registration_attempts (id, invitation_id, expected_user_id, identity_key, state, created_at, updated_at, expires_at)
        SELECT ?, ?, ?, ?, 'reserved', ?, ?, ? WHERE ${available} ON CONFLICT DO NOTHING`)
        .bind(id, invitation!.id, crypto.randomUUID(), identity, now, now, expires, invitation!.id, now, invitation!.id, id).run();
    } else {
      await db.prepare(`UPDATE registration_attempts SET state = CASE WHEN user_id IS NULL THEN 'reserved' ELSE 'created' END,
        updated_at = ?, expires_at = ? WHERE id = ? AND state = 'failed' AND ${available}`)
        .bind(now, expires, id, invitation!.id, now, invitation!.id, id).run();
    }
    attempt = await readAttempt();
    if (!attempt || attempt.state === "failed") return { status: "rejected", code: "INVITATION_RESERVED" };
  }

  const auth = createAuth(env, attempt.expected_user_id);
  const context = await auth.$context;
  const readUser = () => db.prepare('SELECT id, username, email FROM "user" WHERE id = ?').bind(attempt!.expected_user_id).first<NativeUser>();
  try {
    let user = await readUser();
    if (!user) {
      await auth.api.signUpEmail({ body: { name: input.username, username: input.username, email: input.email, password: input.password } });
      user = await readUser();
      // Native duplicate-email responses may contain a synthetic user. Never treat the response as ownership proof.
      if (!user) throw new APIError("CONFLICT", { code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL", message: "Email conflict" });
    }
    if (user.username !== input.username.toLowerCase() || user.email !== input.email.toLowerCase()) {
      return { status: "rejected", code: "REGISTRATION_ATTEMPT_INVALID", attemptToken: token };
    }
    const { minPasswordLength, maxPasswordLength } = context.password.config;
    if (input.password.length < minPasswordLength || input.password.length > maxPasswordLength) {
      return { status: "rejected", code: "INVALID_PASSWORD", attemptToken: token };
    }
    let account = await db.prepare("SELECT password FROM account WHERE userId = ? AND providerId = 'credential' AND accountId = ?")
      .bind(user.id, user.id).first<{ password: string }>();
    if (!account && attempt.state !== "completed") {
      // Only this persisted attempt can repair its own partially created native credential.
      await context.internalAdapter.linkAccount({ userId: user.id, providerId: "credential", accountId: user.id, password: await context.password.hash(input.password) });
      account = await db.prepare("SELECT password FROM account WHERE userId = ? AND providerId = 'credential'").bind(user.id).first<{ password: string }>();
    }
    if (!account?.password || !await context.password.verify({ hash: account.password, password: input.password })) {
      return { status: "rejected", code: "REGISTRATION_ATTEMPT_INVALID", attemptToken: token };
    }
    if (attempt.state === "completed") return { status: "registered", alreadyCompleted: true, attemptToken: token };
    const now = Date.now();
    await db.prepare(`UPDATE registration_attempts SET user_id = expected_user_id, state = 'created', updated_at = ?
      WHERE id = ? AND state IN ('reserved', 'created') AND expires_at > ?`).bind(now, id, now).run();
    // The migration's trigger rechecks expiry/issuer and consumes the invitation in this same statement.
    const completion = await db.prepare(`INSERT INTO member_profiles (user_id, role, status, registration_state, invited_by_user_id, invite_quota, created_at)
      SELECT a.user_id, 'member', 'active', 'completed', i.issuer_user_id, ?, ?
      FROM registration_attempts AS a JOIN invitations AS i ON i.id = a.invitation_id
      WHERE a.id = ? AND a.state = 'created' AND NOT EXISTS (SELECT 1 FROM member_profiles WHERE user_id = a.user_id)`)
      .bind(settings.inviteQuota, Date.now(), id).run();
    if ((await readAttempt())?.state !== "completed") return { status: "retry", code: "REGISTRATION_RETRY", attemptToken: token };
    return { status: "registered", alreadyCompleted: completion.meta.changes === 0, attemptToken: token };
  } catch (error) {
    if (!await readUser()) {
      await db.prepare("UPDATE registration_attempts SET state = 'failed', updated_at = ? WHERE id = ? AND state <> 'completed'").bind(Date.now(), id).run();
      if (error instanceof APIError && typeof error.body?.code === "string" && /^[A-Z_]+$/.test(error.body.code)) {
        return { status: "rejected", code: error.body.code, attemptToken: token };
      }
    }
    return { status: "retry", code: "REGISTRATION_RETRY", attemptToken: token };
  }
}
