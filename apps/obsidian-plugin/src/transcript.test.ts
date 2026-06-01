import { describe, expect, it } from "vitest";
import { formatTranscript, type NormalizedSegment } from "./transcript";

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

