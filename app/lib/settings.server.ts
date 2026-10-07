const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Central defaults from requirements 6.9.1. Durations are in seconds. */
export const settings = {
  inviteQuota: 2,
  invitationTtl: 30 * DAY,
  registrationReservationTtl: 15 * MINUTE,
  backupCodeCount: 10,
  resetLinkTtl: HOUR,
  emailVerificationTtl: HOUR,
  emailRequestTimeout: 10,
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
    expiresIn: 30 * DAY,
    updateAge: DAY,
    freshAge: 5 * MINUTE,
  },

  totp: {
    digits: 6,
    step: 30,
    window: 1,
    challengeTtl: 5 * MINUTE,
    challengeMaxAttempts: 5,
  },

  rateLimits: {
    auth: { window: 10, max: 100 },
    playbackTokenPerMember: { perMinute: 30 },
    adminHighImpactPerAdmin: { perMinute: 30 },
    memberEmail: { minInterval: 60, perHour: 5 },
  },
} as const;
