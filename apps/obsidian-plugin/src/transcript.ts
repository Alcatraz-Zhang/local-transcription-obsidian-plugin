export type OutputMode = "plain" | "timestamp" | "speaker_timestamp";

export interface NormalizedSegment {
  start: number;
  end: number;
  speaker?: string;
  text: string;
  words?: unknown[];
  speakerMatch?: SpeakerMatch;
}

export interface SpeakerMatch {
  speakerId?: string;
  displayName?: string;
  confidence?: number;
  status?: string;
}

type RawSpeakerMatch = {
  speaker_id?: string;
  display_name?: string;
  confidence?: number;
  status?: string;
};

type RawSegment = {
  start?: number;
  end?: number;
  speaker?: string;
  text?: string;
  words?: unknown[];
  start_time?: number;
  end_time?: number;
  begin_time?: number;
  begin_time_milliseconds?: number;
  end_time_milliseconds?: number;
  speaker_id?: string;
  spk?: string;
  sentence?: string;
  raw_text?: string;
  speaker_match?: RawSpeakerMatch;
};

export interface GatewayTranscript {
  text?: string;
  segments?: RawSegment[];
  sentence_info?: RawSegment[];
}

export function formatTimestamp(seconds: number | undefined): string {
  const total = Math.max(0, Math.floor(Number(seconds ?? 0)));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return [hours, minutes, secs].map((part) => part.toString().padStart(2, "0")).join(":");
}

export function formatTranscript(segments: NormalizedSegment[], mode: OutputMode): string {
  return segments
    .filter((segment) => segment.text.trim().length > 0)
    .map((segment) => {
      const text = segment.text.trim();
      if (mode === "plain") {
        return text;
      }
      const range = `[${formatTimestamp(segment.start)} - ${formatTimestamp(segment.end)}]`;
      if (mode === "timestamp") {
        return `${range} ${text}`;
      }
      return `${range} ${segment.speaker?.trim() || "Speaker"}: ${text}`;
    })
    .join("\n");
}

function cleanAsrText(value: unknown): string {
  return String(value ?? "")
    .replace(/\s*language\s+[^<]*<asr_text>\s*/gi, "")
    .replace(/<asr_text>/g, "")
    .trim();
}

function timeValue(segment: RawSegment, keys: Array<keyof RawSegment>): number {
  for (const key of keys) {
    const value = segment[key];
    if (value === undefined || value === null || value === "") {
      continue;
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      continue;
    }
    if ((key === "begin_time" || key === "end_time" || key === "begin_time_milliseconds" || key === "end_time_milliseconds") && numeric > 1000) {
      return numeric / 1000;
    }
    return numeric;
  }
  return 0;
}

function speakerMatchValue(segment: RawSegment): SpeakerMatch | undefined {
  const match = segment.speaker_match;
  if (!match) {
    return undefined;
  }
  const normalized = {
    speakerId: match.speaker_id,
    displayName: match.display_name,
    confidence: match.confidence,
    status: match.status
  };
  return Object.values(normalized).some((value) => value !== undefined && value !== "") ? normalized : undefined;
}

export function normalizeSegments(payload: GatewayTranscript): NormalizedSegment[] {
  const source = payload.segments?.length ? payload.segments : payload.sentence_info ?? [];
  return source
    .map((segment): NormalizedSegment | null => {
      const text = cleanAsrText(segment.text ?? segment.sentence ?? segment.raw_text);
      if (!text) {
        return null;
      }
      const speaker = cleanAsrText(segment.speaker ?? segment.speaker_id ?? segment.spk);
      return {
        start: timeValue(segment, ["start", "start_time", "begin_time", "begin_time_milliseconds"]),
        end: timeValue(segment, ["end", "end_time", "end_time_milliseconds"]),
        speaker: speaker || undefined,
        text,
        words: Array.isArray(segment.words) ? segment.words : undefined,
        speakerMatch: speakerMatchValue(segment)
      };
    })
    .filter((segment): segment is NormalizedSegment => segment !== null);
}

export function transcriptText(payload: GatewayTranscript, mode: OutputMode): string {
  const segments = normalizeSegments(payload);
  if (segments.length) {
    return formatTranscript(segments, mode);
  }
  return payload.text?.trim() ?? "";
}
