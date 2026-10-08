export type VoiceSnapshot = {
  channelId: string | null;
  selfMute: boolean | null; selfDeaf: boolean | null;
  serverMute: boolean | null; serverDeaf: boolean | null;
  selfVideo: boolean | null; streaming: boolean | null;
};
export function voiceChanges(oldState: VoiceSnapshot, newState: VoiceSnapshot) {
  // Joining/leaving supplies an initial/reset state, not evidence of toggling a control.
  const changed = (key: Exclude<keyof VoiceSnapshot, "channelId">) => Boolean(
    oldState.channelId && newState.channelId && typeof oldState[key] === "boolean" && typeof newState[key] === "boolean" && oldState[key] !== newState[key],
  );
  return {
    serverMuteChanged: changed("serverMute"), serverDeafChanged: changed("serverDeaf"),
    selfMuteChanged: changed("selfMute"), selfDeafChanged: changed("selfDeaf"),
    cameraChanged: changed("selfVideo"), streamChanged: changed("streaming"),
  };
}
