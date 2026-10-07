import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export type ScheduledBan = { guildId: string; userId: string; expiresAt: number };
const file = resolve(process.env.DATA_DIR?.trim() || "data", "scheduled-bans.json");
let bans: ScheduledBan[] = [];

export async function loadScheduledBans() {
  try { bans = JSON.parse(await readFile(file, "utf8")) as ScheduledBan[]; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; bans = []; }
}

let pending = Promise.resolve();
function save() {
  const snapshot = JSON.stringify(bans, null, 2);
  pending = pending.catch(() => {}).then(async () => {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file + ".tmp", snapshot, "utf8");
    await rename(file + ".tmp", file);
  });
  return pending;
}

export async function scheduleBan(ban: ScheduledBan) {
  bans = bans.filter((item) => item.guildId !== ban.guildId || item.userId !== ban.userId);
  bans.push(ban);
  await save();
}

export async function cancelScheduledBan(guildId: string, userId: string) {
  const next = bans.filter((item) => item.guildId !== guildId || item.userId !== userId);
  if (next.length !== bans.length) { bans = next; await save(); }
}

export async function takeExpiredBans(now = Date.now()): Promise<ScheduledBan[]> {
  const expired = bans.filter((item) => item.expiresAt <= now);
  // Keep pending until Discord confirms the unban; retry failures after restart.
  return expired;
}
