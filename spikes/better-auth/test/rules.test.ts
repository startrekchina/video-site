import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createAuth } from "../src/auth.ts";

const auth = createAuth(env.DB);
let seq = 0;
const signUp = (username: string, password = "Engage_1701-D") =>
  auth.api.signUpEmail({ body: { name: username, email: `m${++seq}@example.test`, password, username } });

describe("username rules", () => {
  it("accepts 3-12 chars of [A-Za-z0-9_-] and keeps display case", async () => {
    await expect(signUp("Kirk-1701_A")).resolves.toBeDefined();
    const row = await env.DB.prepare(`SELECT username, displayUsername FROM "user" WHERE username = 'kirk-1701_a'`).first();
    expect(row).toEqual({ username: "kirk-1701_a", displayUsername: "Kirk-1701_A" });
  });

  it.each(["ab", "abcdefghijklm", "a.b.c", "Data Soong", "数据库"])("rejects %j", async (name) => {
    await expect(signUp(name)).rejects.toMatchObject({ statusCode: 400 });
  });

  it("treats case variants as the same account", async () => {
    await signUp("Riker");
    await expect(signUp("riker")).rejects.toMatchObject({ body: { code: "USERNAME_IS_ALREADY_TAKEN" } });
  });
});

describe("password rules", () => {
  it.each(["short_1234", "x".repeat(128), "!~#$%^&*()_+{}|:<>?"])("accepts boundary %j", async (pw) => {
    await expect(signUp(`ok${seq}`, pw)).resolves.toBeDefined();
  });

  it.each([
    ["9 chars", "Short_123"],
    ["129 chars", "x".repeat(129)],
    ["inner space", "has space_123"],
    ["leading space (no trim)", " Engage_1701"],
    ["non-ASCII", "Engage_1701-数"],
    ["emoji", "Engage_1701-🖖"],
    ["tab", "Engage\t1701-D"],
  ])("rejects %s", async (_label, pw) => {
    await expect(signUp(`bad${seq}`, pw)).rejects.toMatchObject({ body: { code: "PASSWORD_INVALID" } });
  });
});
