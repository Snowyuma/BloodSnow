import test from "node:test";
import assert from "node:assert/strict";
import { PermissionFlagsBits as P } from "discord.js";
import { voiceChanges } from "../src/voice-log.js";
Object.assign(process.env, { NODE_ENV: "test", DISCORD_TOKEN: "test", CLIENT_ID: "1", GUILD_ID: "2", MOD_LOG_CHANNEL_ID: "3", ACTIVITY_LOG_CHANNEL_ID: "3" });
test("publier : texte sans embed, journal de succès, réponse et refus non-admin", async () => {
  const { handleCommand } = await import("../src/index.js");
  const sent: any[] = [], logs: any[] = [], replies: any[] = [];
  let admin = true, replyId: string | null = null;
  const publish = async (p: any) => { sent.push(p); return { url: "https://discord.com/channels/test" }; };
  const channel = { id: "autre", isTextBased: () => true, isThread: () => false, permissionsFor: () => ({ has: (ps: bigint[]) => !ps.includes(P.EmbedLinks) }), send: publish, messages: { fetch: async () => ({ reply: publish }) } };
  const i: any = { commandName: "publier", channelId: "autre", user: { id: "admin" },
    memberPermissions: { has: () => admin },
    options: { getUser: () => null, getChannel: () => channel, getAttachment: () => null, getString: (k: string) => k === "message" ? "Bonjour à tous" : k === "message_id" ? replyId : null },
    guild: { id: "2", members: { me: {} }, channels: { fetch: async (id: string) => id === "3" ? { isTextBased: () => true, send: async (p: any) => logs.push(p) } : channel } },
    editReply: async (p: any) => replies.push(p),
  };
  await handleCommand(i);
  assert.equal(sent[0].content, "Bonjour à tous"); assert.equal(sent[0].embeds, undefined); assert.deepEqual(sent[0].allowedMentions.parse, []); assert.equal(logs.length, 1);
  replyId = "12345678901234567"; await handleCommand(i); assert.equal(sent.length, 2);
  admin = false; await handleCommand(i); assert.equal(sent.length, 2); assert.match(replies.at(-1).content, /permission/);
});
test("vocal : différencie les changements personnels et imposés et ignore les resets de connexion", () => {
  const before = { channelId: "vocal", selfMute: false, selfDeaf: false, serverMute: false, serverDeaf: false, selfVideo: false, streaming: false };
  assert.equal(voiceChanges(before, { ...before, selfMute: true }).selfMuteChanged, true);
  assert.equal(voiceChanges(before, { ...before, serverMute: true }).serverMuteChanged, true);
  assert.equal(voiceChanges({ ...before, selfMute: true }, before).selfMuteChanged, true);
  assert.equal(voiceChanges({ ...before, selfMute: true }, { ...before, channelId: null }).selfMuteChanged, false);
  assert.equal(voiceChanges({ ...before, channelId: null }, { ...before, serverMute: true }).serverMuteChanged, false);
  const all = voiceChanges(before, { ...before, selfMute: true, selfDeaf: true, serverMute: true, serverDeaf: true, selfVideo: true, streaming: true });
  assert.ok(Object.values(all).every(Boolean));
});
