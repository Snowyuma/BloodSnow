import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("journal : première installation, absence de doublon et nouvelle tentative après échec", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bloodsnow-release-"));
  Object.assign(process.env, { DATA_DIR: dir, DISCORD_TOKEN: "test", CLIENT_ID: "1", GUILD_ID: "2", MOD_LOG_CHANNEL_ID: "3" });
  const state = await import("../src/state.js");
  const sent: any[] = [];
  let fail = true;
  const guild: any = { id: "2", channels: { fetch: async () => ({ isTextBased: () => true, send: async (message: any) => { if (fail) throw new Error("Discord indisponible"); sent.push(message); } }) } };
  try {
    await state.loadState();
    await assert.rejects(state.announceRelease(guild));
    assert.equal(state.state.releases["2"].length, 0);
    fail = false;
    await state.announceRelease(guild);
    assert.ok(sent[0].embeds[0].data.title.includes("première installation"));
    assert.equal(sent.length, 2);
    await state.loadState();
    await state.announceRelease(guild);
    assert.equal(sent.length, 3);
    assert.equal(sent[2].embeds[0].data.title, "BloodSnow démarré");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
