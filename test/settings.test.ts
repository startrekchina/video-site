import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { settings } from "@/lib/settings.server";

it("keeps the confirmed defaults from requirements 6.9.1", () => {
  expect(settings).toMatchObject({
    inviteQuota: 2,
    invitationTtl: 30 * 86400,
    backupCodeCount: 10,
    resetLinkTtl: 3600,
    emailVerificationTtl: 3600,
    completionThreshold: 0.9,
    progressReportInterval: 15,
    backupRetention: 30 * 86400,
    commentMaxLength: 1000,
    commentsPerPage: 10,
    repliesPerBatch: 10,
    playbackTokenTtl: 1800,
    playbackTokenRenewBefore: 300,
    playbackTokenRenewRetryDelays: [5, 15, 30],
    session: { expiresIn: 30 * 86400, updateAge: 86400, freshAge: 300 },
    totp: { digits: 6, step: 30, window: 1, challengeTtl: 300, challengeMaxAttempts: 5 },
    rateLimits: {
      auth: { window: 10, max: 100 },
      playbackTokenPerMember: { perMinute: 30 },
      adminHighImpactPerAdmin: { perMinute: 30 },
      memberEmail: { minInterval: 60, perHour: 5 },
    },
  });
});

it("exposes the declared bindings in the test environment", () => {
  expect(env.APP_ENV).toBe("test");
  expect(env.APP_ORIGIN).toBe("http://localhost:6120");
  expect(env.WEBAUTHN_RP_ID).toBe("localhost");
  expect(env.ASSETS).toHaveProperty("fetch", expect.any(Function));
  expect(typeof env.DB.prepare).toBe("function");
  expect(typeof env.MEDIA_BUCKET.get).toBe("function");
  expect(typeof env.AUTH_RATE_LIMITER.limit).toBe("function");
  expect(env.PLAYBACK_HMAC_KEY).toBeTruthy();
  expect(env.BETTER_AUTH_SECRET.length).toBeGreaterThanOrEqual(32);
});
