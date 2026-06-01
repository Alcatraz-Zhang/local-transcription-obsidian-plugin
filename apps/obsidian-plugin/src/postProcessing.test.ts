import { describe, expect, it } from "vitest";
import { buildPostProcessingPrompt, mergeProcessedTranscript } from "./postProcessing";

describe("buildPostProcessingPrompt", () => {
  it("always instructs the model to preserve timestamp and speaker prefixes", () => {
    const prompt = buildPostProcessingPrompt("Clean grammar.");

    expect(prompt).toContain("Clean grammar.");
    expect(prompt).toContain("preserve every timestamp and speaker label exactly");
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

