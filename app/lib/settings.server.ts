const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Central defaults from requirements 6.9.1. Durations are in seconds. */
export const settings = {
  inviteQuota: 2,
  invitationTtl: 30 * DAY,
  recoveryCodeCount: 10,
  resetLinkTtl: 24 * HOUR,
  emailVerificationTtl: 24 * HOUR,
  completionThreshold: 0.9,
  progressReportInterval: 15,
  backupRetention: 30 * DAY,
  commentMaxLength: 1000,
  commentsPerPage: 10,
  repliesPerBatch: 10,
  playbackTokenTtl: 30 * MINUTE,
  playbackTokenRenewBefore: 5 * MINUTE,
  playbackTokenRenewRetryDelays: [5, 15, 30],

  session: {
    absoluteLifetime: 180 * DAY,
    idleTimeout: 30 * DAY,
    lastActiveWriteInterval: 24 * HOUR,
  },

  totp: {
    digits: 6,
    step: 30,
    window: 1,
    challengeTtl: 5 * MINUTE,
    challengeMaxAttempts: 10,
  },

  rateLimits: {
    authPerOperation: { perMinute: 10, per15Minutes: 30 },
    turnstileAfterFailures: 5,
    turnstileClearAfter: 15 * MINUTE,
    playbackTokenPerMember: { perMinute: 30 },
    adminHighImpactPerAdmin: { perMinute: 30 },
    verificationTokenConsume: { perMinute: 10, per15Minutes: 30 },
    memberEmail: { minInterval: 60, perHour: 5 },
  },
} as const;
