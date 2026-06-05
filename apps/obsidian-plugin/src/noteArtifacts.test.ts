import { describe, expect, it } from "vitest";
import type { MeetingSpeakerMap } from "./speakers";
import {
  SPEAKER_SIDECAR_THRESHOLD_BYTES,
  buildSpeakerFrontmatter,
  prependSpeakerFrontmatter,
  shouldUseSpeakerSidecar,
  speakerFrontmatterBlock,
  speakerSidecarPath
} from "./noteArtifacts";

describe("noteArtifacts", () => {
  it("builds speaker frontmatter for a small meeting speaker map", () => {
    const speakerMap: MeetingSpeakerMap = {
      Speaker1: {
        displayName: "Alice",
        source: "manual"
      }
    };

    expect(buildSpeakerFrontmatter(speakerMap)).toEqual({
      local_asr_speakers: speakerMap
    });
    expect(shouldUseSpeakerSidecar(speakerMap)).toBe(false);
  });

  it("serializes small speaker maps as YAML frontmatter", () => {
    const speakerMap: MeetingSpeakerMap = {
      "\u8bf4\u8bdd\u4eba1": {
        displayName: "Alice",
        source: "auto_high_confidence",
        confidence: 0.92,
        profileId: "vault-speaker-alice",
        gatewaySpeakerId: "vp_alice",
        autoMatched: true
      }
    };

    expect(speakerFrontmatterBlock(buildSpeakerFrontmatter(speakerMap))).toBe(
      [
        "---",
        "local_asr_speakers:",
        '  "\u8bf4\u8bdd\u4eba1":',
        '    displayName: "Alice"',
        '    source: "auto_high_confidence"',
        "    confidence: 0.92",
        '    profileId: "vault-speaker-alice"',
        '    gatewaySpeakerId: "vp_alice"',
        "    autoMatched: true",
        "---",
        ""
      ].join("\n")
    );
  });

  it("prepends speaker frontmatter to note content", () => {
    const speakerMap: MeetingSpeakerMap = {
      Speaker1: {
        displayName: "Alice",
        source: "manual"
      }
    };

    expect(prependSpeakerFrontmatter("Body\n", buildSpeakerFrontmatter(speakerMap))).toBe(
      [
        "---",
        "local_asr_speakers:",
        '  "Speaker1":',
        '    displayName: "Alice"',
        '    source: "manual"',
        "---",
        "Body",
        ""
      ].join("\n")
    );
  });

  it("uses a sidecar when the speaker map contains 100 speakers", () => {
    const speakerMap: MeetingSpeakerMap = {};
    for (let index = 0; index < 100; index += 1) {
      speakerMap[`Speaker${index}`] = {
        displayName: `Speaker ${index}`,
        source: "manual",
        profileId: `profile-${index}`,
        gatewaySpeakerId: `gateway-${index}`
      };
    }

    expect(JSON.stringify(speakerMap).length).toBeGreaterThan(SPEAKER_SIDECAR_THRESHOLD_BYTES);
    expect(shouldUseSpeakerSidecar(speakerMap)).toBe(true);
  });

  it("uses UTF-8 byte length for non-ASCII speaker maps", () => {
    const speakerMap: MeetingSpeakerMap = {
      Speaker1: {
        displayName: "中文".repeat(700),
        source: "manual"
      }
    };
    const serialized = JSON.stringify(speakerMap);

    expect(serialized.length).toBeLessThanOrEqual(SPEAKER_SIDECAR_THRESHOLD_BYTES);
    expect(new TextEncoder().encode(serialized).length).toBeGreaterThan(SPEAKER_SIDECAR_THRESHOLD_BYTES);
    expect(shouldUseSpeakerSidecar(speakerMap)).toBe(true);
  });

  it("builds a speaker sidecar path beside the note", () => {
    expect(speakerSidecarPath("Meetings/Standup.md")).toBe("Meetings/Standup.speaker-map.json");
  });

  it("builds a speaker sidecar path for uppercase markdown extensions", () => {
    expect(speakerSidecarPath("Meetings/Standup.MD")).toBe("Meetings/Standup.speaker-map.json");
  });

  it("appends a speaker sidecar suffix when the note path has no markdown extension", () => {
    expect(speakerSidecarPath("Meetings/Standup")).toBe("Meetings/Standup.speaker-map.json");
  });
});
