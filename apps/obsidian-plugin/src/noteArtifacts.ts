import type { MeetingSpeakerMap } from "./speakers";

export const SPEAKER_SIDECAR_THRESHOLD_BYTES = 4096;

export interface SpeakerFrontmatter {
  local_asr_speakers: MeetingSpeakerMap;
}

export function buildSpeakerFrontmatter(speakerMap: MeetingSpeakerMap): SpeakerFrontmatter {
  return { local_asr_speakers: speakerMap };
}

export function shouldUseSpeakerSidecar(speakerMap: MeetingSpeakerMap): boolean {
  const encoded = new TextEncoder().encode(JSON.stringify(speakerMap));
  return encoded.length > SPEAKER_SIDECAR_THRESHOLD_BYTES;
}

export function speakerSidecarPath(notePath: string): string {
  if (/\.md$/i.test(notePath)) {
    return notePath.replace(/\.md$/i, ".speaker-map.json");
  }
  return `${notePath}.speaker-map.json`;
}
