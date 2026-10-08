import { REST, Routes } from "discord.js";
import { commands } from "./commands.js";
import { assertBotIdentity } from "./identity.js";
import { config } from "./config.js";

const rest = new REST({ version: "10" }).setToken(config.token);

const identity = await rest.get(Routes.user()) as { id: string; bot?: boolean };
assertBotIdentity(identity, config.clientId);

for (const guildId of config.guilds.keys()) {
  await rest.put(Routes.applicationGuildCommands(config.clientId, guildId), { body: commands })
    .then(() => console.log(`${commands.length} commandes déployées sur le serveur ${guildId}.`))
    .catch((error) => { process.exitCode = 1; console.error(`Impossible de déployer les commandes sur le serveur ${guildId} :`, error); });
}
