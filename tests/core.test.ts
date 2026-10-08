import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDuration } from "../src/durations.js";
import { commands } from "../src/commands.js";

test("durées : refuse les valeurs dangereuses et accepte jours/minutes", () => {
  assert.equal(parseDuration("7j"), 604800000);
  assert.equal(parseDuration("30m"), 1800000);
  for (const value of ["0s", "-1h", "Infinity", "999999999999999999j", "bonjour"]) assert.equal(parseDuration(value), null);
});
test("commandes : outils attendus, aucune fonction ludique", () => {
  const names = commands.map(x => x.name);
  for (const name of ["ban", "export", "exportmembres", "annonces", "publier", "mp", "lockdown"]) assert.ok(names.includes(name));
  for (const name of ["creationanniv", "blague"]) assert.ok(!names.includes(name));
  assert.equal(new Set(names).size, names.length);
});
test("ban temporaire : une échéance survit à une tentative et au redémarrage", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bloodsnow-test-"));
  process.env.DATA_DIR = dir;
  const bans = await import("../src/scheduled-bans.js");
  try {
    await bans.loadScheduledBans();
    await bans.scheduleBan({ guildId: "g", userId: "u", expiresAt: 100 });
    assert.equal((await bans.takeExpiredBans(99)).length, 0);
    assert.equal((await bans.takeExpiredBans(100)).length, 1);
    await bans.loadScheduledBans();
    assert.equal((await bans.takeExpiredBans(101)).length, 1);
    await bans.cancelScheduledBan("g", "u");
    await bans.loadScheduledBans();
    assert.equal((await bans.takeExpiredBans(102)).length, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
