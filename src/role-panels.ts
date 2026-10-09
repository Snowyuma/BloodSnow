import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { ButtonInteraction, PermissionFlagsBits, Guild } from "discord.js";
import { getGuildConfig } from "./config.js";

export type RolePanel = { guildId: string; channelId: string; messageId: string; kind: "rules" | "roles"; buttons: { id: string; roleId: string; label: string; mode?: "add" | "toggle"; style?: number }[] };
export async function loadRolePanels(): Promise<RolePanel[]> {
  try { return JSON.parse(await readFile(join(process.env.DATA_DIR ?? "./data", "role-panels.json"), "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}
export const dangerousRolePermissions = PermissionFlagsBits.Administrator | PermissionFlagsBits.ManageGuild | PermissionFlagsBits.ManageRoles | PermissionFlagsBits.BanMembers | PermissionFlagsBits.KickMembers | PermissionFlagsBits.ModerateMembers | PermissionFlagsBits.ManageChannels | PermissionFlagsBits.ManageWebhooks;
const busy = new Set<string>();
export async function handleRoleButton(interaction: ButtonInteraction, journal: (guild: Guild, title: string, body: string, color: number) => Promise<unknown>) {
  if (!interaction.customId.startsWith("bloodsnow:role:")) return false;
  await interaction.deferReply({ flags: 64 });
  if (!interaction.guild || !getGuildConfig(interaction.guild.id)) { await interaction.editReply("Ce bouton n’est pas disponible ici."); return true; }
  const panels = await loadRolePanels();
  const panel = panels.find(p => p.guildId === interaction.guildId && p.channelId === interaction.channelId && p.messageId === interaction.message.id);
  const button = panel?.buttons.find(b => `bloodsnow:role:${b.id}` === interaction.customId);
  if (!panel || !button || interaction.message.author.id !== interaction.client.user.id) { await interaction.editReply("Ce panneau n’est plus actif."); return true; }
  const key = `${interaction.guildId}:${interaction.user.id}:${button.roleId}`;
  if (busy.has(key)) { await interaction.editReply("Une modification de ce rôle est déjà en cours."); return true; }
  busy.add(key);
  try {
    const guild = interaction.guild;
    const [member, me, role] = await Promise.all([guild.members.fetch({user:interaction.user.id, force:true}), guild.members.fetchMe(), guild.roles.fetch(button.roleId)]);

    if (!role || role.id === guild.id || role.managed || role.permissions.any(dangerousRolePermissions) || !me.permissions.has(PermissionFlagsBits.ManageRoles) || me.roles.highest.comparePositionTo(role) <= 0) {
      await interaction.editReply("Je ne peux pas attribuer ce rôle. Un administrateur doit vérifier ma permission Gérer les rôles et placer mon rôle au-dessus du rôle concerné.");
      await journal(guild, "Attribution de rôle impossible", `Membre : ${interaction.user} (${interaction.user.id})\nRôle : <@&${button.roleId}>\nPanneau : ${interaction.message.url}\nPermissions ou hiérarchie incompatibles.`, 0xf59e0b);
      return true;
    }
    const hasRole = member.roles.cache.has(role.id);
    const addOnly = button.mode ? button.mode === "add" : panel.kind === "rules";
    if (addOnly && hasRole) { await interaction.editReply(`Tu possèdes déjà le rôle « ${role.name} ».`); return true; }
    const remove = !addOnly && hasRole;
    if (remove) await member.roles.remove(role, "Choix personnel via le panneau BloodSnow");
    else await member.roles.add(role, panel.kind === "rules" ? "Règlement accepté via BloodSnow" : "Choix personnel via le panneau BloodSnow");
    await interaction.editReply(panel.kind === "rules" ? `Règlement accepté ! Le rôle « ${role.name} » t’a été attribué. ❄️` : `Rôle « ${role.name} » ${remove ? "retiré" : "ajouté"}.`);
    await journal(guild, panel.kind === "rules" ? "Règlement accepté" : "Rôle choisi par bouton", `Membre : ${interaction.user} (${interaction.user.id})\nRôle ${remove ? "retiré" : "ajouté"} : <@&${role.id}>\nPanneau : ${interaction.message.url}`, 0x8bd3f7);
  } catch (error) { console.error("Bouton de rôle :", error); await interaction.editReply("Impossible de modifier le rôle pour le moment. Réessaie ou contacte un administrateur.").catch(() => undefined); }
  finally { busy.delete(key); }
  return true;
}
