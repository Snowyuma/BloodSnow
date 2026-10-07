import { REST, Routes } from "discord.js";
import { commands } from "./commands.js";
import { config } from "./config.js";

const rest = new REST({ version: "10" }).setToken(config.token);

for (const guildId of config.guilds.keys()) {
  await rest.put(Routes.applicationGuildCommands(config.clientId, guildId), { body: commands })
    .then(() => console.log(`${commands.length} commandes déployées sur le serveur ${guildId}.`))
    .catch((error) => console.error(`Impossible de déployer les commandes sur le serveur ${guildId} :`, error));
}
