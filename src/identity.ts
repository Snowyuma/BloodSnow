export function assertBotIdentity(user: { id: string; bot?: boolean }, clientId: string): void {
  if (!user.bot || user.id !== clientId) throw new Error("Le token ne correspond pas au CLIENT_ID de BloodSnow. Opération annulée.");
}
