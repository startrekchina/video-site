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
  playlistTitleMax: 60,
  playlistItemsMax: 200,
  backupRetention: 30 * DAY,
  backupTaskTimeout: 14 * MINUTE,
  commentMaxLength: 1000,
  commentsPerPage: 10,
  repliesPerBatch: 10,
  // Optional tiers link and are offered only within this many seconds of the original (B 6.6).
  qualityDurationTolerance: 1,
  // Colors must match the CHECK in migrations/0015_danmaku.sql.
  danmaku: {
    maxLength: 50,
    readLimit: 3000,
    adminPageSize: 50,
    colors: ["#FFFFFF", "#F2C14E", "#E5534B", "#5BA4E6", "#6CC08B", "#B48EF0"],
    blockWordLimit: 20,
    blockWordMaxLength: 20,
  },

  session: {
    expiresIn: 30 * DAY,
    updateAge: DAY,
    freshAge: 5 * MINUTE,
  },

  totp: {
    challengeTtl: 5 * MINUTE,
  },

  rateLimits: {
    auth: { window: 10, max: 100 },
    adminHighImpactPerAdmin: { perMinute: 30 },
    memberEmail: { minInterval: 60, perHour: 5 },
    changeEmail: { minInterval: 60, perHour: 30 },
    danmaku: { minInterval: 5, perHour: 60 },
  },
} as const;
