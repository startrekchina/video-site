import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { settings } from "@/lib/settings.server";
import { fixtureTime, seedCatalog } from "./fixtures/catalog";

const now = fixtureTime;
type SqlValue = string | number | null;

function insert(table: string, fields: Record<string, SqlValue>) {
  const columns = Object.keys(fields);
  return env.DB.prepare(
    `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
  ).bind(...Object.values(fields));
}

const movie = (id: string, workId = "movie") => insert("playable_units", {
  id, kind: "movie", work_id: workId, tmdb_id: 910001, duration_seconds: 4,
});
const episode = (id: string, workId = "series", seasonId: string | null = "season", number = 1) =>
  insert("playable_units", {
    id, kind: "episode", work_id: workId, season_id: seasonId,
    episode_number: number, tmdb_id: 930001, duration_seconds: 4,
  });
const user = (id: string, username = id, emailKey = `${id}@example.test`) => insert("users", {
  id, username, username_key: username.toLowerCase(), email: emailKey, email_key: emailKey,
  email_verified_at: now, password_hash: "fictional-hash-not-for-authentication",
  role: "member", status: "active", invite_quota: settings.inviteQuota, created_at: now,
});
const item = (id: string, workId: string | null, unitId: string | null, position: number) =>
  insert("playlist_items", {
    id, playlist_id: "playlist", work_id: workId, playable_unit_id: unitId, position,
  });
const vote = (commentId: string | null, replyId: string | null, value = 1, userId = "nova") =>
  insert("discussion_votes", { user_id: userId, comment_id: commentId, reply_id: replyId, value });
const media = (id: string, unitId = "movie-unit", objectKey = id, variant = "original") =>
  insert("media_files", {
    id, playable_unit_id: unitId, format: "mp4", variant, object_key: objectKey,
    byte_length: 100, checksum_sha256: "a".repeat(64), duration_seconds: 4,
    video_codec: "h264", audio_codec: "aac", bitrate: 200,
  });
const subtitle = (id: string, trackKey = id, objectKey = id, unitId = "movie-unit") =>
  insert("subtitle_tracks", {
    id, playable_unit_id: unitId, language: "en", format: "vtt", display_name: id,
    track_key: trackKey, object_key: objectKey, byte_length: 50, checksum_sha256: "b".repeat(64),
  });
const invitation = (id: string, usedBy: string | null = null, issuer: string | null = null) =>
  insert("invitations", {
    id, code_hash: `fictional-${id}`, issuer_user_id: issuer, used_by_user_id: usedBy,
    operation_id: issuer === null ? null : id, created_at: now,
    expires_at: now + settings.invitationTtl * 1000, used_at: usedBy === null ? null : now,
  });

async function count(table: string) {
  return env.DB.prepare(`SELECT count(*) AS count FROM ${table}`).first<number>("count");
}

beforeEach(async () => {
  await seedCatalog(env.DB);
  await env.DB.batch([
    insert("playlists", {
      id: "playlist", owner_user_id: "nova", title: "Fictional Flight", visibility: "private",
      created_at: now, updated_at: now,
    }),
    insert("comments", {
      id: "comment", playable_unit_id: "movie-unit", author_user_id: "nova",
      body_markdown: "A fictional test signal.", created_at: now,
    }),
    insert("comment_replies", {
      id: "reply", comment_id: "comment", author_user_id: "quinn", reply_to_user_id: "nova",
      body_markdown: "Signal received.", created_at: now,
    }),
  ]);
});

describe("catalog constraints", () => {
  it("stores a playable movie and episode", async () => {
    expect(await env.DB.prepare("SELECT kind FROM playable_units ORDER BY kind").all())
      .toMatchObject({ results: [{ kind: "episode" }, { kind: "movie" }] });
  });

  it("allows the same TMDB number for a movie and a series but rejects a duplicate kind", async () => {
    await insert("works", { id: "shared-tmdb", kind: "series", tmdb_id: 910001 }).run();
    await expect(insert("works", { id: "duplicate", kind: "movie", tmdb_id: 910001 }).run())
      .rejects.toThrow(/UNIQUE constraint/);
  });

  it("allows only one movie unit per work", async () => {
    await expect(movie("duplicate-movie").run()).rejects.toThrow(/UNIQUE constraint/);
    expect(await count("playable_units")).toBe(2);
  });

  it("requires movie units to have no season or episode number", async () => {
    await expect(env.DB.prepare("UPDATE playable_units SET episode_number = 1 WHERE id = ?")
      .bind("movie-unit").run()).rejects.toThrow(/CHECK constraint/);
    await expect(env.DB.prepare("UPDATE playable_units SET season_id = ? WHERE id = ?")
      .bind("season", "movie-unit").run()).rejects.toThrow(/CHECK constraint/);
  });

  it("enforces unique season numbers within each series", async () => {
    await expect(insert("seasons", {
      id: "duplicate-season", work_id: "series", season_number: 1, tmdb_id: 940003,
    }).run()).rejects.toThrow(/UNIQUE constraint/);
    expect(await count("seasons")).toBe(2);
  });

  it("rejects seasons attached to a movie", async () => {
    await expect(insert("seasons", {
      id: "movie-season", work_id: "movie", season_number: 1, tmdb_id: 940003,
    }).run()).rejects.toThrow(/FOREIGN KEY constraint/);
  });

  it("requires episodes to have both a season and an episode number", async () => {
    await expect(episode("no-season", "series", null).run()).rejects.toThrow(/CHECK constraint/);
    await expect(env.DB.prepare("UPDATE playable_units SET episode_number = NULL WHERE id = ?")
      .bind("episode-unit").run()).rejects.toThrow(/CHECK constraint/);
  });

  it("enforces episode numbers per season and permits the same number in another season", async () => {
    await expect(episode("duplicate-episode").run()).rejects.toThrow(/UNIQUE constraint/);
    await episode("other-episode", "other-series", "other-season").run();
    expect(await count("playable_units")).toBe(3);
  });

  it("rejects an episode whose season belongs to another work", async () => {
    await expect(episode("wrong-work", "series", "other-season").run())
      .rejects.toThrow(/FOREIGN KEY constraint/);
    await expect(env.DB.prepare("UPDATE playable_units SET work_id = ? WHERE id = ?")
      .bind("other-series", "episode-unit").run()).rejects.toThrow(/FOREIGN KEY constraint/);
  });

  it("rejects movie units attached to a series", async () => {
    await expect(movie("wrong-kind", "series").run()).rejects.toThrow(/FOREIGN KEY constraint/);
  });
});

describe("playlist constraints", () => {
  it.each([
    [null, null], ["movie", "movie-unit"],
  ])("requires exactly one target (%s, %s)", async (workId, unitId) => {
    await expect(item("invalid", workId, unitId, 0).run()).rejects.toThrow(/CHECK constraint/);
    expect(await count("playlist_items")).toBe(0);
  });

  it.each([
    ["movie", null], [null, "movie-unit"],
  ])("rejects the same target at another position (%s, %s)", async (workId, unitId) => {
    await item("first", workId, unitId, 0).run();
    await expect(item("duplicate", workId, unitId, 1).run()).rejects.toThrow(/UNIQUE constraint/);
    expect(await count("playlist_items")).toBe(1);
  });

  it("allows a work and its playable unit but requires distinct positions", async () => {
    await item("work", "movie", null, 0).run();
    await expect(item("same-position", null, "movie-unit", 0).run()).rejects.toThrow(/UNIQUE constraint/);
    await item("unit", null, "movie-unit", 1).run();
    expect(await count("playlist_items")).toBe(2);
  });

  it("removes only the deleted playlist's items", async () => {
    await item("work", "movie", null, 0).run();
    await env.DB.prepare("DELETE FROM playlists WHERE id = ?").bind("playlist").run();
    expect(await count("playlist_items")).toBe(0);
    expect(await count("works")).toBe(3);
  });
});

describe("discussion constraints", () => {
  it.each([
    [null, null], ["comment", "reply"],
  ])("requires exactly one vote target (%s, %s)", async (commentId, replyId) => {
    await expect(vote(commentId, replyId).run()).rejects.toThrow(/CHECK constraint/);
    expect(await count("discussion_votes")).toBe(0);
  });

  it.each([
    ["comment", null], [null, "reply"],
  ])("allows one vote per member and target (%s, %s)", async (commentId, replyId) => {
    await vote(commentId, replyId).run();
    await expect(vote(commentId, replyId, -1).run()).rejects.toThrow(/UNIQUE constraint/);
    await vote(commentId, replyId, -1, "quinn").run();
    expect(await count("discussion_votes")).toBe(2);
  });

  it("rejects feedback outside the two allowed values", async () => {
    await expect(vote("comment", null, 0).run()).rejects.toThrow(/CHECK constraint/);
  });

  it("deletes a comment, its replies and every related vote", async () => {
    await env.DB.batch([vote("comment", null), vote(null, "reply")]);
    await env.DB.prepare("DELETE FROM comments WHERE id = ?").bind("comment").run();
    expect(await count("comments")).toBe(0);
    expect(await count("comment_replies")).toBe(0);
    expect(await count("discussion_votes")).toBe(0);
    await expect(vote(null, "reply").run()).rejects.toThrow(/FOREIGN KEY constraint/);
  });

  it("deletes one reply and its votes without deleting the rest of the conversation", async () => {
    await insert("comment_replies", {
      id: "other-reply", comment_id: "comment", author_user_id: "nova",
      body_markdown: "Another fictional reply.", created_at: now,
    }).run();
    await env.DB.batch([vote("comment", null), vote(null, "reply"), vote(null, "other-reply")]);
    await env.DB.prepare("DELETE FROM comment_replies WHERE id = ?").bind("reply").run();
    expect(await count("comments")).toBe(1);
    expect(await count("comment_replies")).toBe(1);
    expect(await count("discussion_votes")).toBe(2);
  });

  it("preserves authored discussion when a member is banned", async () => {
    await env.DB.prepare("UPDATE users SET status = ? WHERE id = ?").bind("banned", "nova").run();
    expect(await count("comments")).toBe(1);
    expect(await count("comment_replies")).toBe(1);
  });
});

describe("email and credential constraints", () => {
  it("rejects a pending email occupied by another current email and preserves both members", async () => {
    await expect(env.DB.prepare("UPDATE users SET pending_email = ?, pending_email_key = ? WHERE id = ?")
      .bind("quinn@example.test", "quinn@example.test", "nova").run()).rejects.toThrow(/UNIQUE constraint/);
    expect(await env.DB.prepare("SELECT email_key, pending_email_key FROM users WHERE id = ?")
      .bind("nova").first()).toEqual({ email_key: "nova@example.test", pending_email_key: null });
    expect(await count("email_claims")).toBe(2);
  });

  it("rejects new current and pending emails already reserved by a pending change", async () => {
    await env.DB.prepare("UPDATE users SET pending_email = ?, pending_email_key = ? WHERE id = ?")
      .bind("new@example.test", "new@example.test", "nova").run();
    await expect(user("river", "River", "new@example.test").run()).rejects.toThrow(/UNIQUE constraint/);
    await expect(env.DB.prepare("UPDATE users SET pending_email = ?, pending_email_key = ? WHERE id = ?")
      .bind("new@example.test", "new@example.test", "quinn").run()).rejects.toThrow(/UNIQUE constraint/);
    expect(await count("users")).toBe(2);
    expect(await count("email_claims")).toBe(3);
  });

  it("moves a pending claim to current and releases the old email in one update", async () => {
    await env.DB.prepare("UPDATE users SET pending_email = ?, pending_email_key = ? WHERE id = ?")
      .bind("new@example.test", "new@example.test", "nova").run();
    await env.DB.prepare(`UPDATE users SET email = pending_email, email_key = pending_email_key,
      pending_email = NULL, pending_email_key = NULL WHERE id = ?`).bind("nova").run();
    expect(await env.DB.prepare("SELECT email_key, kind FROM email_claims WHERE user_id = ?")
      .bind("nova").all()).toMatchObject({ results: [{ email_key: "new@example.test", kind: "current" }] });
    await user("river", "River", "nova@example.test").run();
    expect(await count("users")).toBe(3);
  });

  it("keeps claims consistent when changing a current email while a pending one remains", async () => {
    await env.DB.prepare("UPDATE users SET pending_email = ?, pending_email_key = ? WHERE id = ?")
      .bind("new@example.test", "new@example.test", "nova").run();
    await env.DB.prepare("UPDATE users SET email = ?, email_key = ? WHERE id = ?")
      .bind("replaced@example.test", "replaced@example.test", "nova").run();
    expect(await env.DB.prepare("SELECT email_key, kind FROM email_claims WHERE user_id = ? ORDER BY kind")
      .bind("nova").all()).toMatchObject({ results: [
        { email_key: "replaced@example.test", kind: "current" },
        { email_key: "new@example.test", kind: "pending" },
      ] });
  });

  it("prevents deleting an email claim referenced by a member", async () => {
    await expect(env.DB.prepare("DELETE FROM email_claims WHERE user_id = ?")
      .bind("nova").run()).rejects.toThrow(/Email claim is still in use/);
    expect(await count("email_claims")).toBe(2);
  });

  it("enforces case-insensitive usernames and immutable invitation sources", async () => {
    await expect(user("river", "nOVA").run()).rejects.toThrow(/UNIQUE constraint/);
    await expect(env.DB.prepare("UPDATE users SET invited_by_user_id = ? WHERE id = ?")
      .bind("quinn", "nova").run()).rejects.toThrow(/Invitation source is immutable/);
  });

  it("allows only one unconsumed verification token across purposes", async () => {
    const verification = (id: string, purpose: string) => insert("email_verification_tokens", {
      id, user_id: "nova", purpose, target_email_key: "nova@example.test", token_hash: id,
      created_at: now, expires_at: now + settings.emailVerificationTtl * 1000,
    });
    await verification("first", "registration").run();
    await expect(verification("second", "email_change").run()).rejects.toThrow(/UNIQUE constraint/);
    await env.DB.batch([
      env.DB.prepare("UPDATE email_verification_tokens SET consumed_at = ? WHERE id = ?").bind(now, "first"),
      verification("second", "email_change"),
    ]);
    expect(await count("email_verification_tokens")).toBe(2);
  });

  it("allows only one unconsumed reset link across signing sources", async () => {
    const reset = (id: string, source: string, issuer: string | null) => insert("reset_links", {
      id, token_hash: id, user_id: "nova", source, issuer_admin_user_id: issuer,
      created_at: now, expires_at: now + settings.resetLinkTtl * 1000,
    });
    await reset("first", "email", null).run();
    await expect(reset("second", "admin", "quinn").run()).rejects.toThrow(/UNIQUE constraint/);
    await env.DB.batch([
      env.DB.prepare("UPDATE reset_links SET consumed_at = ? WHERE id = ?").bind(now, "first"),
      reset("second", "admin", "quinn"),
    ]);
    expect(await count("reset_links")).toBe(2);
  });

  it("rejects duplicate passkey credential IDs", async () => {
    const passkey = (id: string, userId: string) => env.DB.prepare(`INSERT INTO passkeys
      (id, user_id, credential_id, public_key, counter, device_type, backed_up, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, userId, "fictional-credential", new Uint8Array([1, 2]),
      0, "multi_device", 1, now);
    await passkey("first", "nova").run();
    await expect(passkey("second", "quinn").run()).rejects.toThrow(/UNIQUE constraint/);
  });
});

describe("media and invitation constraints", () => {
  it("rejects reused media object keys and duplicate logical variants", async () => {
    await media("first").run();
    await expect(media("same-key", "episode-unit", "first").run()).rejects.toThrow(/UNIQUE constraint/);
    await expect(media("same-variant").run()).rejects.toThrow(/UNIQUE constraint/);
    expect(await count("media_files")).toBe(1);
  });

  it("allows multiple tracks in one language but rejects duplicate track and object identities", async () => {
    await env.DB.batch([subtitle("full"), subtitle("captions")]);
    await expect(subtitle("same-track", "full").run()).rejects.toThrow(/UNIQUE constraint/);
    await expect(subtitle("same-key", "other", "full", "episode-unit").run())
      .rejects.toThrow(/UNIQUE constraint/);
    expect(await count("subtitle_tracks")).toBe(2);
  });

  it("accepts bootstrap invitations without an issuer", async () => {
    await invitation("bootstrap").run();
    expect(await env.DB.prepare("SELECT issuer_user_id FROM invitations WHERE id = ?")
      .bind("bootstrap").first()).toEqual({ issuer_user_id: null });
  });

  it("rejects multiple invitations consumed by the same member", async () => {
    await invitation("first", "nova").run();
    await expect(invitation("second", "nova").run()).rejects.toThrow(/UNIQUE constraint/);
    expect(await count("invitations")).toBe(1);
  });

  it("enforces unique code hashes and issuer-scoped operation IDs", async () => {
    await invitation("first", null, "nova").run();
    await expect(env.DB.prepare(`INSERT INTO invitations
      (id, code_hash, issuer_user_id, operation_id, created_at, expires_at)
      SELECT ?, ?, issuer_user_id, operation_id, created_at, expires_at FROM invitations WHERE id = ?`)
      .bind("duplicate-operation", "new-hash", "first").run()).rejects.toThrow(/UNIQUE constraint/);
    await expect(env.DB.prepare(`INSERT INTO invitations (id, code_hash, created_at, expires_at)
      SELECT ?, code_hash, created_at, expires_at FROM invitations WHERE id = ?`)
      .bind("duplicate-hash", "first").run()).rejects.toThrow(/UNIQUE constraint/);
  });

  it("rolls back a batch when a later orphaned subtitle is rejected", async () => {
    await expect(env.DB.batch([media("valid"), subtitle("orphan", "orphan", "orphan", "missing")]))
      .rejects.toThrow(/FOREIGN KEY constraint/);
    expect(await count("media_files")).toBe(0);
    expect(await count("subtitle_tracks")).toBe(0);
  });
});

describe("foreign keys", () => {
  it.each([
    ["season work", () => insert("seasons", {
      id: "orphan", work_id: "missing", season_number: 1, tmdb_id: 940009,
    })],
    ["movie work", () => movie("orphan", "missing")],
    ["episode season", () => episode("orphan", "series", "missing")],
    ["media unit", () => media("orphan", "missing")],
    ["subtitle unit", () => subtitle("orphan", "orphan", "orphan", "missing")],
    ["user inviter", () => insert("users", {
      id: "orphan", username: "Orphan", username_key: "orphan", email: "orphan@example.test",
      email_key: "orphan@example.test", password_hash: "fictional-hash", role: "member",
      status: "active", invite_quota: settings.inviteQuota, invited_by_user_id: "missing", created_at: now,
    })],
    ["verification member", () => insert("email_verification_tokens", {
      id: "orphan", user_id: "missing", purpose: "registration", target_email_key: "fictional-key",
      token_hash: "fictional-hash", created_at: now, expires_at: now + 1000,
    })],
    ["delivery member", () => insert("email_deliveries", {
      id: "orphan", user_id: "missing", to_email_key: "fictional-digest", purpose: "password_reset",
      status: "unknown", created_at: now,
    })],
    ["session member", () => insert("sessions", {
      id: "orphan", token_hash: "fictional-hash", user_id: "missing", credential_version: 0,
      created_at: now, last_active_at: now, expires_at: now + 1000,
    })],
    ["invitation issuer", () => invitation("orphan", null, "missing")],
    ["invitation consumer", () => invitation("orphan", "missing")],
    ["recovery member", () => insert("recovery_codes", {
      code_hash: "fictional-hash", user_id: "missing", generation: 0, created_at: now,
    })],
    ["reset member", () => insert("reset_links", {
      id: "orphan", token_hash: "fictional-hash", user_id: "missing", source: "email",
      created_at: now, expires_at: now + 1000,
    })],
    ["reset issuer", () => insert("reset_links", {
      id: "orphan", token_hash: "fictional-hash", user_id: "nova", source: "admin",
      issuer_admin_user_id: "missing", created_at: now, expires_at: now + 1000,
    })],
    ["TOTP member", () => env.DB.prepare(`INSERT INTO totp_credentials
      (user_id, encrypted_secret, nonce, key_version, created_at) VALUES (?, ?, ?, ?, ?)`)
      .bind("missing", new Uint8Array([1]), new Uint8Array([2]), 1, now)],
    ["passkey member", () => env.DB.prepare(`INSERT INTO passkeys
      (id, user_id, credential_id, public_key, counter, device_type, backed_up, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind("orphan", "missing", "fictional-credential",
      new Uint8Array([1]), 0, "multi_device", 1, now)],
    ["challenge member", () => insert("auth_challenges", {
      id: "orphan", token_hash: "fictional-hash", kind: "totp", operation: "login",
      user_id: "missing", created_at: now, expires_at: now + 1000,
    })],
    ["challenge session", () => insert("auth_challenges", {
      id: "orphan", token_hash: "fictional-hash", kind: "totp", operation: "login",
      session_id: "missing", created_at: now, expires_at: now + 1000,
    })],
    ["challenge target", () => insert("auth_challenges", {
      id: "orphan", token_hash: "fictional-hash", kind: "totp", operation: "ban",
      target_user_id: "missing", created_at: now, expires_at: now + 1000,
    })],
    ["progress member", () => insert("watch_progress", {
      user_id: "missing", playable_unit_id: "movie-unit", position_seconds: 0, completed: 0, updated_at: now,
    })],
    ["progress unit", () => insert("watch_progress", {
      user_id: "nova", playable_unit_id: "missing", position_seconds: 0, completed: 0, updated_at: now,
    })],
    ["favorite member", () => insert("favorites", { user_id: "missing", work_id: "movie" })],
    ["favorite work", () => insert("favorites", { user_id: "nova", work_id: "missing" })],
    ["playlist owner", () => insert("playlists", {
      id: "orphan", owner_user_id: "missing", title: "Fictional", visibility: "private",
      created_at: now, updated_at: now,
    })],
    ["item playlist", () => insert("playlist_items", {
      id: "orphan", playlist_id: "missing", work_id: "movie", position: 0,
    })],
    ["item work", () => item("orphan", "missing", null, 0)],
    ["item unit", () => item("orphan", null, "missing", 0)],
    ["comment unit", () => insert("comments", {
      id: "orphan", playable_unit_id: "missing", author_user_id: "nova", body_markdown: "Test", created_at: now,
    })],
    ["comment author", () => insert("comments", {
      id: "orphan", playable_unit_id: "movie-unit", author_user_id: "missing", body_markdown: "Test", created_at: now,
    })],
    ["reply comment", () => insert("comment_replies", {
      id: "orphan", comment_id: "missing", author_user_id: "nova", body_markdown: "Test", created_at: now,
    })],
    ["reply author", () => insert("comment_replies", {
      id: "orphan", comment_id: "comment", author_user_id: "missing", body_markdown: "Test", created_at: now,
    })],
    ["reply recipient", () => insert("comment_replies", {
      id: "orphan", comment_id: "comment", author_user_id: "nova", reply_to_user_id: "missing",
      body_markdown: "Test", created_at: now,
    })],
    ["vote member", () => vote("comment", null, 1, "missing")],
    ["vote comment", () => vote("missing", null)],
    ["vote reply", () => vote(null, "missing")],
  ] as const)("rejects an orphaned %s", async (_name, statement) => {
    await expect(statement().run()).rejects.toThrow(/FOREIGN KEY constraint/);
    expect((await env.DB.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
  });
});
