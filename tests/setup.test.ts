import test from "node:test";
import assert from "node:assert/strict";
import { validateEnvironment, validateReleases } from "../src/preflight.js";
import { assertBotIdentity } from "../src/identity.js";

test("configuration : signale tous les champs manquants sans divulguer le token", () => {
  const errors = validateEnvironment({ DISCORD_TOKEN: "secret-ne-pas-afficher", RAID_JOIN_LIMIT: "0", SPAM_TIMEOUT_MINUTES: "999999" });
  assert.ok(errors.some(x => x.startsWith("GUILD_ID")));
  assert.ok(errors.some(x => x.startsWith("RAID_JOIN_LIMIT")));
  assert.ok(errors.some(x => x.startsWith("SPAM_TIMEOUT_MINUTES")));
  assert.ok(!errors.join(" ").includes("secret-ne-pas-afficher"));
});
test("journal : refuse une mise à jour sans notes ou avec une version en double", () => {
  assert.equal(validateReleases([{ version: "1.0.1", changes: ["Correction"] }], "1.0.1").length, 0);
  assert.ok(validateReleases([{ version: "1", changes: [] }], "1").length);
  assert.ok(validateReleases([{ version: "1", changes: ["A"] }, { version: "1", changes: ["B"] }], "1").length);
  assert.ok(validateReleases([{ version: "1", changes: ["A"] }], "2").length);
});
test("identité : empêche le déploiement avec le token d’un autre bot", () => {
  assert.doesNotThrow(() => assertBotIdentity({ id: "bloodsnow", bot: true }, "bloodsnow"));
  assert.throws(() => assertBotIdentity({ id: "avrilou", bot: true }, "bloodsnow"));
  assert.throws(() => assertBotIdentity({ id: "bloodsnow", bot: false }, "bloodsnow"));
});
