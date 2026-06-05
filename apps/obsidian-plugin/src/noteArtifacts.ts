import type { MeetingSpeakerMap } from "./speakers";

export const SPEAKER_SIDECAR_THRESHOLD_BYTES = 4096;

export interface SpeakerFrontmatter {
  local_asr_speakers: MeetingSpeakerMap;
}

export interface SpeakerSidecarFrontmatter {
  local_asr_speaker_map: string;
}

export type NoteFrontmatter = SpeakerFrontmatter | SpeakerSidecarFrontmatter;

export function buildSpeakerFrontmatter(speakerMap: MeetingSpeakerMap): SpeakerFrontmatter {
  return { local_asr_speakers: speakerMap };
}

function scalarValue(value: unknown): string | undefined {
  if (value === null) {
    return "null";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  return undefined;
}

function yamlKey(key: string, indent: number): string {
  if (indent === 0 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    return key;
  }
  if (indent >= 4 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    return key;
  }
  return JSON.stringify(key);
}

function appendYaml(lines: string[], key: string, value: unknown, indent: number): void {
  if (value === undefined) {
    return;
  }
  const prefix = " ".repeat(indent);
  const scalar = scalarValue(value);
  if (scalar !== undefined) {
    lines.push(`${prefix}${yamlKey(key, indent)}: ${scalar}`);
    return;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Unsupported frontmatter value for ${key}`);
  }

  const entries = Object.entries(value).filter(([, entryValue]) => entryValue !== undefined);
  if (entries.length === 0) {
    lines.push(`${prefix}${yamlKey(key, indent)}: {}`);
    return;
  }

  lines.push(`${prefix}${yamlKey(key, indent)}:`);
  for (const [entryKey, entryValue] of entries) {
    appendYaml(lines, entryKey, entryValue, indent + 2);
  }
}

export function speakerFrontmatterBlock(frontmatter: NoteFrontmatter): string {
  const lines = ["---"];
  for (const [key, value] of Object.entries(frontmatter)) {
    appendYaml(lines, key, value, 0);
  }
  lines.push("---", "");
  return lines.join("\n");
}

export function prependSpeakerFrontmatter(content: string, frontmatter: NoteFrontmatter): string {
  return `${speakerFrontmatterBlock(frontmatter)}${content}`;
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
