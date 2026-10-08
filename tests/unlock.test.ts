import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChannelType } from "discord.js";
test("unlock restaure les permissions enregistrées, garde les échecs et refuse un non-admin", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bloodsnow-unlock-"));
  Object.assign(process.env, { NODE_ENV: "test", DATA_DIR: dir, DISCORD_TOKEN: "test", CLIENT_ID: "1", GUILD_ID: "2", MOD_LOG_CHANNEL_ID: "3", ACTIVITY_LOG_CHANNEL_ID: "3" });
  const { handleCommand } = await import("../src/index.js");
  const store = await import("../src/state.js");
  let admin = true, fail = true;
  const restored: any[] = [], replies: any[] = [];
  const channels = ["a", "b", "c", "untouched"].map(id => ({ id, type: ChannelType.GuildText, permissionOverwrites: { edit: async (_: any, value: any) => { if (id === "b" && fail) throw new Error("permission manquante simulée"); restored.push([id, value.SendMessages]); } } }));
  const i: any = { commandName: "unlock", deferred: true, user: { id: "admin", tag: "Admin" },
    options: { getUser: () => null, getString: () => null }, memberPermissions: { has: () => admin },
    guild: { id: "2", roles: { everyone: {} }, channels: { fetch: async (id?: string) => id ? { isTextBased: () => true, send: async () => {} } : new Map(channels.map(c => [c.id,c])) } },
    editReply: async (p: any) => replies.push(p),
  };
  try {
    store.state.locks["2"] = { a: true, b: null, c: false }; await store.saveState(); await store.loadState();
    admin = false; await handleCommand(i); assert.equal(restored.length, 0);
    admin = true; await handleCommand(i); assert.deepEqual(restored, [["a",true],["c",false]]); assert.deepEqual(store.state.locks["2"], { b: null }); assert.match(replies.at(-1), /1 restent/);
    fail = false; await handleCommand(i); assert.deepEqual(restored.at(-1), ["b",null]); assert.equal(store.state.locks["2"], undefined);
    await handleCommand(i); assert.match(replies.at(-1), /Aucun salon/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
