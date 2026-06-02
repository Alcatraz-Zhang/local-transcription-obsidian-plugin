import { describe, expect, it } from "vitest";
import {
  applySpeakerMap,
  buildInitialSpeakerMap,
  confidenceAction,
  createSpeakerProfile,
  mergeSpeakerLabels,
  type MappedSpeakerSegment,
  type MeetingSpeakerMap,
  type SpeakerProfile
} from "./speakers";
import type { NormalizedSegment } from "./transcript";

const profiles: SpeakerProfile[] = [
  {
    id: "vault-speaker-alice",
    displayName: "Alice",
    aliases: ["PM"],
    gatewaySpeakerId: "vp_alice",
    createdAt: "2026-06-02T00:00:00",
    updatedAt: "2026-06-02T00:00:00"
  },
  {
    id: "vault-speaker-bob",
    displayName: "Bob",
    aliases: [],
    gatewaySpeakerId: "vp_bob",
    createdAt: "2026-06-02T00:00:00",
    updatedAt: "2026-06-02T00:00:00"
  }
];

describe("speaker confidence policy", () => {
  it("classifies confidence bands", () => {
    expect(confidenceAction(0.9)).toBe("auto");
    expect(confidenceAction(0.85)).toBe("auto");
    expect(confidenceAction(0.7)).toBe("suggest");
    expect(confidenceAction(0.65)).toBe("suggest");
    expect(confidenceAction(0.2)).toBe("ignore");
    expect(confidenceAction(undefined)).toBe("ignore");
    expect(confidenceAction(Number.NaN)).toBe("ignore");
    expect(confidenceAction(Number.POSITIVE_INFINITY)).toBe("ignore");
    expect(confidenceAction(1.2)).toBe("ignore");
    expect(confidenceAction(87)).toBe("ignore");
    expect(confidenceAction(-0.1)).toBe("ignore");
  });
});

describe("speaker map creation", () => {
  it("uses the original speaker label as the map key for already mapped segments", () => {
    const segments: MappedSpeakerSegment[] = [
      {
        start: 0,
        end: 1,
        speaker: "Alice",
        originalSpeaker: "说话人1",
        text: "hello",
        speakerMatch: {
          speakerId: "vp_gateway_alice",
          displayName: "Gateway Alice",
          confidence: 0.91
        }
      }
    ];

    const map = buildInitialSpeakerMap(segments, []);

    expect(map["说话人1"]).toMatchObject({
      displayName: "Gateway Alice",
      source: "auto_high_confidence",
      confidence: 0.91,
      gatewaySpeakerId: "vp_gateway_alice",
      autoMatched: true
    });
    expect(map["Alice"]).toBeUndefined();
    expect(map).not.toHaveProperty("Alice");
  });

  it("includes the profile id when a high-confidence match uses a stored gateway speaker id", () => {
    const segments: NormalizedSegment[] = [
      {
        start: 0,
        end: 1,
        speaker: "说话人1",
        text: "hello",
        speakerMatch: {
          speakerId: "vp_alice",
          displayName: "Gateway Alice",
          confidence: 0.91
        }
      }
    ];

    const map = buildInitialSpeakerMap(segments, profiles);

    expect(map["说话人1"]).toMatchObject({
      displayName: "Alice",
      profileId: "vault-speaker-alice",
      source: "auto_high_confidence",
      confidence: 0.91,
      gatewaySpeakerId: "vp_alice",
      autoMatched: true
    });
  });

  it("uses canonical profile identity when the gateway display name directly matches a profile display name", () => {
    const segments: NormalizedSegment[] = [
      {
        start: 0,
        end: 1,
        speaker: "说话人1",
        text: "hello",
        speakerMatch: {
          speakerId: "vp_gateway_alice",
          displayName: "Alice",
          confidence: 0.91
        }
      }
    ];

    const map = buildInitialSpeakerMap(segments, profiles);

    expect(map["说话人1"]).toMatchObject({
      displayName: "Alice",
      profileId: "vault-speaker-alice",
      source: "auto_high_confidence",
      confidence: 0.91,
      gatewaySpeakerId: "vp_gateway_alice",
      autoMatched: true
    });
  });

  it("uses canonical profile identity when the gateway display name matches an alias", () => {
    const segments: NormalizedSegment[] = [
      {
        start: 0,
        end: 1,
        speaker: "说话人1",
        text: "hello",
        speakerMatch: {
          speakerId: "vp_gateway_pm",
          displayName: "PM",
          confidence: 0.91
        }
      }
    ];

    const map = buildInitialSpeakerMap(segments, profiles);

    expect(map["说话人1"]).toMatchObject({
      displayName: "Alice",
      profileId: "vault-speaker-alice",
      source: "auto_high_confidence",
      confidence: 0.91,
      gatewaySpeakerId: "vp_gateway_pm",
      autoMatched: true
    });
  });

  it("normalizes gateway display names before matching profile aliases", () => {
    const segments: NormalizedSegment[] = [
      {
        start: 0,
        end: 1,
        speaker: "说话人1",
        text: "hello",
        speakerMatch: {
          speakerId: "vp_gateway_pm",
          displayName: " pm ",
          confidence: 0.91
        }
      }
    ];

    const map = buildInitialSpeakerMap(segments, profiles);

    expect(map["说话人1"]).toMatchObject({
      displayName: "Alice",
      profileId: "vault-speaker-alice",
      source: "auto_high_confidence",
      confidence: 0.91,
      gatewaySpeakerId: "vp_gateway_pm",
      autoMatched: true
    });
  });

  it("normalizes gateway display names before matching profile display names", () => {
    const segments: NormalizedSegment[] = [
      {
        start: 0,
        end: 1,
        speaker: "说话人1",
        text: "hello",
        speakerMatch: {
          speakerId: "vp_gateway_alice",
          displayName: " alice ",
          confidence: 0.91
        }
      }
    ];

    const map = buildInitialSpeakerMap(segments, profiles);

    expect(map["说话人1"]).toMatchObject({
      displayName: "Alice",
      profileId: "vault-speaker-alice",
      source: "auto_high_confidence",
      confidence: 0.91,
      gatewaySpeakerId: "vp_gateway_alice",
      autoMatched: true
    });
  });

  it("auto-applies high-confidence gateway display names without stored profiles", () => {
    const segments: NormalizedSegment[] = [
      {
        start: 0,
        end: 1,
        speaker: "说话人1",
        text: "hello",
        speakerMatch: {
          speakerId: "vp_gateway_alice",
          displayName: "Gateway Alice",
          confidence: 0.91
        }
      }
    ];

    const map = buildInitialSpeakerMap(segments, []);

    expect(map["说话人1"]).toMatchObject({
      displayName: "Gateway Alice",
      source: "auto_high_confidence",
      confidence: 0.91,
      gatewaySpeakerId: "vp_gateway_alice",
      autoMatched: true
    });
    expect(map["说话人1"].profileId).toBeUndefined();
    expect(map["说话人1"]).not.toHaveProperty("profileId");
  });

  it("auto-applies trusted gateway display names without profile ids when no stored profile matches", () => {
    const segments: NormalizedSegment[] = [
      {
        start: 0,
        end: 1,
        speaker: "说话人1",
        text: "hello",
        speakerMatch: {
          speakerId: "vp_gateway_carol",
          displayName: "Gateway Carol",
          confidence: 0.91
        }
      }
    ];

    const map = buildInitialSpeakerMap(segments, profiles);

    expect(map["说话人1"]).toMatchObject({
      displayName: "Gateway Carol",
      source: "auto_high_confidence",
      confidence: 0.91,
      gatewaySpeakerId: "vp_gateway_carol",
      autoMatched: true
    });
    expect(map["说话人1"].profileId).toBeUndefined();
    expect(map["说话人1"]).not.toHaveProperty("profileId");
  });

  it("trims trusted gateway fallback display names before applying or suggesting them", () => {
    const segments: NormalizedSegment[] = [
      {
        start: 0,
        end: 1,
        speaker: "说话人1",
        text: "hello",
        speakerMatch: {
          speakerId: "vp_gateway_carol",
          displayName: "  Carol  ",
          confidence: 0.91
        }
      },
      {
        start: 1,
        end: 2,
        speaker: "说话人2",
        text: "later",
        speakerMatch: {
          speakerId: "vp_gateway_carol",
          displayName: "  Carol  ",
          confidence: 0.7
        }
      }
    ];

    const map = buildInitialSpeakerMap(segments, profiles);

    expect(map["说话人1"]).toMatchObject({
      displayName: "Carol",
      source: "auto_high_confidence",
      confidence: 0.91,
      gatewaySpeakerId: "vp_gateway_carol",
      autoMatched: true
    });
    expect(map["说话人2"]).toMatchObject({
      suggestedDisplayName: "Carol",
      source: "suggested",
      confidence: 0.7,
      gatewaySpeakerId: "vp_gateway_carol"
    });
  });

  it("keeps medium-confidence matches as suggestions", () => {
    const segments: NormalizedSegment[] = [
      {
        start: 0,
        end: 1,
        speaker: "说话人2",
        text: "hello",
        speakerMatch: {
          speakerId: "vp_alice",
          displayName: "Gateway Alice",
          confidence: 0.7
        }
      }
    ];

    const map = buildInitialSpeakerMap(segments, profiles);

    expect(map["说话人2"]).toMatchObject({
      suggestedDisplayName: "Alice",
      profileId: "vault-speaker-alice",
      source: "suggested",
      confidence: 0.7,
      gatewaySpeakerId: "vp_alice"
    });
    expect(map["说话人2"].displayName).toBeUndefined();
  });

  it("manual mappings override automatic matches", () => {
    const existing: MeetingSpeakerMap = {
      "说话人1": {
        displayName: "Bob",
        source: "manual"
      }
    };
    const segments: NormalizedSegment[] = [
      {
        start: 0,
        end: 1,
        speaker: "说话人1",
        text: "hello",
        speakerMatch: {
          displayName: "Alice",
          confidence: 0.95
        }
      }
    ];

    const map = buildInitialSpeakerMap(segments, profiles, existing);

    expect(map["说话人1"].displayName).toBe("Bob");
    expect(map["说话人1"].source).toBe("manual");
  });

  it("does not downgrade an earlier high-confidence match to a later suggestion", () => {
    const segments: NormalizedSegment[] = [
      {
        start: 0,
        end: 1,
        speaker: "说话人1",
        text: "hello",
        speakerMatch: {
          speakerId: "vp_alice",
          displayName: "Gateway Alice",
          confidence: 0.91
        }
      },
      {
        start: 1,
        end: 2,
        speaker: "说话人1",
        text: "later",
        speakerMatch: {
          speakerId: "vp_bob",
          displayName: "Gateway Bob",
          confidence: 0.7
        }
      }
    ];

    const map = buildInitialSpeakerMap(segments, profiles);

    expect(map["说话人1"]).toMatchObject({
      displayName: "Alice",
      profileId: "vault-speaker-alice",
      source: "auto_high_confidence",
      confidence: 0.91,
      gatewaySpeakerId: "vp_alice",
      autoMatched: true
    });
    expect(map["说话人1"].suggestedDisplayName).toBeUndefined();
  });

  it("keeps the higher confidence decision for repeated entries from the same source", () => {
    const segments: NormalizedSegment[] = [
      {
        start: 0,
        end: 1,
        speaker: "说话人2",
        text: "hello",
        speakerMatch: {
          speakerId: "vp_alice",
          displayName: "Gateway Alice",
          confidence: 0.66
        }
      },
      {
        start: 1,
        end: 2,
        speaker: "说话人2",
        text: "later",
        speakerMatch: {
          speakerId: "vp_bob",
          displayName: "Gateway Bob",
          confidence: 0.78
        }
      }
    ];

    const map = buildInitialSpeakerMap(segments, profiles);

    expect(map["说话人2"]).toMatchObject({
      suggestedDisplayName: "Bob",
      profileId: "vault-speaker-bob",
      source: "suggested",
      confidence: 0.78,
      gatewaySpeakerId: "vp_bob"
    });
  });

  it("does not create an initial map entry for out-of-range high confidence", () => {
    const segments: NormalizedSegment[] = [
      {
        start: 0,
        end: 1,
        speaker: "说话人1",
        text: "hello",
        speakerMatch: {
          speakerId: "vp_gateway_alice",
          displayName: "Gateway Alice",
          confidence: 1.2
        }
      }
    ];

    const map = buildInitialSpeakerMap(segments, profiles);

    expect(map["说话人1"]).toBeUndefined();
    expect(map).not.toHaveProperty("说话人1");
  });
});

describe("speaker profiles", () => {
  it("creates a trimmed profile with gateway id, empty aliases, id, and timestamps", () => {
    const before = Date.now();
    const profile = createSpeakerProfile("  Alice Cooper  ", "vp_alice");
    const after = Date.now();

    expect(profile.displayName).toBe("Alice Cooper");
    expect(profile.gatewaySpeakerId).toBe("vp_alice");
    expect(profile.aliases).toEqual([]);
    expect(profile.id).toMatch(/^vault-speaker-alice-cooper-[a-z0-9-]+$/);
    expect(profile.createdAt).toBe(profile.updatedAt);
    expect(Date.parse(profile.createdAt)).not.toBeNaN();

    const createdAt = Date.parse(profile.createdAt);
    expect(createdAt).toBeGreaterThanOrEqual(before);
    expect(createdAt).toBeLessThanOrEqual(after);
  });

  it("creates a profile id with the readable slug prefix and non-timestamp entropy", () => {
    const profile = createSpeakerProfile("Alice Cooper", "vp_alice");

    expect(profile.id).toMatch(/^vault-speaker-alice-cooper-[a-z0-9-]+$/);
    expect(profile.id).not.toMatch(/^vault-speaker-alice-cooper-\d+$/);
  });

  it("rejects a blank display name", () => {
    expect(() => createSpeakerProfile("   ")).toThrow("Speaker display name is required");
  });
});

describe("speaker map application", () => {
  it("renders mapped display names while preserving original speaker", () => {
    const segments: NormalizedSegment[] = [{ start: 0, end: 1, speaker: "说话人1", text: "hello" }];
    const mapped: MappedSpeakerSegment[] = applySpeakerMap(segments, {
      "说话人1": { displayName: "Alice", source: "manual" }
    });

    expect(mapped[0].speaker).toBe("Alice");
    expect(mapped[0].originalSpeaker).toBe("说话人1");
  });

  it("preserves an existing original speaker when remapping a segment", () => {
    const segments: MappedSpeakerSegment[] = [
      { start: 0, end: 1, speaker: "Alice", originalSpeaker: "说话人1", text: "hello" }
    ];
    const mapped = applySpeakerMap(segments, {
      "说话人1": { displayName: "Alice Cooper", source: "manual" }
    });

    expect(mapped[0].speaker).toBe("Alice Cooper");
    expect(mapped[0].originalSpeaker).toBe("说话人1");
  });

  it("does not add originalSpeaker when the segment has no speaker label", () => {
    const segments: NormalizedSegment[] = [{ start: 0, end: 1, text: "hello" }];

    const mapped = applySpeakerMap(segments, {});

    expect(mapped[0]).not.toHaveProperty("originalSpeaker");
  });

  it("merges labels into the target display name", () => {
    const map = mergeSpeakerLabels(
      {
        "说话人1": { displayName: "Alice", source: "manual" },
        "说话人3": { displayName: "Temp", source: "manual" }
      },
      "说话人3",
      "说话人1"
    );

    expect(map["说话人3"]).toMatchObject({
      displayName: "Alice",
      source: "manual",
      mergedInto: "说话人1"
    });
  });

  it("returns the original map when merging a label into itself", () => {
    const speakerMap: MeetingSpeakerMap = {
      "说话人1": { displayName: "Alice", source: "manual" }
    };

    const map = mergeSpeakerLabels(speakerMap, "说话人1", "说话人1");

    expect(map).toBe(speakerMap);
    expect(map["说话人1"]).toEqual({ displayName: "Alice", source: "manual" });
  });
});
