import {
  ApplicationCommandType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";

const permissions: Record<string, bigint> = {
 publier: PermissionFlagsBits.Administrator,
 annonces: PermissionFlagsBits.Administrator,
 ban: PermissionFlagsBits.BanMembers, unban: PermissionFlagsBits.BanMembers,
 expulser: PermissionFlagsBits.KickMembers, exclu: PermissionFlagsBits.ModerateMembers, unexclu: PermissionFlagsBits.ModerateMembers,
 export: PermissionFlagsBits.Administrator, exportmembres: PermissionFlagsBits.Administrator, nettoyer: PermissionFlagsBits.Administrator, lockdown: PermissionFlagsBits.Administrator,
 antiraid: PermissionFlagsBits.ManageGuild, "Informations du compte": PermissionFlagsBits.ManageGuild,
};
export const commands = [
  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Bannit un membre du serveur")
    .addUserOption((o) => o.setName("membre").setDescription("Membre à bannir").setRequired(true))
    .addStringOption((o) => o.setName("raison").setDescription("Motif du bannissement").setMaxLength(512))
    .addStringOption((o) => o.setName("duree").setDescription("Durée facultative : 30m, 12h, 7j (sans durée = permanent)").setMaxLength(20))
    .addIntegerOption((o) => o.setName("supprimer_messages").setDescription("Heures de messages à supprimer").setMinValue(0).setMaxValue(168)),
  new SlashCommandBuilder()
    .setName("unban")
    .setDescription("Débannit un utilisateur")
    .addStringOption((o) => o.setName("utilisateur_id").setDescription("Identifiant Discord de l'utilisateur").setRequired(true))
    .addStringOption((o) => o.setName("raison").setDescription("Motif du débannissement").setMaxLength(512)),
  new SlashCommandBuilder()
    .setName("testmp")
    .setDescription("Teste l'envoi d'un message privé de modération sans sanctionner")
    .addUserOption((o) => o.setName("membre").setDescription("Membre qui recevra le message").setRequired(true)),
  new SlashCommandBuilder()
    .setName("mp")
    .setDescription("Envoie un message privé à un membre sous l'identité du bot")
    .addUserOption((o) => o.setName("membre").setDescription("Membre qui recevra le message").setRequired(true))
    .addStringOption((o) => o.setName("message").setDescription("Message privé à envoyer").setRequired(true).setMaxLength(2000)),
  new SlashCommandBuilder()
    .setName("avertissement")
    .setDescription("Donne un avertissement à un membre et l'en informe par message privé")
    .addUserOption((o) => o.setName("membre").setDescription("Membre à avertir").setRequired(true))
    .addStringOption((o) => o.setName("raison").setDescription("Raison de l'avertissement").setRequired(true).setMaxLength(512)),
  new SlashCommandBuilder()
    .setName("avertissements")
    .setDescription("Affiche l'historique des avertissements d'un membre")
    .addUserOption((o) => o.setName("membre").setDescription("Membre à vérifier").setRequired(true)),
  new SlashCommandBuilder()
    .setName("retireravertissement")
    .setDescription("Retire le dernier avertissement d'un membre")
    .addUserOption((o) => o.setName("membre").setDescription("Membre concerné").setRequired(true))
    .addStringOption((o) => o.setName("raison").setDescription("Motif du retrait").setMaxLength(512)),
  new SlashCommandBuilder()
    .setName("expulser")
    .setDescription("Expulse un membre du serveur")
    .addUserOption((o) => o.setName("membre").setDescription("Membre à expulser").setRequired(true))
    .addStringOption((o) => o.setName("raison").setDescription("Motif de l'expulsion").setMaxLength(512)),
  new SlashCommandBuilder()
    .setName("exclu")
    .setDescription("Exclut temporairement un membre des discussions (timeout)")
    .addUserOption((o) => o.setName("membre").setDescription("Membre à exclure").setRequired(true))
    .addStringOption((o) => o.setName("duree").setDescription("Durée : 10m, 2h, 7j (maximum 28j)").setRequired(true).setMaxLength(20))
    .addStringOption((o) => o.setName("raison").setDescription("Motif de l'exclusion").setMaxLength(512)),
  new SlashCommandBuilder()
    .setName("unexclu")
    .setDescription("Retire l'exclusion temporaire d'un membre")
    .addUserOption((o) => o.setName("membre").setDescription("Membre à réintégrer").setRequired(true))
    .addStringOption((o) => o.setName("raison").setDescription("Motif de la réintégration").setMaxLength(512)),
  new SlashCommandBuilder()
    .setName("publier")
    .setDescription("Envoie un message classique sans encadré sous le nom du bot")
    .addStringOption(o => o.setName("message").setDescription("Texte du message").setRequired(true).setMaxLength(2000))
    .addChannelOption(o => o.setName("salon").setDescription("Salon cible, ou salon actuel").addChannelTypes(0, 2, 5, 10, 11, 12, 13))
    .addStringOption(o => o.setName("message_id").setDescription("ID du message auquel répondre"))
    .addAttachmentOption(o => o.setName("image").setDescription("Image facultative jointe au message")),
  new SlashCommandBuilder()
    .setName("annonces")
    .setDescription("Publie une annonce sous l'identité du bot")
    .addStringOption((o) => o.setName("message").setDescription("Contenu de l'annonce").setRequired(true).setMaxLength(2000))
    .addStringOption((o) => o.setName("titre").setDescription("Titre de l’annonce").setMaxLength(256))
    .addChannelOption((o) => o.setName("salon").setDescription("Salon cible (par défaut : salon actuel)")
      .addChannelTypes(0, 2, 5, 10, 11, 12, 13))
    .addStringOption((o) => o.setName("message_id").setDescription("ID du message auquel le bot doit répondre"))
    .addAttachmentOption((o) => o.setName("image").setDescription("Image jointe à l'annonce"))
    .addStringOption((o) => o.setName("image_url").setDescription("URL HTTPS d'une image")),
  new SlashCommandBuilder()
    .setName("lockdown")
    .setDescription("Verrouille ou déverrouille les salons texte du serveur")
    .addStringOption((o) => o.setName("action").setDescription("Action").setRequired(true)
      .addChoices({ name: "Activer", value: "on" }, { name: "Désactiver", value: "off" })),
  new SlashCommandBuilder()
    .setName("antiraid")
    .setDescription("Affiche l'état de la protection anti-raid"),
  new SlashCommandBuilder()
    .setName("nettoyer")
    .setDescription("Bannit un identifiant puis supprime ses messages dans les salons")
    .addStringOption((o) => o.setName("utilisateur_id").setDescription("ID de l'utilisateur, du bot ou de l'application").setRequired(true)),
  new SlashCommandBuilder()
    .setName("export")
    .setDescription("Exporte l'historique du salon des logs dans des fichiers texte"),
  new SlashCommandBuilder()
    .setName("exportmembres")
    .setDescription("Exporte la liste des membres du serveur dans un fichier CSV"),
  {
    name: "Informations du compte",
    type: ApplicationCommandType.User,
  },
].map((command) => ({ ...("toJSON" in command ? command.toJSON() : command), dm_permission: false, default_member_permissions: String(permissions[command.name] ?? PermissionFlagsBits.ManageMessages) }));
