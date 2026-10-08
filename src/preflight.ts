import "dotenv/config";
import { readFile } from "node:fs/promises";

export function validateEnvironment(env: NodeJS.ProcessEnv): string[] {
  const errors: string[] = [];
  if (!env.DISCORD_TOKEN?.trim()) errors.push("DISCORD_TOKEN : manquant (à renseigner uniquement dans .env)");
  for (const key of ["CLIENT_ID", "GUILD_ID", "MOD_LOG_CHANNEL_ID"]) {
    if (!/^\d{17,20}$/.test(env[key]?.trim() ?? "")) errors.push(`${key} : identifiant Discord manquant ou invalide`);
  }
  for (const key of ["ACTIVITY_LOG_CHANNEL_ID", "ANNOUNCEMENT_CHANNEL_IDS", "ALLOWED_BOT_IDS", "ALLOWED_WEBHOOK_IDS"]) {
    for (const id of (env[key] ?? "").split(",").map(s => s.trim()).filter(Boolean)) {
      if (!/^\d{17,20}$/.test(id)) { errors.push(`${key} : identifiant Discord invalide`); break; }
    }
  }
  for (const key of ["ANTI_RAID_ENABLED", "ANTI_APPLICATIONS_ENABLED"]) {
    if (env[key] !== undefined && !["true", "false"].includes(env[key]!)) errors.push(`${key} : utiliser true ou false`);
  }
  for (const key of ["RAID_JOIN_LIMIT", "RAID_WINDOW_SECONDS", "MIN_ACCOUNT_AGE_HOURS", "SPAM_MESSAGE_LIMIT", "SPAM_WINDOW_SECONDS", "SPAM_TIMEOUT_MINUTES"]) {
    if (env[key] !== undefined && (!Number.isFinite(Number(env[key])) || Number(env[key]) <= 0)) errors.push(`${key} : nombre strictement positif attendu`);
  }
  for (const key of ["RAID_JOIN_LIMIT", "SPAM_MESSAGE_LIMIT"]) {
    if (env[key] !== undefined && !Number.isInteger(Number(env[key]))) errors.push(`${key} : nombre entier attendu`);
  }
  if (Number(env.SPAM_TIMEOUT_MINUTES ?? 1440) > 28 * 24 * 60) errors.push("SPAM_TIMEOUT_MINUTES : maximum Discord de 28 jours dépassé");
  return errors;
}

export function validateReleases(releases: unknown, version: string): string[] {
  if (!Array.isArray(releases) || !releases.length) return ["releases.json : liste de versions vide ou invalide"];
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const r of releases) {
    if (!r || typeof r.version !== "string" || !r.version.trim() || r.version.length > 80 || !Array.isArray(r.changes) || !r.changes.length || r.changes.some((c: unknown) => typeof c !== "string" || !c.trim())) {
      errors.push("releases.json : chaque version doit avoir un numéro et des modifications non vides"); continue;
    }
    if (seen.has(r.version)) errors.push(`releases.json : version ${r.version} en double`);
    seen.add(r.version);
  }
  if (releases.at(-1)?.version !== version) errors.push("La dernière entrée de releases.json doit correspondre à package.json");
  return errors;
}

export async function runPreflight() {
  const errors = validateEnvironment(process.env);
  try {
    const pkg = JSON.parse(await readFile("package.json", "utf8"));
    errors.push(...validateReleases(JSON.parse(await readFile("releases.json", "utf8")), pkg.version));
  } catch { errors.push("Impossible de lire package.json ou releases.json"); }
  if (errors.length) {
    console.error("Configuration BloodSnow à compléter :\n" + errors.map(e => `- ${e}`).join("\n"));
    process.exitCode = 1;
  } else console.log("Configuration locale valide. Aucun secret affiché. Les permissions Discord doivent encore être vérifiées sur le serveur.");
  if (process.env.ANTI_APPLICATIONS_ENABLED !== "false" && !process.env.ALLOWED_BOT_IDS?.trim()) console.log("À vérifier avant lancement : liste des bots autorisés vide, les autres bots seront traités comme non autorisés.");
}
