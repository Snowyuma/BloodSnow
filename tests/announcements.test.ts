import test from "node:test";
import assert from "node:assert/strict";
import { PermissionFlagsBits } from "discord.js";
Object.assign(process.env, { NODE_ENV: "test", DISCORD_TOKEN: "test", CLIENT_ID: "1", GUILD_ID: "2", MOD_LOG_CHANNEL_ID: "3", ANNOUNCEMENT_CHANNEL_IDS: "" });
test("annonces : administrateur dans un salon hors liste, permission manquante et non-admin", async () => {
  const { handleCommand } = await import("../src/index.js");
  let admin = true, canSend = true, sent = 0;
  const replies: any[] = [];
  const channel: any = { id: "autre-salon", isTextBased: () => true, isThread: () => false,
    permissionsFor: () => ({ has: () => canSend }), send: async (payload: any) => { sent++; assert.equal(payload.embeds[0].data.description, "Annonce test"); } };
  const i: any = { commandName: "annonces", channelId: "autre-salon", deferred: true,
    user: { id: "admin" }, memberPermissions: { has: (p: bigint) => admin && p === PermissionFlagsBits.Administrator },
    options: { getUser: () => null, getString: (key: string) => key === "message" ? "Annonce test" : null, getChannel: () => channel, getAttachment: () => null },
    guild: { id: "2", members: { me: {} }, channels: { fetch: async () => channel } },
    editReply: async (p: any) => replies.push(p),
  };
  await handleCommand(i); assert.equal(sent, 1);
  canSend = false; await handleCommand(i); assert.equal(sent, 1); assert.match(replies.at(-1).content, /doit pouvoir/);
  admin = false; await handleCommand(i); assert.equal(sent, 1); assert.match(replies.at(-1).content, /permission/);
});
