import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { EmbedBuilder, type Guild } from "discord.js";
import { getGuildConfig } from "./config.js";
const file = resolve(process.env.DATA_DIR || "data", "state.json");
export let state: { releases: Record<string, string[]>; locks: Record<string, Record<string, boolean | null>> } = { releases: {}, locks: {} };
export async function loadState() {
  try { state = JSON.parse(await readFile(file, "utf8")); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
}
let pending = Promise.resolve();
export function saveState() {
  const snapshot = JSON.stringify(state, null, 2);
  pending = pending.catch(() => {}).then(async () => { await mkdir(dirname(file), { recursive: true }); await writeFile(file + ".tmp", snapshot); await rename(file + ".tmp", file); });
  return pending;
}
export async function announceRelease(guild: Guild) {
  const cfg = getGuildConfig(guild.id); if (!cfg) return;
  const channel = await guild.channels.fetch(cfg.activityLogChannelId);
  if (!channel?.isTextBased() || !("send" in channel)) throw new Error("Salon de logs inaccessible");
  const releases = JSON.parse(await readFile(resolve("releases.json"), "utf8")) as { version: string; changes: string[] }[];
  const seen = state.releases[guild.id] ??= [];
  for (const release of releases) {
    if (seen.includes(release.version)) continue;
    const title = seen.length ? `BloodSnow — mise à jour ${release.version}` : `BloodSnow — première installation ${release.version}`;
    const text = release.changes.map(change => `• ${change}`).join("\n");
    for (let offset = 0; offset < text.length; offset += 3900) {
      await channel.send({ embeds: [new EmbedBuilder().setTitle(title).setDescription(text.slice(offset, offset + 3900)).setColor(0xb91c1c).setTimestamp()], allowedMentions: { parse: [] } });
    }
    seen.push(release.version); await saveState();
  }
  await channel.send({ embeds: [new EmbedBuilder().setTitle("BloodSnow démarré").setDescription("Modération, exports privés et protections configurées chargés.").setColor(0x22c55e).setTimestamp()], allowedMentions: { parse: [] } });
}
