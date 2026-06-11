import { describe, expect, it } from "vitest";
import { buildPostProcessingPrompt, mergeProcessedTranscript } from "./postProcessing";

describe("buildPostProcessingPrompt", () => {
  it("always instructs the model to preserve timestamp and speaker prefixes", () => {
    const prompt = buildPostProcessingPrompt("整理转录稿。");

    expect(prompt).toContain("整理转录稿。");
    expect(prompt).toContain("严格保留每一行开头的时间戳和说话人标签");
    expect(prompt).toContain("只返回处理后的转录稿");
  });
});

describe("mergeProcessedTranscript", () => {
  it("keeps raw transcript when requested and text changed", () => {
    expect(mergeProcessedTranscript("polished", "raw", true)).toBe("polished\n\n---\n\n## Original transcription\n\nraw");
  });

  it("returns processed transcript only when keep original is disabled", () => {
    expect(mergeProcessedTranscript("polished", "raw", false)).toBe("polished");
  });
});
