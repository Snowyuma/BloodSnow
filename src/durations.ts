const units: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  j: 86_400_000,
  d: 86_400_000,
};

export function parseDuration(input: string): number | null {
  const match = input.trim().toLowerCase().match(/^(\d+)\s*([smhjd])$/);
  if (!match) return null;
  const duration = Number(match[1]) * units[match[2]];
  return Number.isSafeInteger(duration) && duration > 0 ? duration : null;
}

export function formatDuration(milliseconds: number): string {
  const choices: Array<[string, number]> = [["jour(s)", 86_400_000], ["heure(s)", 3_600_000], ["minute(s)", 60_000], ["seconde(s)", 1_000]];
  const [label, unit] = choices.find(([, value]) => milliseconds >= value) ?? choices[3];
  return `${Math.round(milliseconds / unit)} ${label}`;
}
