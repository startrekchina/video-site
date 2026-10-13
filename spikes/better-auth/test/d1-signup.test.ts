import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { createAuth } from "../src/auth.ts";

it("signs up through better-auth on workerd + D1 without creating a session", async () => {
  const auth = createAuth(env.DB);
  const res = await auth.api.signUpEmail({
    body: { name: "Picard", email: "picard@example.test", password: "Engage_1701-D", username: "Picard" },
  });
  expect(res.token).toBeNull();

  const user = await env.DB.prepare(`SELECT id, username, displayUsername, emailVerified FROM "user"`).first();
  expect(user).toMatchObject({ username: "picard", displayUsername: "Picard", emailVerified: 0 });

  const account = await env.DB.prepare(`SELECT providerId, password FROM "account" WHERE userId = ?`)
    .bind(user!.id)
    .first<{ providerId: string; password: string }>();
  expect(account?.providerId).toBe("credential");
  expect(account?.password).toMatch(/^scrypt-v1\$N=16384,r=8,p=5\$/);

  const sessions = await env.DB.prepare(`SELECT count(*) AS n FROM "session"`).first<{ n: number }>();
  expect(sessions?.n).toBe(0);
});
