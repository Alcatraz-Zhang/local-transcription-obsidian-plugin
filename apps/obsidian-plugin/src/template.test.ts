import { describe, expect, it } from "vitest";
import { expandTemplate, safeNoteFileName } from "./template";

describe("expandTemplate", () => {
  it("expands note variables without altering transcription content", () => {
    const result = expandTemplate("![[{{audioFile}}]]\n# {{title}}\n{{date}}\n{{transcription}}", {
      audioFile: "Recordings/Audio/meeting.wav",
      transcription: "[00:00:00 - 00:00:02] Speaker1: hello",
      title: "Weekly",
      date: "2026-06-02",
      datetime: "2026-06-02 10-20-30"
    });

    expect(result).toContain("![[Recordings/Audio/meeting.wav]]");
    expect(result).toContain("[00:00:00 - 00:00:02] Speaker1: hello");
  });
});

describe("safeNoteFileName", () => {
  it("replaces characters Obsidian cannot use in a filename", () => {
    expect(safeNoteFileName("2026/06/02: team? sync")).toBe("2026-06-02- team- sync");
  });
});

