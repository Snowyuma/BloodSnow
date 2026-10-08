import {
  AuditLogEvent,
  REST,
  Routes,
  ChannelType,
  ChatInputCommandInteraction,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  Guild,
  GuildMember,
  Partials,
  PermissionFlagsBits,
} from "discord.js";
import type { GuildChannel, Message } from "discord.js";
import { assertBotIdentity } from "./identity.js";
import { config, getGuildConfig } from "./config.js";
import { announceRelease, loadState, state, saveState } from "./state.js";
import { formatDuration, parseDuration } from "./durations.js";
import { cancelScheduledBan, loadScheduledBans, scheduleBan, takeExpiredBans } from "./scheduled-bans.js";
import { addWarning, getWarnings, loadWarnings, removeLatestWarning } from "./warnings.js";

const client = new Client({
  allowedMentions: { parse: [], repliedUser: false },
  partials: [Partials.Channel, Partials.Message, Partials.User],
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
  ],
});

const recentJoins = new Map<string, number[]>();
const lockedGuilds = new Set<string>();
const recentMessages = new Map<string, Array<{ timestamp: number; message: Message }>>();
const repeatedMessages = new Map<string, { content: string; count: number; messages: Message[]; firstTimestamp: number }>();
const repeatedMessageWindowMs = 20_000;
const featureUpdateGuildIds = new Set(config.guilds.keys());
async function isBotOwner(_userId: string): Promise<boolean> { return false; }

const commandPermissions: Record<string, bigint> = {
  ban: PermissionFlagsBits.BanMembers,
  unban: PermissionFlagsBits.BanMembers,
  testmp: PermissionFlagsBits.ManageMessages,
  mp: PermissionFlagsBits.ManageMessages,
  avertissement: PermissionFlagsBits.ManageMessages,
  avertissements: PermissionFlagsBits.ManageMessages,
  retireravertissement: PermissionFlagsBits.ManageMessages,
  expulser: PermissionFlagsBits.KickMembers,
  exclu: PermissionFlagsBits.ModerateMembers,
  unexclu: PermissionFlagsBits.ModerateMembers,
  annonces: PermissionFlagsBits.Administrator,
  lockdown: PermissionFlagsBits.Administrator,
  antiraid: PermissionFlagsBits.ManageGuild,
  nettoyer: PermissionFlagsBits.Administrator,
  export: PermissionFlagsBits.Administrator,
  exportmembres: PermissionFlagsBits.Administrator,
};
async function banCleanupTarget(guild: Guild, targetId: string): Promise<boolean> {
  const existingBan = await guild.bans.fetch(targetId).catch(() => null);
  if (existingBan) return true;
  return guild.members.ban(targetId, {
    reason: "Bannissement demandé avec /nettoyer",
    deleteMessageSeconds: 7 * 24 * 60 * 60,
  }).then(() => {
    console.log(`Identifiant ${targetId} banni du serveur ${guild.id}.`);
    return true;
  }).catch((error) => {
    console.error(`Impossible de bannir l'identifiant ${targetId} :`, error);
    return false;
  });
}

async function cleanupMessagesByAuthor(guild: Guild, targetId: string): Promise<{ deleted: number; complete: boolean }> {
  console.log(`Début du parcours de l'historique pour l'identifiant ${targetId} sur le serveur ${guild.id}...`);
  const channels = await guild.channels.fetch().catch((error) => {
    console.error(`Impossible de récupérer les salons du serveur ${guild.id} :`, error);
    return null;
  });
  if (!channels) return { deleted: 0, complete: false };
  let deleted = 0;
  let complete = true;
  const activeThreads = await guild.channels.fetchActiveThreads().catch((error) => {
    console.error(`Impossible de récupérer les fils actifs du serveur ${guild.id} :`, error);
    complete = false;
    return null;
  });
  const scannableChannels = [
    ...channels.values(),
    ...(activeThreads ? [...activeThreads.threads.values()] : []),
  ];
  const seenChannels = new Set<string>();
  const botMember = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
  for (const channel of scannableChannels) {
    if (!channel || seenChannels.has(channel.id)) continue;
    seenChannels.add(channel.id);
    if (!channel?.isTextBased() || !("messages" in channel)) continue;
    const permissions = botMember ? channel.permissionsFor(botMember) : null;
    const missingPermissions = [
      [PermissionFlagsBits.ViewChannel, "Voir le salon"],
      [PermissionFlagsBits.ReadMessageHistory, "Voir les anciens messages"],
      [PermissionFlagsBits.ManageMessages, "Gérer les messages"],
    ].filter(([permission]) => !permissions?.has(permission as bigint)).map(([, label]) => label);
    if (missingPermissions.length) {
      console.error(`Salon inaccessible au nettoyage : #${channel.name} (${channel.id}). Permissions manquantes : ${missingPermissions.join(", ")}.`);
      complete = false;
      continue;
    }
    console.log(`Parcours de #${channel.name} (${channel.id})...`);
    let before: string | undefined;
    while (true) {
      const messages = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) }).catch((error) => {
        console.error(`Impossible de lire l'historique de #${channel.name} (${channel.id}) :`, error);
        return null;
      });
      if (!messages) {
        complete = false;
        break;
      }
      if (!messages.size) break;
      for (const message of messages.values()) {
        if (message.author.id !== targetId && message.applicationId !== targetId) continue;
        const removed = await message.delete().then(() => true).catch((error) => {
          console.error(`Impossible de supprimer le message ${message.id} dans #${channel.name} (${channel.id}) :`, error);
          return false;
        });
        if (removed) deleted++;
        else complete = false;
      }
      before = messages.last()?.id;
      if (messages.size < 100 || !before) break;
    }
  }
  console.log(`${deleted} message(s) de l'identifiant ${targetId} supprimé(s) sur le serveur ${guild.id}.`);
  return { deleted, complete };
}

function exportedMessage(message: Message): string {
  const embeds = message.embeds.map((embed) => [
    embed.title ? `Titre : ${embed.title}` : "",
    embed.description ? `Description : ${embed.description}` : "",
    ...embed.fields.map((field) => `${field.name} : ${field.value}`),
  ].filter(Boolean).join("\n")).filter(Boolean).join("\n");
  const attachments = [...message.attachments.values()].map((file) => file.url).join("\n");
  return [
    `[${message.createdAt.toISOString()}] ${message.author.tag} (${message.author.id}) — message ${message.id}`,
    message.content,
    embeds,
    attachments ? `Pièces jointes :\n${attachments}` : "",
  ].filter(Boolean).join("\n");
}

function deletedMessageContents(message: { content: string | null; embeds: readonly { title: string | null; description: string | null; fields: readonly { name: string; value: string }[] }[]; attachments: ReadonlyMap<string, { url: string }> }): string {
  const embeds = message.embeds.map((embed) => [
    embed.title ? `Titre : ${embed.title}` : "",
    embed.description ? `Description : ${embed.description}` : "",
    ...embed.fields.map((field) => `${field.name} : ${field.value}`),
  ].filter(Boolean).join("\n")).filter(Boolean).join("\n");
  const attachments = [...message.attachments.values()].map((file) => file.url).join("\n");
  return [message.content, embeds, attachments ? `Pièces jointes :\n${attachments}` : ""].filter(Boolean).join("\n") || "(contenu indisponible dans le cache Discord)";
}

async function reportDeletedLog(message: Message | import("discord.js").PartialMessage, deletionContext?: string | null) {
  if (!message.guild) return;
  const previousTitles = message.embeds.map((embed) => embed.title ?? "");
  const wasDeletionReport = previousTitles.some((title) => /log(?: de)? suppression supprimé|log supprimé/i.test(title));
  const executor = deletionContext ?? (message.author?.id
    ? await auditExecutor(message.guild, AuditLogEvent.MessageDelete, message.author.id)
    : null);
  await activityLog(
    message.guild,
    wasDeletionReport ? "Log de suppression supprimé" : "Log supprimé",
    `Message supprimé : **${message.id}**\nAuteur du log : ${message.author ?? "inconnu"} (${message.author?.id ?? "inconnu"})\nLog créé : <t:${Math.floor(message.createdTimestamp / 1000)}:F>\nSuppression détectée : <t:${Math.floor(Date.now() / 1000)}:F>${executor ? `\nSupprimé par : ${executor}` : "\nSupprimé par : inconnu ou auteur du message"}\n\n**Contenu du log supprimé**\n${clipped(deletedMessageContents(message), 3000)}`,
    0xdc2626,
  );
}

async function exportActivityLogs(guild: Guild): Promise<{ files: Array<{ attachment: Buffer; name: string }>; count: number }> {
  const guildConfig = getGuildConfig(guild.id);
  if (!guildConfig) return { files: [], count: 0 };
  const channel = await guild.channels.fetch(guildConfig.activityLogChannelId).catch(() => null);
  if (!channel?.isTextBased() || !("messages" in channel)) throw new Error("Salon des logs inaccessible.");

  const entries: string[] = [];
  let before: string | undefined;
  while (true) {
    const messages = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (!messages.size) break;
    entries.push(...[...messages.values()].map(exportedMessage));
    before = messages.last()?.id;
    if (messages.size < 100 || !before) break;
  }
  if (!entries.length) return { files: [], count: 0 };
  entries.reverse();

  const maxPartBytes = 7_000_000;
  const parts: string[] = [];
  let current = `Export des logs de ${guild.name} (${guild.id})\nGénéré le ${new Date().toISOString()}\n\n`;
  for (const entry of entries) {
    const addition = `${entry}\n\n${"-".repeat(80)}\n\n`;
    if (Buffer.byteLength(current + addition, "utf8") > maxPartBytes && current.trim()) {
      parts.push(current);
      current = "";
    }
    current += addition;
  }
  if (current.trim()) parts.push(current);
  if (parts.length > 10) throw new Error("L'export dépasse 10 fichiers. Exporte les logs plus régulièrement.");
  const date = new Date().toISOString().slice(0, 10);
  return {
    count: entries.length,
    files: parts.map((part, index) => ({
      attachment: Buffer.from(part, "utf8"),
      name: `logs-${guild.id}-${date}${parts.length > 1 ? `-partie-${index + 1}` : ""}.txt`,
    })),
  };
}

function csvCell(value: string | number | boolean | null | undefined): string {
  return `"${( /^[=+@\-\t\r]/.test(String(value ?? "")) ? "'" + String(value ?? "") : String(value ?? "")).replaceAll('"', '""')}"`;
}

async function exportGuildMembers(guild: Guild): Promise<{ attachment: Buffer; name: string; count: number }> {
  const members = await guild.members.fetch();
  const rows = [
    ["id", "tag_serveur", "serveur_principal_id", "tag_serveur_affiche", "tag_utilisateur", "nom_utilisateur", "nom_global", "nom_affiche", "bot", "compte_cree", "arrivee_serveur", "roles"].map(csvCell).join(","),
    ...members.map((member) => [
      member.id,
      member.user.primaryGuild?.tag,
      member.user.primaryGuild?.identityGuildId,
      member.user.primaryGuild?.identityEnabled,
      member.user.tag,
      member.user.username,
      member.user.globalName,
      member.displayName,
      member.user.bot,
      member.user.createdAt.toISOString(),
      member.joinedAt?.toISOString() ?? "",
      member.roles.cache.filter((role) => role.id !== guild.id).map((role) => `${role.name} (${role.id})`).join(" | "),
    ].map(csvCell).join(",")),
  ];
  return {
    attachment: Buffer.from(`\uFEFF${rows.join("\r\n")}`, "utf8"),
    name: `membres-${guild.id}-${new Date().toISOString().slice(0, 10)}.csv`,
    count: members.size,
  };
}

function exportAllowedHere(interaction: ChatInputCommandInteraction, ownerAccess = false): boolean {
  if (ownerAccess) return true;
  const guildConfig = interaction.guild ? getGuildConfig(interaction.guild.id) : undefined;
  if (!guildConfig) return false;
  return interaction.channelId === guildConfig.activityLogChannelId
    || interaction.channelId === guildConfig.modLogChannelId
    || guildConfig.announcementChannelIds.includes(interaction.channelId);
}

async function log(guild: Guild, title: string, description: string, color = 0xf59e0b) {
  const guildConfig = getGuildConfig(guild.id);
  if (!guildConfig) return;
  const channel = await guild.channels.fetch(guildConfig.modLogChannelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  await channel.send({ embeds: [new EmbedBuilder().setTitle(title).setDescription(description).setColor(color).setTimestamp()] }).catch(console.error);
}

function clipped(value: string | null | undefined, limit = 1500): string {
  const text = value?.trim() || "(vide ou indisponible)";
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

async function activityLog(guild: Guild, title: string, description: string, color = 0x64748b) {
  const guildConfig = getGuildConfig(guild.id);
  if (!guildConfig) return;
  const channel = await guild.channels.fetch(guildConfig.activityLogChannelId).catch(() => null);
  if (!channel?.isTextBased() || !("send" in channel)) return;
  await channel.send({
    embeds: [new EmbedBuilder().setTitle(title).setDescription(description.slice(0, 4096)).setColor(color).setTimestamp()],
    allowedMentions: { parse: [] },
  }).catch((error) => console.error("Impossible d'envoyer un journal d'activité :", error));
}

async function auditExecutor(guild: Guild, action: AuditLogEvent, targetId: string): Promise<string | null> {
  if (!guild.members.me?.permissions.has(PermissionFlagsBits.ViewAuditLog)) return null;
  await new Promise((resolve) => setTimeout(resolve, 750));
  const audit = await guild.fetchAuditLogs({ type: action, limit: 5 }).catch(() => null);
  const entry = audit?.entries.find((item) =>
    item.targetId === targetId && Date.now() - item.createdTimestamp < 5_000,
  );
  return entry?.executor ? `${entry.executor} (${entry.executor.id})` : null;
}

function permissionSnapshot(channel: GuildChannel): string {
  return [...channel.permissionOverwrites.cache.values()]
    .map((overwrite) => `${overwrite.id}:${overwrite.type}:${overwrite.allow.bitfield}:${overwrite.deny.bitfield}`)
    .sort()
    .join("|");
}

function channelChanges(oldChannel: GuildChannel, newChannel: GuildChannel): string[] {
  const changes: string[] = [];
  if (oldChannel.name !== newChannel.name) changes.push(`Nom : **${oldChannel.name}** → **${newChannel.name}**`);
  if (oldChannel.parentId !== newChannel.parentId) {
    changes.push(`Catégorie : ${oldChannel.parentId ? `<#${oldChannel.parentId}>` : "aucune"} → ${newChannel.parentId ? `<#${newChannel.parentId}>` : "aucune"}`);
  }
  if (oldChannel.rawPosition !== newChannel.rawPosition) changes.push(`Position : **${oldChannel.rawPosition}** → **${newChannel.rawPosition}**`);
  if ("topic" in oldChannel && "topic" in newChannel && oldChannel.topic !== newChannel.topic) {
    changes.push(`Sujet : ${clipped(String(oldChannel.topic ?? "(aucun)"), 300)} → ${clipped(String(newChannel.topic ?? "(aucun)"), 300)}`);
  }
  if ("nsfw" in oldChannel && "nsfw" in newChannel && oldChannel.nsfw !== newChannel.nsfw) {
    changes.push(`NSFW : **${oldChannel.nsfw ? "oui" : "non"}** → **${newChannel.nsfw ? "oui" : "non"}**`);
  }
  if ("rateLimitPerUser" in oldChannel && "rateLimitPerUser" in newChannel && oldChannel.rateLimitPerUser !== newChannel.rateLimitPerUser) {
    changes.push(`Mode lent : **${oldChannel.rateLimitPerUser}s** → **${newChannel.rateLimitPerUser}s**`);
  }
  if ("bitrate" in oldChannel && "bitrate" in newChannel && oldChannel.bitrate !== newChannel.bitrate) {
    changes.push(`Débit vocal : **${oldChannel.bitrate}** → **${newChannel.bitrate}**`);
  }
  if ("userLimit" in oldChannel && "userLimit" in newChannel && oldChannel.userLimit !== newChannel.userLimit) {
    changes.push(`Limite d'utilisateurs : **${oldChannel.userLimit || "aucune"}** → **${newChannel.userLimit || "aucune"}**`);
  }
  if (permissionSnapshot(oldChannel) !== permissionSnapshot(newChannel)) changes.push("Permissions du salon modifiées.");
  return changes;
}

function commandOptions(interaction: ChatInputCommandInteraction): string {
  if (!interaction.options.data.length) return "(aucune)";
  return interaction.options.data.map((option) => {
    if (option.name === "message") return `**${option.name}** : (contenu masqué)`;
    if (option.user) return `**${option.name}** : ${option.user.tag} (${option.user.id})`;
    if (option.channel) return `**${option.name}** : <#${option.channel.id}> (${option.channel.id})`;
    if (option.attachment) return `**${option.name}** : ${option.attachment.name}`;
    return `**${option.name}** : ${clipped(option.value === undefined ? "(non renseigné)" : String(option.value), 500)}`;
  }).join("\n");
}

const securityPending = new Set<string>();
async function securityBan(guild: Guild, userId: string, reason: string) {
  const key = `${guild.id}:${userId}`;
  if (securityPending.has(key) || userId === guild.ownerId || userId === client.user?.id) return;
  const member = await guild.members.fetch(userId).catch(() => null);
  if (member?.permissions.has(PermissionFlagsBits.Administrator)) return;
  securityPending.add(key);
  try {
    await guild.members.ban(userId, { reason: `BloodSnow : ${reason}` });
    await log(guild, "Bannissement de sécurité", `${userId} — ${reason}`, 0xdc2626);
  } catch (error) { await log(guild, "Échec du bannissement de sécurité", `${userId} — ${reason}. Vérifier les permissions et la hiérarchie.`, 0xf59e0b); }
  finally { securityPending.delete(key); }
}

async function setLockdown(guild: Guild, enabled: boolean): Promise<number> {
  const cfg = getGuildConfig(guild.id);
  if (!cfg) return 0;
  const channels = await guild.channels.fetch();
  let changed = 0;
  const snapshot = state.locks[guild.id] ??= {};
  for (const channel of channels.values()) {
    if (!channel || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type) || channel.id === cfg.modLogChannelId || channel.id === cfg.activityLogChannelId) continue;
    if (enabled && !(channel.id in snapshot)) {
      const overwrite = channel.permissionOverwrites.cache.get(guild.id);
      snapshot[channel.id] = overwrite?.deny.has(PermissionFlagsBits.SendMessages) ? false : overwrite?.allow.has(PermissionFlagsBits.SendMessages) ? true : null;
      await saveState();
    }
    if (!enabled && !(channel.id in snapshot)) continue;
    try {
      await channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: enabled ? false : snapshot[channel.id] }, { reason: "BloodSnow anti-raid" });
      changed++;
      if (!enabled) { delete snapshot[channel.id]; await saveState(); }
    } catch (error) { console.error("Lockdown : salon non traité", channel.id, error); }
  }
  if (!enabled && !Object.keys(snapshot).length) { delete state.locks[guild.id]; lockedGuilds.delete(guild.id); }
  else lockedGuilds.add(guild.id);
  await saveState(); return changed;
}

function safeHttpsUrl(value: string | null): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch { return undefined; }
}

async function notifySanction(
  member: GuildMember,
  sanction: string,
  reason: string,
  duration?: string,
): Promise<{ sent: boolean; error?: string }> {
  const lines = [
    `Tu as reçu une sanction sur **${member.guild.name}**.`,
    `Sanction : **${sanction}**`,
    `Raison : **${reason}**`,
  ];
  if (duration) lines.push(`Durée : **${duration}**`);
  lines.push("Si tu penses qu'il s'agit d'une erreur, contacte l'équipe de modération du serveur.");
  try {
    await member.user.send({ embeds: [new EmbedBuilder().setTitle("Notification de modération").setDescription(lines.join("\n")).setColor(0xef4444).setTimestamp()] });
    return { sent: true };
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : undefined;
    console.error(`Impossible d'envoyer un MP à ${member.user.tag}${code ? ` (code Discord ${code})` : ""}.`);
    return { sent: false, error: code };
  }
}

export async function handleCommand(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild) return interaction.editReply({ content: "Commande utilisable uniquement sur un serveur." });
  const guildConfig = getGuildConfig(interaction.guild.id);
  if (!guildConfig) return interaction.editReply({ content: "Ce bot n'est pas configuré pour ce serveur." });
  const ownerAccess = await isBotOwner(interaction.user.id);
  const requiredPermission = commandPermissions[interaction.commandName];
  if (requiredPermission && !ownerAccess && !interaction.memberPermissions?.has(requiredPermission)) {
    return interaction.editReply({ content: "Tu n'as pas la permission nécessaire pour utiliser cette commande." });
  }

  const target = interaction.options.getUser("membre")?.id ?? interaction.options.getString("utilisateur_id");
  if (target && ["ban", "expulser", "exclu", "unexclu", "nettoyer", "avertissement", "retireravertissement"].includes(interaction.commandName)) {
    const member = await interaction.guild.members.fetch(target).catch(() => null);
    const actor = await interaction.guild.members.fetch(interaction.user.id);
    if (target === interaction.user.id || target === interaction.client.user.id || target === interaction.guild.ownerId || (member && interaction.user.id !== interaction.guild.ownerId && actor.roles.highest.comparePositionTo(member.roles.highest) <= 0)) {
      return interaction.editReply({ content: "Action refusée : cible protégée ou rôle égal/supérieur au tien." });
    }
  }

  if (interaction.commandName === "ban") {
    const user = interaction.options.getUser("membre", true);
    const reason = interaction.options.getString("raison") ?? `Banni par ${interaction.user.tag}`;
    const hours = interaction.options.getInteger("supprimer_messages") ?? 0;
    const durationInput = interaction.options.getString("duree");
    const duration = durationInput ? parseDuration(durationInput) : null;
    if (durationInput && !duration) return interaction.editReply({ content: "Durée invalide. Utilise par exemple `30m`, `12h` ou `7j`." });
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (member && !member.bannable) return interaction.editReply({ content: "Je ne peux pas bannir ce membre (rôle trop élevé ou permission manquante)." });
    const durationLabel = duration ? formatDuration(duration) : "permanent";
    const dmResult = member ? await notifySanction(member, "Bannissement", reason, durationLabel) : { sent: false };
    await interaction.guild.members.ban(user, { reason, deleteMessageSeconds: hours * 3600 });
    if (duration) await scheduleBan({ guildId: interaction.guild.id, userId: user.id, expiresAt: Date.now() + duration });
    else await cancelScheduledBan(interaction.guild.id, user.id);
    await interaction.editReply({ content: `🔨 **${user.tag}** a été banni (${durationLabel}). Message privé : ${dmResult.sent ? "envoyé" : "refusé par Discord"}.` });
    return log(interaction.guild, "Membre banni", `${user.tag} (${user.id})\nDurée : ${durationLabel}\nMotif : ${reason}\nMessage privé : ${dmResult.sent ? "envoyé" : "non envoyé"}`, 0xef4444);
  }

  if (interaction.commandName === "testmp") {
    const member = interaction.options.getMember("membre") as GuildMember | null;
    if (!member) return interaction.editReply({ content: "Ce membre est introuvable sur le serveur." });
    if (!interaction.deferred) await interaction.deferReply({ flags: 64 });
    const result = await notifySanction(member, "Test de message privé", "Ceci est un test, aucune sanction n'a été appliquée.");
    if (result.sent) return interaction.editReply(`✅ Le message privé a bien été envoyé à **${member.user.tag}**.`);
    return interaction.editReply(`❌ Discord a refusé le message privé à **${member.user.tag}**${result.error ? ` (code ${result.error})` : ""}. La personne doit autoriser les MP des membres du serveur et ne pas avoir bloqué le bot.`);
  }

  if (interaction.commandName === "mp") {
    const user = interaction.options.getUser("membre", true);
    const message = interaction.options.getString("message", true).trim();
    if (user.bot) return interaction.editReply({ content: "Tu ne peux pas envoyer ce message privé à un bot." });
    if (!message) return interaction.editReply({ content: "Le message privé ne peut pas être vide." });

    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) return interaction.editReply({ content: "Ce membre est introuvable sur le serveur." });

    if (!interaction.deferred) await interaction.deferReply({ flags: 64 });
    try {
      await user.send(message);
      const loggedMessage = "(contenu privé masqué)";
      await log(
        interaction.guild,
        `Message privé envoyé à ${user.tag}`,
        `Destinataire : ${user} (${user.id})\nEnvoyé par : ${interaction.user} (${interaction.user.id})\nMessage : ${loggedMessage}`,
        0x8b5cf6,
      );
      return interaction.editReply(`✉️ Le message privé a bien été envoyé à **${user.tag}**.`);
    } catch (error) {
      const code = typeof error === "object" && error && "code" in error ? String(error.code) : undefined;
      console.error(`Impossible d'envoyer un MP à ${user.tag}${code ? ` (code Discord ${code})` : ""}.`);
      return interaction.editReply(
        `❌ Discord a refusé le message privé à **${user.tag}**${code ? ` (code ${code})` : ""}. La personne doit autoriser les MP des membres du serveur et ne pas avoir bloqué le bot.`,
      );
    }
  }

  if (interaction.commandName === "avertissement") {
    const user = interaction.options.getUser("membre", true);
    const reason = interaction.options.getString("raison", true).trim();
    if (user.bot) return interaction.editReply({ content: "Tu ne peux pas donner un avertissement à un bot." });
    if (user.id === interaction.user.id) return interaction.editReply({ content: "Tu ne peux pas te donner un avertissement à toi-même." });

    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) return interaction.editReply({ content: "Ce membre est introuvable sur le serveur." });

    if (!interaction.deferred) await interaction.deferReply({ flags: 64 });
    const dmResult = await notifySanction(member, "Avertissement", reason);
    const warningCount = await addWarning({
      guildId: interaction.guild.id,
      userId: user.id,
      moderatorId: interaction.user.id,
      reason,
      createdAt: Date.now(),
    });
    await log(
      interaction.guild,
      `Avertissement pour ${user.tag}`,
      `Membre : ${user} (${user.id})\nModérateur : ${interaction.user} (${interaction.user.id})\nRaison : ${reason}\nTotal : ${warningCount}\nMessage privé : ${dmResult.sent ? "envoyé" : "non envoyé"}`,
      0xf59e0b,
    );
    return interaction.editReply(
      `⚠️ Avertissement n°${warningCount} enregistré pour **${user.tag}**. Message privé : ${dmResult.sent ? "envoyé" : "non envoyé (MP fermés ou bot bloqué)"}.`,
    );
  }

  if (interaction.commandName === "avertissements") {
    const user = interaction.options.getUser("membre", true);
    const warnings = getWarnings(interaction.guild.id, user.id);
    if (!warnings.length) return interaction.editReply({ content: `**${user.tag}** n'a aucun avertissement.` });
    const history = warnings.slice(-10).map((warning, index) =>
      `**${warnings.length - Math.min(10, warnings.length) + index + 1}.** <t:${Math.floor(warning.createdAt / 1000)}:d> — ${clipped(warning.reason, 250)} — <@${warning.moderatorId}>`,
    );
    return interaction.editReply({
      content: `⚠️ **${warnings.length} avertissement(s) pour ${user.tag}**\n${history.join("\n")}${warnings.length > 10 ? "\n_Les 10 plus récents sont affichés._" : ""}`,
      
      allowedMentions: { parse: [] },
    });
  }

  if (interaction.commandName === "retireravertissement") {
    const user = interaction.options.getUser("membre", true);
    const removalReason = interaction.options.getString("raison")?.trim() || "Aucun motif indiqué";
    const removed = await removeLatestWarning(interaction.guild.id, user.id);
    if (!removed) return interaction.editReply({ content: `**${user.tag}** n'a aucun avertissement à retirer.` });
    const remaining = getWarnings(interaction.guild.id, user.id).length;
    await log(
      interaction.guild,
      `Avertissement retiré pour ${user.tag}`,
      `Membre : ${user} (${user.id})\nModérateur : ${interaction.user} (${interaction.user.id})\nAvertissement retiré : ${removed.reason}\nMotif du retrait : ${removalReason}\nTotal restant : ${remaining}`,
      0x22c55e,
    );
    return interaction.editReply({ content: `✅ Dernier avertissement de **${user.tag}** retiré. Total restant : **${remaining}**.` });
  }

  if (interaction.commandName === "unban") {
    const userId = interaction.options.getString("utilisateur_id", true).trim();
    const reason = interaction.options.getString("raison") ?? `Débanni par ${interaction.user.tag}`;
    if (!/^\d{17,20}$/.test(userId)) return interaction.editReply({ content: "L'identifiant Discord est invalide." });
    const ban = await interaction.guild.bans.fetch(userId).catch(() => null);
    if (!ban) return interaction.editReply({ content: "Cet utilisateur n'est pas banni sur ce serveur." });
    await interaction.guild.members.unban(userId, reason);
    await cancelScheduledBan(interaction.guild.id, userId);
    await interaction.editReply({ content: `✅ **${ban.user.tag}** a été débanni.` });
    return log(interaction.guild, "Membre débanni", `${ban.user.tag} (${userId})\nMotif : ${reason}`, 0x22c55e);
  }

  if (interaction.commandName === "expulser") {
    const member = interaction.options.getMember("membre") as GuildMember | null;
    const reason = interaction.options.getString("raison") ?? `Expulsé par ${interaction.user.tag}`;
    if (!member?.kickable) return interaction.editReply({ content: "Je ne peux pas expulser ce membre." });
    await member.kick(reason);
    await interaction.editReply({ content: `👢 **${member.user.tag}** a été expulsé.` });
    return log(interaction.guild, "Membre expulsé", `${member.user.tag} (${member.id})\nMotif : ${reason}`, 0xf97316);
  }

  if (interaction.commandName === "exclu") {
    const member = interaction.options.getMember("membre") as GuildMember | null;
    const durationInput = interaction.options.getString("duree", true);
    const duration = parseDuration(durationInput);
    const reason = interaction.options.getString("raison") ?? `Exclu par ${interaction.user.tag}`;
    if (!duration) return interaction.editReply({ content: "Durée invalide. Utilise par exemple `10m`, `2h` ou `7j`." });
    if (duration > 28 * 86_400_000) return interaction.editReply({ content: "Discord limite une exclusion temporaire à 28 jours." });
    if (!member?.moderatable) return interaction.editReply({ content: "Je ne peux pas exclure ce membre (rôle trop élevé ou permission manquante)." });
    await member.timeout(duration, reason);
    await interaction.editReply({ content: `🔇 **${member.user.tag}** est exclu pour ${formatDuration(duration)}.` });
    return log(interaction.guild, "Membre exclu temporairement", `${member.user.tag} (${member.id})\nDurée : ${formatDuration(duration)}\nMotif : ${reason}`, 0xf97316);
  }

  if (interaction.commandName === "unexclu") {
    const member = interaction.options.getMember("membre") as GuildMember | null;
    const reason = interaction.options.getString("raison") ?? `Exclusion retirée par ${interaction.user.tag}`;
    if (!member?.moderatable) return interaction.editReply({ content: "Je ne peux pas modifier ce membre." });
    if (!member.isCommunicationDisabled()) return interaction.editReply({ content: "Ce membre n'est pas actuellement exclu." });
    await member.timeout(null, reason);
    await interaction.editReply({ content: `🔊 L'exclusion de **${member.user.tag}** a été retirée.` });
    return log(interaction.guild, "Exclusion retirée", `${member.user.tag} (${member.id})\nMotif : ${reason}`, 0x22c55e);
  }

  if (interaction.commandName === "annonces") {
    const selectedChannel = interaction.options.getChannel("salon");
    const targetChannel = await interaction.guild.channels.fetch(selectedChannel?.id ?? interaction.channelId).catch(() => null);
    if (!targetChannel?.isTextBased() || !("send" in targetChannel)) return interaction.editReply({ content: "Le salon sélectionné ne permet pas l'envoi de messages." });
    const bot = interaction.guild.members.me ?? await interaction.guild.members.fetchMe();
    const permissions = targetChannel.permissionsFor(bot);
    const sendPermission = targetChannel.isThread() ? PermissionFlagsBits.SendMessagesInThreads : PermissionFlagsBits.SendMessages;
    if (!permissions?.has([PermissionFlagsBits.ViewChannel, sendPermission, PermissionFlagsBits.EmbedLinks])) {
      return interaction.editReply({ content: "BloodSnow doit pouvoir voir ce salon, y envoyer des messages et intégrer des liens." });
    }
    const message = interaction.options.getString("message", true);
    const replyToMessageId = interaction.options.getString("message_id")?.trim();
    const attachment = interaction.options.getAttachment("image");
    const urlInput = interaction.options.getString("image_url");
    if (replyToMessageId && !/^\d{17,20}$/.test(replyToMessageId)) {
      return interaction.editReply({ content: "L'identifiant du message est invalide. Active le mode développeur Discord, puis utilise « Copier l'identifiant du message »." });
    }
    if (attachment && !attachment.contentType?.startsWith("image/")) return interaction.editReply({ content: "Le fichier joint doit être une image." });
    const imageUrl = attachment?.url ?? safeHttpsUrl(urlInput);
    if (urlInput && !imageUrl) return interaction.editReply({ content: "L'URL de l'image doit être une URL HTTPS valide." });
    const embed = new EmbedBuilder().setTitle(interaction.options.getString("titre") ?? "Annonce BloodSnow").setDescription(message).setColor(0xb91c1c).setTimestamp().setFooter({ text: "BloodSnow • Annonce officielle" });
    if (imageUrl) embed.setImage(imageUrl);
    const payload = { embeds: [embed], allowedMentions: { parse: [] as never[] } };
    if (replyToMessageId) {
      if (!("messages" in targetChannel)) return interaction.editReply({ content: "Ce salon ne permet pas de répondre à un message." });
      const targetMessage = await targetChannel.messages.fetch(replyToMessageId).catch(() => null);
      if (!targetMessage) return interaction.editReply({ content: "Message introuvable dans le salon sélectionné. Vérifie le salon et l'identifiant." });
      await targetMessage.reply(payload);
      return interaction.editReply({ content: `Réponse publiée dans <#${targetChannel.id}>.` });
    }
    await targetChannel.send(payload);
    return interaction.editReply({ content: `Message publié dans <#${targetChannel.id}>.` });
  }

  if (interaction.commandName === "lockdown") {
    if (!interaction.deferred) await interaction.deferReply({ flags: 64 });
    const enabled = interaction.options.getString("action", true) === "on";
    const count = await setLockdown(interaction.guild, enabled);
    await interaction.editReply(`${enabled ? "🔒 Serveur verrouillé" : "🔓 Serveur déverrouillé"} (${count} salons traités).`);
    return log(interaction.guild, enabled ? "Lockdown activé" : "Lockdown désactivé", `Action manuelle par ${interaction.user.tag}.`, enabled ? 0xef4444 : 0x22c55e);
  }

  if (interaction.commandName === "antiraid") {
    return interaction.editReply({ content: [`Protection : **${guildConfig.antiRaidEnabled ? "active" : "inactive"}**`, `Seuil : **${guildConfig.raidJoinLimit} arrivées / ${guildConfig.raidWindowMs / 1000}s**`, `Âge minimal : **${guildConfig.minAccountAgeMs / 3_600_000}h**`, `Lockdown : **${lockedGuilds.has(interaction.guild.id) ? "actif" : "inactif"}**`].join("\n") });
  }

  if (interaction.commandName === "nettoyer") {
    if (!ownerAccess && !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.editReply({ content: "Cette commande est réservée aux administrateurs." });
    }
    const targetId = interaction.options.getString("utilisateur_id", true).trim();
    if (!/^\d{17,20}$/.test(targetId)) {
      return interaction.editReply({ content: "L'identifiant Discord est invalide." });
    }
    if (targetId === interaction.client.user.id) {
      return interaction.editReply({ content: "Je refuse de me bannir moi-même." });
    }
    if (!interaction.deferred) await interaction.deferReply({ flags: 64 });
    const banned = await banCleanupTarget(interaction.guild, targetId);
    const cleanup = await cleanupMessagesByAuthor(interaction.guild, targetId);
    return interaction.editReply(
      `Nettoyage de **${targetId}** terminé. Bannissement : **${banned ? "réussi ou déjà actif" : "impossible"}**. Messages supprimés : **${cleanup.deleted}**.${cleanup.complete ? " Tous les salons accessibles ont été parcourus." : " Certains salons n'ont pas pu être parcourus : consulte la console."}`,
    );
  }

  if (interaction.commandName === "export") {
    if (!ownerAccess && !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.editReply({ content: "Cette commande est réservée aux administrateurs." });
    }
    if (!exportAllowedHere(interaction, ownerAccess)) {
      return interaction.editReply({ content: "Utilise cette commande dans le salon des logs ou dans un salon autorisé au staff." });
    }
    if (!interaction.deferred) await interaction.deferReply({ flags: 64 });
    const exported = await exportActivityLogs(interaction.guild);
    if (!exported.files.length) return interaction.editReply("Aucun log à exporter.");
    await interaction.user.send({
      content: `Export des logs de **${interaction.guild.name}** : ${exported.count} message(s).`,
      files: exported.files,
    });
    await activityLog(interaction.guild, "Export des logs effectué", `Administrateur : ${interaction.user} (${interaction.user.tag} — ${interaction.user.id})\nSalon de la commande : <#${interaction.channelId}>\nMessages exportés : **${exported.count}**\nFichiers envoyés en message privé : **${exported.files.length}**`, 0x0ea5e9);
    return interaction.editReply("Export terminé et envoyé dans tes messages privés. L'opération a été consignée dans les logs.");
  }

  if (interaction.commandName === "exportmembres") {
    if (!ownerAccess && !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.editReply({ content: "Cette commande est réservée aux administrateurs." });
    }
    if (!exportAllowedHere(interaction, ownerAccess)) {
      return interaction.editReply({ content: "Utilise cette commande dans le salon des logs ou dans un salon autorisé au staff." });
    }
    if (!interaction.deferred) await interaction.deferReply({ flags: 64 });
    const exported = await exportGuildMembers(interaction.guild);
    await interaction.user.send({
      content: `Export des membres de **${interaction.guild.name}** : ${exported.count} membre(s).`,
      files: [{ attachment: exported.attachment, name: exported.name }],
    });
    await activityLog(interaction.guild, "Export des membres effectué", `Administrateur : ${interaction.user} (${interaction.user.tag} — ${interaction.user.id})\nSalon de la commande : <#${interaction.channelId}>\nMembres exportés : **${exported.count}**\nFichier envoyé en message privé.`, 0x0ea5e9);
    return interaction.editReply("Export terminé et envoyé dans tes messages privés. L'opération a été consignée dans les logs.");
  }
}

client.once(Events.ClientReady, async (ready) => {

  for (const id of Object.keys(state.locks)) lockedGuilds.add(id);

  console.log(`Connecté en tant que ${ready.user.tag}.`);
  for (const guildId of featureUpdateGuildIds) {
    const guild = ready.guilds.cache.get(guildId);
    if (guild) await announceRelease(guild).catch(console.error);
  }

  setInterval(async () => {
    for (const ban of await takeExpiredBans()) {
      const guild = ready.guilds.cache.get(ban.guildId);
      if (!guild) continue;
      const user = await guild.bans.fetch(ban.userId).catch(() => null);
      if (!user) continue;
      try { await guild.members.unban(ban.userId, "Fin du bannissement temporaire"); } catch (error) { console.error(error); continue; }
      await cancelScheduledBan(ban.guildId, ban.userId);
      await log(guild, "Bannissement temporaire terminé", `${user.user.tag} (${ban.userId}) a été débanni automatiquement.`, 0x22c55e);
    }
  }, 30_000);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (!interaction.deferred) await interaction.deferReply({ flags: 64 });
      if (interaction.guild && getGuildConfig(interaction.guild.id)) {
        await activityLog(
          interaction.guild,
          `Commande /${interaction.commandName}`,
          `Utilisateur : ${interaction.user} (${interaction.user.tag} — ${interaction.user.id})\nSalon : <#${interaction.channelId}>\nOptions :\n${commandOptions(interaction)}`,
          0x8b5cf6,
        );
      }
      await handleCommand(interaction);
    }
    else if (interaction.isUserContextMenuCommand() && interaction.commandName === "Informations du compte") {
      await interaction.deferReply({ flags: 64 });
      const ownerAccess = await isBotOwner(interaction.user.id);
      if (!ownerAccess && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.editReply({ content: "Tu n'as pas la permission nécessaire pour utiliser cette commande." });
      }
      if (interaction.guild && getGuildConfig(interaction.guild.id)) {
        await activityLog(
          interaction.guild,
          `Commande ${interaction.commandName}`,
          `Utilisateur : ${interaction.user} (${interaction.user.tag} — ${interaction.user.id})\nCible : ${interaction.targetUser} (${interaction.targetUser.tag} — ${interaction.targetId})\nSalon : <#${interaction.channelId}>`,
          0x8b5cf6,
        );
      }
      const ageDays = Math.floor((Date.now() - interaction.targetUser.createdTimestamp) / 86_400_000);
      await interaction.editReply({ content: `Compte : **${interaction.targetUser.tag}**\nIdentifiant : \`${interaction.targetId}\`\nÂge : **${ageDays} jours**\nCréé : <t:${Math.floor(interaction.targetUser.createdTimestamp / 1000)}:F>` });
    }
  } catch (error) {
    console.error(error);
    const payload = { content: "Une erreur est survenue. Vérifie mes permissions et les logs. Pour un export, vérifie que tes MP sont ouverts : aucun fichier ne sera publié dans un salon." };
    if (interaction.isRepliable()) interaction.replied || interaction.deferred ? await interaction.editReply({ content: payload.content }).catch(() => undefined) : await interaction.reply({ content: payload.content, flags: 64 }).catch(() => undefined);
  }
});

client.on(Events.ChannelCreate, async (channel) => {
  const guildConfig = getGuildConfig(channel.guild.id);
  if (!guildConfig) return;
  const executor = await auditExecutor(channel.guild, AuditLogEvent.ChannelCreate, channel.id);
  await activityLog(
    channel.guild,
    "Salon créé",
    `Salon : ${channel} (**${channel.name}** — ${channel.id})\nType : **${ChannelType[channel.type] ?? channel.type}**${channel.parentId ? `\nCatégorie : <#${channel.parentId}>` : ""}${executor ? `\nCréé par : ${executor}` : ""}`,
    0x22c55e,
  );
});

client.on(Events.ChannelDelete, async (channel) => {
  if (!("guild" in channel)) return;
  if (!getGuildConfig(channel.guild.id)) return;
  const executor = await auditExecutor(channel.guild, AuditLogEvent.ChannelDelete, channel.id);
  await activityLog(
    channel.guild,
    "Salon supprimé",
    `Salon : **${channel.name}** (${channel.id})\nType : **${ChannelType[channel.type] ?? channel.type}**${channel.parentId ? `\nAncienne catégorie : <#${channel.parentId}>` : ""}${executor ? `\nSupprimé par : ${executor}` : ""}`,
    0xef4444,
  );
});

client.on(Events.ChannelUpdate, async (oldChannel, newChannel) => {
  if (!("guild" in oldChannel) || !("guild" in newChannel)) return;
  if (!getGuildConfig(newChannel.guild.id)) return;
  const changes = channelChanges(oldChannel, newChannel);
  if (!changes.length) return;
  const executor = await auditExecutor(newChannel.guild, AuditLogEvent.ChannelUpdate, newChannel.id);
  await activityLog(
    newChannel.guild,
    "Salon modifié",
    `Salon : ${newChannel} (**${newChannel.name}** — ${newChannel.id})\n${changes.join("\n")}${executor ? `\nModifié par : ${executor}` : ""}`,
    0xf59e0b,
  );
});

client.on(Events.GuildRoleCreate, async (role) => {
  if (!getGuildConfig(role.guild.id)) return;
  const executor = await auditExecutor(role.guild, AuditLogEvent.RoleCreate, role.id);
  await activityLog(role.guild, "Rôle créé", `Rôle : ${role} (**${role.name}** — ${role.id})\nPermissions : \`${role.permissions.bitfield}\`${executor ? `\nCréé par : ${executor}` : ""}`, 0x22c55e);
});

client.on(Events.GuildRoleDelete, async (role) => {
  if (!getGuildConfig(role.guild.id)) return;
  const executor = await auditExecutor(role.guild, AuditLogEvent.RoleDelete, role.id);
  await activityLog(role.guild, "Rôle supprimé", `Rôle : **${role.name}** (${role.id})\nPermissions : \`${role.permissions.bitfield}\`${executor ? `\nSupprimé par : ${executor}` : ""}`, 0xef4444);
});

client.on(Events.GuildRoleUpdate, async (oldRole, newRole) => {
  if (!getGuildConfig(newRole.guild.id)) return;
  const changes = [
    oldRole.name !== newRole.name ? `Nom : **${oldRole.name}** → **${newRole.name}**` : null,
    oldRole.color !== newRole.color ? `Couleur : **${oldRole.hexColor}** → **${newRole.hexColor}**` : null,
    oldRole.permissions.bitfield !== newRole.permissions.bitfield ? `Permissions : \`${oldRole.permissions.bitfield}\` → \`${newRole.permissions.bitfield}\`` : null,
    oldRole.hoist !== newRole.hoist ? `Affiché séparément : **${oldRole.hoist}** → **${newRole.hoist}**` : null,
    oldRole.mentionable !== newRole.mentionable ? `Mentionnable : **${oldRole.mentionable}** → **${newRole.mentionable}**` : null,
  ].filter((change): change is string => Boolean(change));
  if (!changes.length) return;
  const executor = await auditExecutor(newRole.guild, AuditLogEvent.RoleUpdate, newRole.id);
  await activityLog(newRole.guild, "Rôle modifié", `Rôle : ${newRole} (${newRole.id})\n${changes.join("\n")}${executor ? `\nModifié par : ${executor}` : ""}`, 0xf59e0b);
});

client.on(Events.GuildUpdate, async (oldGuild, newGuild) => {
  if (!getGuildConfig(newGuild.id)) return;
  const changes = [
    oldGuild.name !== newGuild.name ? `Nom : **${oldGuild.name}** → **${newGuild.name}**` : null,
    oldGuild.description !== newGuild.description ? `Description : **${clipped(oldGuild.description, 500)}** → **${clipped(newGuild.description, 500)}**` : null,
    oldGuild.verificationLevel !== newGuild.verificationLevel ? `Vérification : **${oldGuild.verificationLevel}** → **${newGuild.verificationLevel}**` : null,
    oldGuild.explicitContentFilter !== newGuild.explicitContentFilter ? `Filtre de contenu : **${oldGuild.explicitContentFilter}** → **${newGuild.explicitContentFilter}**` : null,
    oldGuild.defaultMessageNotifications !== newGuild.defaultMessageNotifications ? `Notifications par défaut : **${oldGuild.defaultMessageNotifications}** → **${newGuild.defaultMessageNotifications}**` : null,
  ].filter((change): change is string => Boolean(change));
  if (!changes.length) return;
  const executor = await auditExecutor(newGuild, AuditLogEvent.GuildUpdate, newGuild.id);
  await activityLog(newGuild, "Paramètres du serveur modifiés", `${changes.join("\n")}${executor ? `\nModifiés par : ${executor}` : ""}`, 0xf59e0b);
});

client.on(Events.GuildIntegrationsUpdate, async (guild) => {
  if (!getGuildConfig(guild.id)) return;
  await activityLog(guild, "Intégrations du serveur modifiées", "Une application ou une intégration du serveur a été ajoutée, modifiée ou retirée. Consulte le journal d'audit Discord pour le détail.", 0x8b5cf6);
});

client.on(Events.WebhooksUpdate, async (channel) => {
  if (!getGuildConfig(channel.guild.id)) return;
  await activityLog(channel.guild, "Webhooks modifiés", `Les webhooks de ${channel} (**${channel.name}** — ${channel.id}) ont été modifiés.`, 0x8b5cf6);
});

client.on(Events.GuildMemberAdd, async (member) => {
  const guildConfig = getGuildConfig(member.guild.id);
  if (!guildConfig) return;
  await activityLog(member.guild, "Membre arrivé", `${member} (${member.user.tag} — ${member.id})`, 0x22c55e);
  if (member.user.bot && guildConfig.antiApplicationsEnabled && !guildConfig.allowedBotIds.includes(member.id)) {
    await securityBan(member.guild, member.id, "Bot absent de la liste des bots autorisés"); return;
  }
  if (!guildConfig.antiRaidEnabled || member.user.bot) return;
  const now = Date.now();
  const joins = (recentJoins.get(member.guild.id) ?? []).filter(time => now - time <= guildConfig.raidWindowMs);
  joins.push(now); recentJoins.set(member.guild.id, joins);
  if (joins.length >= guildConfig.raidJoinLimit) {
    if (!lockedGuilds.has(member.guild.id)) {
      const count = await setLockdown(member.guild, true);
      await log(member.guild, "Raid détecté", `${joins.length} arrivées en rafale ; ${count} salons verrouillés.`, 0xdc2626);
    }
    for (const candidate of member.guild.members.cache.values()) {
      if (!candidate.user.bot && candidate.joinedTimestamp && now - candidate.joinedTimestamp <= guildConfig.raidWindowMs && now - candidate.user.createdTimestamp < guildConfig.minAccountAgeMs)
        await securityBan(member.guild, candidate.id, "Compte récent arrivé pendant une rafale anti-raid");
    }
  }
});

client.on(Events.GuildMemberRemove, async (member) => {
  if (!getGuildConfig(member.guild.id)) return;
  await activityLog(member.guild, "Membre parti ou expulsé", `${member.user.tag} (${member.id})`, 0xef4444);
});

client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
  const guildConfig = newMessage.guild ? getGuildConfig(newMessage.guild.id) : undefined;
  if (!newMessage.guild || !guildConfig || newMessage.author?.bot) return;
  if (newMessage.channelId === guildConfig.activityLogChannelId || oldMessage.content === newMessage.content) return;
  await activityLog(
    newMessage.guild,
    "Message modifié",
    `Auteur : ${newMessage.author ?? "inconnu"} (${newMessage.author?.id ?? "inconnu"})\nSalon : <#${newMessage.channelId}>\n[Accéder au message](${newMessage.url})\n\n**Avant**\n${clipped(oldMessage.content)}\n\n**Après**\n${clipped(newMessage.content)}`,
    0xf59e0b,
  );
});

client.on(Events.MessageDelete, async (message) => {
  const guildConfig = message.guild ? getGuildConfig(message.guild.id) : undefined;
  if (!message.guild || !guildConfig) return;
  if (message.channelId === guildConfig.activityLogChannelId) {
    if (!message.partial) await reportDeletedLog(message);
    else await activityLog(message.guild, "Log supprimé", `Message supprimé : **${message.id}**\nLe contenu et l'auteur n'étaient plus disponibles dans le cache Discord.`, 0xdc2626);
    return;
  }
  if (message.author?.bot) return;
  const attachments = [...message.attachments.values()].map((file) => file.url).join("\n");
  await activityLog(
    message.guild,
    "Message supprimé",
    `Auteur : ${message.author ?? "inconnu"} (${message.author?.id ?? "inconnu"})\nSalon : <#${message.channelId}>\n\n**Contenu**\n${clipped(message.content)}${attachments ? `\n\n**Pièces jointes**\n${clipped(attachments, 1000)}` : ""}`,
    0xef4444,
  );
});

client.on(Events.MessageBulkDelete, async (messages, channel) => {
  if (!channel.isTextBased() || !("guild" in channel)) return;
  const guildConfig = getGuildConfig(channel.guild.id);
  if (!guildConfig || channel.id !== guildConfig.activityLogChannelId) return;
  for (const message of messages.values()) {
    await reportDeletedLog(message, "suppression groupée par un modérateur (identité indisponible)");
  }
});

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  const guild = newState.guild;
  if (!getGuildConfig(guild.id) || newState.member?.user.bot) return;

  const member = newState.member ?? oldState.member;
  const identity = member ? `${member} (${member.user.tag} — ${member.id})` : `Membre ${newState.id}`;
  const serverMuteChanged = oldState.serverMute !== newState.serverMute;
  const serverDeafChanged = oldState.serverDeaf !== newState.serverDeaf;
  const selfMuteChanged = oldState.selfMute !== newState.selfMute;
  const selfDeafChanged = oldState.selfDeaf !== newState.selfDeaf;
  const cameraChanged = oldState.selfVideo !== newState.selfVideo;
  const streamChanged = oldState.streaming !== newState.streaming;

  if (serverMuteChanged || serverDeafChanged) {
    const moderator = await auditExecutor(guild, AuditLogEvent.MemberUpdate, newState.id);
    const actions = [
      serverMuteChanged ? `Microphone serveur : **${newState.serverMute ? "coupé" : "réactivé"}**` : null,
      serverDeafChanged ? `Son serveur : **${newState.serverDeaf ? "coupé" : "réactivé"}**` : null,
    ].filter((action): action is string => Boolean(action));
    await activityLog(
      guild,
      "Modération vocale",
      `${identity}\n${actions.join("\n")}${newState.channelId ? `\nSalon : <#${newState.channelId}>` : ""}${moderator ? `\nModérateur : ${moderator}` : ""}`,
      newState.serverMute || newState.serverDeaf ? 0xef4444 : 0x22c55e,
    );
  }

  if (selfMuteChanged || selfDeafChanged || cameraChanged || streamChanged) {
    const actions = [
      selfMuteChanged ? `Microphone personnel : **${newState.selfMute ? "coupé" : "réactivé"}**` : null,
      selfDeafChanged ? `Casque personnel : **${newState.selfDeaf ? "coupé" : "réactivé"}**` : null,
      cameraChanged ? `Caméra : **${newState.selfVideo ? "activée" : "désactivée"}**` : null,
      streamChanged ? `Partage d'écran : **${newState.streaming ? "démarré" : "arrêté"}**` : null,
    ].filter((action): action is string => Boolean(action));
    await activityLog(
      guild,
      "Activité vocale personnelle",
      `${identity}\n${actions.join("\n")}${newState.channelId ? `\nSalon : <#${newState.channelId}>` : ""}`,
      newState.selfVideo || newState.streaming ? 0x3b82f6 : 0x64748b,
    );
  }

  if (oldState.channelId === newState.channelId) return;

  if (!oldState.channelId && newState.channelId) {
    await activityLog(guild, "Connexion vocale", `${identity}\nSalon : <#${newState.channelId}>`, 0x22c55e);
    return;
  }

  if (oldState.channelId && !newState.channelId) {
    const moderator = await auditExecutor(guild, AuditLogEvent.MemberDisconnect, newState.id);
    await activityLog(
      guild,
      moderator ? "Expulsion d'un salon vocal" : "Déconnexion vocale",
      `${identity}\nAncien salon : <#${oldState.channelId}>${moderator ? `\nModérateur : ${moderator}` : ""}`,
      moderator ? 0xef4444 : 0x64748b,
    );
    return;
  }

  if (oldState.channelId && newState.channelId) {
    const moderator = await auditExecutor(guild, AuditLogEvent.MemberMove, newState.id);
    await activityLog(
      guild,
      moderator ? "Membre déplacé par un modérateur" : "Changement de salon vocal",
      `${identity}\nDe : <#${oldState.channelId}>\nVers : <#${newState.channelId}>${moderator ? `\nModérateur : ${moderator}` : ""}`,
      moderator ? 0xf97316 : 0x3b82f6,
    );
  }
});

client.on(Events.MessageCreate, async (message) => {
  const guildConfig = message.guild ? getGuildConfig(message.guild.id) : undefined;
  if (!message.guild || !guildConfig) return;
  if (message.author.id === client.user?.id) return;
  if (message.author.bot || message.webhookId || message.applicationId) {
    const approved = message.webhookId && guildConfig.allowedWebhookIds.includes(message.webhookId)
      || guildConfig.allowedBotIds.includes(message.applicationId ?? message.author.id);
    if (guildConfig.antiApplicationsEnabled && !approved) {
      const deleted = await message.delete().then(() => true).catch(() => false);
      await activityLog(message.guild, "Application non autorisée", `Application : ${message.applicationId ?? message.author.id} ; webhook : ${message.webhookId ?? "aucun"} ; suppression : ${deleted ? "réussie" : "impossible"}.`, 0xdc2626);
      if (!message.webhookId || message.applicationId) await securityBan(message.guild, message.applicationId ?? message.author.id, "Message d'une application non autorisée");
      return;
    }
    if (message.channelId !== guildConfig.activityLogChannelId) {
      await activityLog(
        message.guild,
        "Activité d'une application",
        `Auteur : ${message.author} (${message.author.tag} — ${message.author.id})\nApplication : **${message.applicationId ?? "non indiquée"}**\nWebhook : **${message.webhookId ?? "non indiqué"}**\nSalon : <#${message.channelId}>\nMessage : ${clipped(message.content, 1200)}`,
        0x8b5cf6,
      );
    }
    return;
  }

  if (message.member && !message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
    const duplicateKey = `${message.guild.id}:${message.author.id}`;
    const exactContent = message.content.normalize("NFKC").trim();
    if (exactContent) {
      const previous = repeatedMessages.get(duplicateKey);
      const now = Date.now();
      const repeated = previous?.content === exactContent && now - previous.firstTimestamp <= repeatedMessageWindowMs
        ? { content: exactContent, count: previous.count + 1, messages: [...previous.messages, message].slice(-5), firstTimestamp: previous.firstTimestamp }
        : { content: exactContent, count: 1, messages: [message], firstTimestamp: now };
      repeatedMessages.set(duplicateKey, repeated);
      if (repeated.count >= 5) {
        repeatedMessages.delete(duplicateKey);
        const timedOut = message.member.moderatable
          ? await message.member.timeout(24 * 60 * 60_000, "5 messages identiques consécutifs")
            .then(() => true)
            .catch((error) => {
              console.error(`Impossible d'exclure temporairement ${message.author.tag} pour messages répétés :`, error);
              return false;
            })
          : false;
        const deletedMessages = (await Promise.all(
          repeated.messages.map((repeatedMessage) => repeatedMessage.delete().then(() => true).catch(() => false)),
        )).filter(Boolean).length;
        await activityLog(
          message.guild,
          timedOut ? "Messages répétés : membre exclu 24 heures" : "Messages répétés : exclusion impossible",
          `Membre : ${message.author} (${message.author.tag} — ${message.author.id})\nDétection : **5 messages strictement identiques en moins de 20 secondes**\nMessages supprimés : **${deletedMessages}/${repeated.messages.length}**\nContenu : ${clipped(exactContent, 1000)}\nSalon : <#${message.channelId}>`,
          timedOut ? 0xef4444 : 0xf59e0b,
        );
        return;
      }
    } else {
      repeatedMessages.delete(duplicateKey);
    }
  }

  if (
    guildConfig.spamMessageLimit &&
    guildConfig.spamWindowMs &&
    guildConfig.spamTimeoutMs &&
    message.member &&
    !message.member.permissions.has(PermissionFlagsBits.ManageMessages)
  ) {
    const key = `${message.guild.id}:${message.author.id}`;
    const now = Date.now();
    const recent = (recentMessages.get(key) ?? []).filter((entry) => now - entry.timestamp <= guildConfig.spamWindowMs!);
    recent.push({ timestamp: now, message });
    recentMessages.set(key, recent);
    if (recent.length >= guildConfig.spamMessageLimit) {
      recentMessages.delete(key);
      const timedOut = message.member.moderatable
        ? await message.member.timeout(guildConfig.spamTimeoutMs, `${guildConfig.spamMessageLimit} messages en ${guildConfig.spamWindowMs / 1000} seconde(s)`)
          .then(() => true)
          .catch((error) => {
            console.error(`Impossible d'exclure temporairement ${message.author.tag} pour spam :`, error);
            return false;
          })
        : false;
      const deletedMessages = (await Promise.all(
        recent.map((entry) => entry.message.delete().then(() => true).catch(() => false)),
      )).filter(Boolean).length;
      await activityLog(
        message.guild,
        timedOut ? "Anti-spam : membre exclu temporairement" : "Anti-spam : exclusion impossible",
        `Membre : ${message.author} (${message.author.tag} — ${message.author.id})\nDétection : **${guildConfig.spamMessageLimit} messages en ${guildConfig.spamWindowMs / 1000} seconde(s)**\nMessages supprimés : **${deletedMessages}/${recent.length}**\nDurée prévue : **${formatDuration(guildConfig.spamTimeoutMs)}**\nSalon : <#${message.channelId}>`,
        timedOut ? 0xef4444 : 0xf59e0b,
      );
      return;
    }
  }

  const normalized = message.content
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("fr");
  if (!guildConfig.blockedWords.length || message.member?.permissions.has(PermissionFlagsBits.ManageMessages)) return;
  const blockedWord = guildConfig.blockedWords.find((word) => normalized.includes(word));
  if (!blockedWord) return;

  const preview = message.content.length > 300 ? `${message.content.slice(0, 300)}…` : message.content;
  await message.delete().catch(() => undefined);
  const warning = await message.channel.send(`${message.author}, ton message a été supprimé car il contient un terme interdit.`).catch(() => null);
  if (warning) setTimeout(() => warning.delete().catch(() => undefined), 8_000);
  await log(message.guild, "Message supprimé par l'AutoMod", `Auteur : ${message.author.tag} (${message.author.id})\nSalon : <#${message.channelId}>\nTerme détecté : ||${blockedWord}||\nMessage : ||${preview || "(vide)"}||`, 0xef4444);
});

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of repeatedMessages) if (now - entry.firstTimestamp > repeatedMessageWindowMs) repeatedMessages.delete(key);
  for (const [key, entries] of recentMessages) if (!entries.length || now - entries[entries.length - 1].timestamp > 60000) recentMessages.delete(key);
}, 60000).unref();

client.on(Events.GuildBanAdd, async ban => { if (getGuildConfig(ban.guild.id)) await activityLog(ban.guild, "Bannissement détecté", `${ban.user.tag} (${ban.user.id})`, 0xdc2626); });
client.on(Events.GuildBanRemove, async ban => { if (getGuildConfig(ban.guild.id)) await activityLog(ban.guild, "Débannissement détecté", `${ban.user.tag} (${ban.user.id})`, 0x22c55e); });
process.on("unhandledRejection", console.error);
if (process.env.NODE_ENV !== "test") {
  await loadScheduledBans();
  await loadWarnings();
  await loadState();
  const identity = await new REST({ version: "10" }).setToken(config.token).get(Routes.user()) as { id: string; bot?: boolean };
  assertBotIdentity(identity, config.clientId);
  await client.login(config.token);
}
