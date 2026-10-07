import test from "node:test";
import assert from "node:assert/strict";
import { PermissionFlagsBits } from "discord.js";
Object.assign(process.env, { NODE_ENV: "test", DISCORD_TOKEN: "test", CLIENT_ID: "1", GUILD_ID: "2", MOD_LOG_CHANNEL_ID: "3" });

test("export membres : MP uniquement ; refus sans droit administrateur ; aucun repli public", async () => {
  const { handleCommand } = await import("../src/index.js");
  let dm = 0, logs = 0, replies: any[] = [];
  let allow = true, fail = false;
  const interaction: any = {
    commandName: "exportmembres", channelId: "3", deferred: true,
    options: { getUser: () => null, getString: () => null },
    memberPermissions: { has: (flag: bigint) => allow && flag === PermissionFlagsBits.Administrator },
    user: { id: "u", tag: "user", send: async (payload: any) => { if (fail) throw new Error("MP fermés"); assert.ok(payload.files.length); dm++; } },
    guild: { id: "2", name: "Test", members: { fetch: async () => ({ size: 0, map: () => [] }) }, channels: { fetch: async () => ({ isTextBased: () => true, send: async (payload: any) => { assert.equal(payload.files, undefined); logs++; } }) } },
    editReply: async (payload: any) => { assert.equal(payload.files, undefined); replies.push(payload); },
  };
  await handleCommand(interaction);
  assert.equal(dm, 1); assert.equal(logs, 1);
  fail = true;
  await assert.rejects(handleCommand(interaction), /MP fermés/);
  assert.equal(dm, 1); assert.equal(logs, 1);
  allow = false;
  await handleCommand(interaction);
  assert.ok(replies.at(-1).content.includes("permission"));
  assert.equal(dm, 1);
});
