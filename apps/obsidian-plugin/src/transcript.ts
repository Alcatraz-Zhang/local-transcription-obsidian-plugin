export type OutputMode = "plain" | "timestamp" | "speaker_timestamp";

export interface NormalizedSegment {
  start: number;
  end: number;
  speaker?: string;
  text: string;
  words?: unknown[];
}

export interface GatewayTranscript {
  text?: string;
  segments?: NormalizedSegment[];
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

export function transcriptText(payload: GatewayTranscript, mode: OutputMode): string {
  if (payload.segments?.length) {
    return formatTranscript(payload.segments, mode);
  }
  return payload.text?.trim() ?? "";
}

