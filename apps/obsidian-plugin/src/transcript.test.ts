import { describe, expect, it } from "vitest";
import { formatTranscript, normalizeSegments, transcriptText, type NormalizedSegment } from "./transcript";

const segments: NormalizedSegment[] = [
  { start: 0, end: 2.4, speaker: "Speaker1", text: "大家好。" },
  { start: 65, end: 67, speaker: "Speaker2", text: "今天讨论项目。" }
];

describe("formatTranscript", () => {
  it("renders speaker and timestamp mode by default", () => {
    expect(formatTranscript(segments, "speaker_timestamp")).toBe(
      "[00:00:00 - 00:00:02] Speaker1: 大家好。\n[00:01:05 - 00:01:07] Speaker2: 今天讨论项目。"
    );
  });

  it("renders timestamp-only mode", () => {
    expect(formatTranscript(segments, "timestamp")).toBe(
      "[00:00:00 - 00:00:02] 大家好。\n[00:01:05 - 00:01:07] 今天讨论项目。"
    );
  });

  it("renders plain text mode", () => {
    expect(formatTranscript(segments, "plain")).toBe("大家好。\n今天讨论项目。");
  });
});

describe("transcriptText", () => {
  it("formats raw gateway sentence_info without requiring formatted backend text", () => {
    expect(
      transcriptText(
        {
          sentence_info: [
            { speaker_id: "Speaker1", start_time: 0, end_time: 2.4, text: "大家好。" },
            { spk: "Speaker2", begin_time: 65000, end_time: 67000, sentence: "今天讨论项目。" }
          ]
        },
        "speaker_timestamp"
      )
    ).toBe("[00:00:00 - 00:00:02] Speaker1: 大家好。\n[00:01:05 - 00:01:07] Speaker2: 今天讨论项目。");
  });

  it("uses structured segments before any fallback text", () => {
    expect(
      transcriptText(
        {
          text: "unformatted fallback",
          segments: [{ speaker: "Speaker1", start: 0, end: 1, text: "structured" }]
        },
        "timestamp"
      )
    ).toBe("[00:00:00 - 00:00:01] structured");
  });
});

describe("normalizeSegments", () => {
  it("preserves normalized voiceprint match metadata from sentence_info", () => {
    expect(
      normalizeSegments({
        sentence_info: [
          {
            speaker_id: "Speaker1",
            start_time: 0,
            end_time: 1.2,
            text: "hello",
            speaker_match: {
              speaker_id: "vp_alice",
              display_name: "Alice",
              confidence: 0.87,
              status: "matched"
            }
          }
        ]
      })
    ).toEqual([
      {
        start: 0,
        end: 1.2,
        speaker: "Speaker1",
        text: "hello",
        words: undefined,
        speakerMatch: {
          speakerId: "vp_alice",
          displayName: "Alice",
          confidence: 0.87,
          status: "matched"
        }
      }
    ]);
  });
});
