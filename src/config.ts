import "dotenv/config";
const required = (key: string) => { const v = process.env[key]?.trim(); if (!v) throw new Error(`Variable manquante : ${key}`); return v; };
const ids = (key: string) => (process.env[key] ?? "").split(",").map(x => x.trim()).filter(Boolean);
const number = (key: string, fallback: number) => { const n = Number(process.env[key] ?? fallback); if (!Number.isFinite(n) || n <= 0) throw new Error(`${key} doit être strictement positif`); return n; };
const guild = {
  guildId: required("GUILD_ID"),
  modLogChannelId: required("MOD_LOG_CHANNEL_ID"),
  activityLogChannelId: process.env.ACTIVITY_LOG_CHANNEL_ID?.trim() || required("MOD_LOG_CHANNEL_ID"),
  welcomeChannelId: process.env.WELCOME_CHANNEL_ID?.trim(),
  announcementChannelIds: ids("ANNOUNCEMENT_CHANNEL_IDS"),
  antiRaidEnabled: process.env.ANTI_RAID_ENABLED !== "false",
  raidJoinLimit: number("RAID_JOIN_LIMIT", 8),
  raidWindowMs: number("RAID_WINDOW_SECONDS", 15) * 1000,
  minAccountAgeMs: number("MIN_ACCOUNT_AGE_HOURS", 24) * 3600000,
  antiApplicationsEnabled: process.env.ANTI_APPLICATIONS_ENABLED !== "false",
  allowedBotIds: ids("ALLOWED_BOT_IDS"),
  allowedWebhookIds: ids("ALLOWED_WEBHOOK_IDS"),
  blockedWords: (process.env.BLOCKED_WORDS ?? "").split(",").map(x => x.trim().normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()).filter(Boolean),
  spamMessageLimit: number("SPAM_MESSAGE_LIMIT", 10),
  spamWindowMs: number("SPAM_WINDOW_SECONDS", 5) * 1000,
  spamTimeoutMs: number("SPAM_TIMEOUT_MINUTES", 1440) * 60000,
};
export const config = { token: required("DISCORD_TOKEN"), clientId: required("CLIENT_ID"), guilds: new Map([[guild.guildId, guild]]) };
export const getGuildConfig = (id: string) => config.guilds.get(id);
