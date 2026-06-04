import { describe, expect, it } from "vitest";
import { SpeakerStore, type VaultAdapter } from "./speakerStore";
import { createSpeakerProfile, type SpeakerProfile } from "./speakers";

class FakeVaultAdapter implements VaultAdapter {
  files = new Map<string, string>();
  ensuredFolders: string[] = [];

  async read(path: string): Promise<string | null> {
    return this.files.get(path) ?? null;
  }

  async ensureFolder(path: string): Promise<void> {
    this.ensuredFolders.push(path);
  }

  async write(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }
}

describe("SpeakerStore", () => {
  const validProfile: SpeakerProfile = {
    id: "vault-speaker-alice",
    displayName: "Alice",
    aliases: ["PM"],
    gatewaySpeakerId: "vp_alice",
    createdAt: "2026-06-02T00:00:00.000Z",
    updatedAt: "2026-06-02T00:00:00.000Z"
  };

  it("loads an empty list when the profile file does not exist", async () => {
    const store = new SpeakerStore(new FakeVaultAdapter());

    await expect(store.load()).resolves.toEqual([]);
  });

  it("reports missing status when the profile file does not exist", async () => {
    const store = new SpeakerStore(new FakeVaultAdapter());

    await expect(store.loadWithStatus()).resolves.toEqual({ status: "missing", profiles: [] });
  });

  it("reports invalid status for an existing empty profile file while load still returns an empty list", async () => {
    const adapter = new FakeVaultAdapter();
    adapter.files.set(".local-asr/speakers.json", " \n\t");
    const store = new SpeakerStore(adapter);

    await expect(store.loadWithStatus()).resolves.toEqual({ status: "invalid", profiles: [] });
    await expect(store.load()).resolves.toEqual([]);
  });

  it("saves and reloads speaker profiles", async () => {
    const adapter = new FakeVaultAdapter();
    const store = new SpeakerStore(adapter);

    await store.save([validProfile]);

    expect(await store.load()).toEqual([validProfile]);
  });

  it("ensures the default speaker profile folder before writing", async () => {
    const adapter = new FakeVaultAdapter();
    const store = new SpeakerStore(adapter);

    await store.save([validProfile]);

    expect(adapter.ensuredFolders).toEqual([".local-asr"]);
    expect(adapter.files.has(".local-asr/speakers.json")).toBe(true);
  });

  it("ensures a custom parent folder before writing", async () => {
    const adapter = new FakeVaultAdapter();
    const store = new SpeakerStore(adapter, "custom/speakers.json");

    await store.save([validProfile]);

    expect(adapter.ensuredFolders).toEqual(["custom"]);
    expect(adapter.files.has("custom/speakers.json")).toBe(true);
  });

  it("ensures a nested custom parent folder before writing", async () => {
    const adapter = new FakeVaultAdapter();
    const store = new SpeakerStore(adapter, "custom/nested/speakers.json");

    await store.save([validProfile]);

    expect(adapter.ensuredFolders).toEqual(["custom/nested"]);
    expect(adapter.files.has("custom/nested/speakers.json")).toBe(true);
  });

  it("does not ensure a folder for storage paths without a folder component", async () => {
    const adapter = new FakeVaultAdapter();
    const store = new SpeakerStore(adapter, "speakers.json");

    await store.save([validProfile]);

    expect(adapter.ensuredFolders).toEqual([]);
    expect(adapter.files.has("speakers.json")).toBe(true);
  });

  it("filters profiles with non-string aliases or gateway speaker IDs", async () => {
    const adapter = new FakeVaultAdapter();
    adapter.files.set(
      ".local-asr/speakers.json",
      JSON.stringify([
        {
          id: "vault-speaker-alice",
          displayName: "Alice",
          aliases: ["PM"],
          createdAt: "2026-06-02T00:00:00.000Z",
          updatedAt: "2026-06-02T00:00:00.000Z"
        },
        {
          id: "vault-speaker-bob",
          displayName: "Bob",
          aliases: ["Host", 42],
          gatewaySpeakerId: "vp_bob",
          createdAt: "2026-06-02T00:00:00.000Z",
          updatedAt: "2026-06-02T00:00:00.000Z"
        },
        {
          id: "vault-speaker-caro",
          displayName: "Caro",
          aliases: ["Designer"],
          gatewaySpeakerId: 123,
          createdAt: "2026-06-02T00:00:00.000Z",
          updatedAt: "2026-06-02T00:00:00.000Z"
        }
      ])
    );
    const store = new SpeakerStore(adapter);

    await expect(store.load()).resolves.toEqual([
      {
        id: "vault-speaker-alice",
        displayName: "Alice",
        aliases: ["PM"],
        createdAt: "2026-06-02T00:00:00.000Z",
        updatedAt: "2026-06-02T00:00:00.000Z"
      }
    ]);
  });

  it("reports partial status while keeping the first profile when stored profiles contain duplicate ids", async () => {
    const adapter = new FakeVaultAdapter();
    const duplicate = {
      ...validProfile,
      displayName: "Alice Duplicate",
      aliases: ["Alice Copy"],
      gatewaySpeakerId: "vp_alice_copy"
    };
    const bob = {
      ...validProfile,
      id: "vault-speaker-bob",
      displayName: "Bob",
      aliases: ["Designer"],
      gatewaySpeakerId: "vp_bob"
    };
    adapter.files.set(".local-asr/speakers.json", JSON.stringify([validProfile, duplicate, bob]));
    const store = new SpeakerStore(adapter);

    await expect(store.loadWithStatus()).resolves.toEqual({
      status: "partial",
      profiles: [validProfile, bob],
      invalidCount: 1,
      warnings: ["Ignored 1 profile with duplicate id"]
    });
    await expect(store.load()).resolves.toEqual([validProfile, bob]);
  });

  it("reports partial status when stored profiles only contain one duplicated id", async () => {
    const adapter = new FakeVaultAdapter();
    const duplicate = {
      ...validProfile,
      displayName: "Alice Duplicate",
      aliases: ["Alice Copy"],
      gatewaySpeakerId: "vp_alice_copy"
    };
    adapter.files.set(".local-asr/speakers.json", JSON.stringify([validProfile, duplicate]));
    const store = new SpeakerStore(adapter);

    await expect(store.loadWithStatus()).resolves.toEqual({
      status: "partial",
      profiles: [validProfile],
      invalidCount: 1,
      warnings: ["Ignored 1 profile with duplicate id"]
    });
  });

  it("reports partial status while keeping the first profile when stored profiles duplicate gateway speaker IDs", async () => {
    const adapter = new FakeVaultAdapter();
    const duplicateGateway = {
      ...validProfile,
      id: "vault-speaker-bob",
      displayName: "Bob",
      aliases: ["Designer"]
    };
    adapter.files.set(".local-asr/speakers.json", JSON.stringify([validProfile, duplicateGateway]));
    const store = new SpeakerStore(adapter);

    await expect(store.loadWithStatus()).resolves.toEqual({
      status: "partial",
      profiles: [validProfile],
      invalidCount: 1,
      warnings: ["Ignored 1 profile with duplicate gateway speaker id"]
    });
    await expect(store.loadEditable()).rejects.toThrow(
      "Cannot edit speaker profiles because storage status is partial"
    );
  });

  it("keeps stored profiles whose gateway speaker IDs differ only by case", async () => {
    const adapter = new FakeVaultAdapter();
    const upperGateway = {
      ...validProfile,
      gatewaySpeakerId: "VP_A"
    };
    const lowerGateway = {
      ...validProfile,
      id: "vault-speaker-bob",
      displayName: "Bob",
      aliases: ["Designer"],
      gatewaySpeakerId: "vp_a"
    };
    adapter.files.set(".local-asr/speakers.json", JSON.stringify([upperGateway, lowerGateway]));
    const store = new SpeakerStore(adapter);

    await expect(store.loadWithStatus()).resolves.toEqual({
      status: "ok",
      profiles: [upperGateway, lowerGateway]
    });
  });

  it("trims persisted speaker identity fields when loading", async () => {
    const adapter = new FakeVaultAdapter();
    adapter.files.set(
      ".local-asr/speakers.json",
      JSON.stringify([
        {
          ...validProfile,
          id: " vault-speaker-alice ",
          displayName: " Alice ",
          aliases: [" PM ", " Facilitator "],
          gatewaySpeakerId: " vp_alice "
        }
      ])
    );
    const store = new SpeakerStore(adapter);

    await expect(store.loadWithStatus()).resolves.toEqual({
      status: "ok",
      profiles: [
        {
          ...validProfile,
          aliases: ["PM", "Facilitator"]
        }
      ]
    });
  });

  it("reports partial status while keeping the first profile when stored profiles collide by display names and aliases", async () => {
    const adapter = new FakeVaultAdapter();
    const displayNameCollidesWithAlias = {
      ...validProfile,
      id: "vault-speaker-bob",
      displayName: " pm ",
      aliases: ["Designer"],
      gatewaySpeakerId: "vp_bob"
    };
    const aliasCollidesWithDisplayName = {
      ...validProfile,
      id: "vault-speaker-caro",
      displayName: "Caro",
      aliases: [" ALICE "],
      gatewaySpeakerId: "vp_caro"
    };
    adapter.files.set(
      ".local-asr/speakers.json",
      JSON.stringify([validProfile, displayNameCollidesWithAlias, aliasCollidesWithDisplayName])
    );
    const store = new SpeakerStore(adapter);

    await expect(store.loadWithStatus()).resolves.toEqual({
      status: "partial",
      profiles: [validProfile],
      invalidCount: 2,
      warnings: ["Ignored 2 profiles with conflicting display name or alias"]
    });
    await expect(store.loadEditable()).rejects.toThrow(
      "Cannot edit speaker profiles because storage status is partial"
    );
  });

  it("reports invalid status when a stored profile alias equals its display name", async () => {
    const adapter = new FakeVaultAdapter();
    adapter.files.set(
      ".local-asr/speakers.json",
      JSON.stringify([{ ...validProfile, aliases: [" alice "] }])
    );
    const store = new SpeakerStore(adapter);

    await expect(store.loadWithStatus()).resolves.toEqual({
      status: "invalid",
      profiles: [],
      invalidCount: 1,
      warnings: ["Ignored 1 profile with conflicting aliases"]
    });
  });

  it("strips extra persisted fields from valid profiles when loading", async () => {
    const adapter = new FakeVaultAdapter();
    adapter.files.set(
      ".local-asr/speakers.json",
      JSON.stringify([{ ...validProfile, runtimeSpeakerMatch: { confidence: 0.9 }, extra: true }])
    );
    const store = new SpeakerStore(adapter);

    await expect(store.load()).resolves.toEqual([validProfile]);
    await expect(store.loadEditable()).resolves.toEqual([validProfile]);
    await expect(store.loadWithStatus()).resolves.toEqual({ status: "ok", profiles: [validProfile] });
  });

  it("loadEditable returns profiles for missing and ok storage only", async () => {
    const missingStore = new SpeakerStore(new FakeVaultAdapter());
    await expect(missingStore.loadEditable()).resolves.toEqual([]);

    const adapter = new FakeVaultAdapter();
    adapter.files.set(".local-asr/speakers.json", JSON.stringify([validProfile]));
    const store = new SpeakerStore(adapter);

    await expect(store.loadEditable()).resolves.toEqual([validProfile]);
  });

  it("loadEditable throws for partial storage so write flows cannot ignore invalid entries", async () => {
    const adapter = new FakeVaultAdapter();
    adapter.files.set(".local-asr/speakers.json", JSON.stringify([validProfile, { ...validProfile, id: "" }]));
    const store = new SpeakerStore(adapter);

    await expect(store.loadEditable()).rejects.toThrow(
      "Cannot edit speaker profiles because storage status is partial"
    );
  });

  it("loadEditable throws for duplicate-id storage through partial status", async () => {
    const adapter = new FakeVaultAdapter();
    const bob = { ...validProfile, id: "vault-speaker-bob", displayName: "Bob" };
    adapter.files.set(".local-asr/speakers.json", JSON.stringify([validProfile, { ...validProfile }, bob]));
    const store = new SpeakerStore(adapter);

    await expect(store.loadEditable()).rejects.toThrow(
      "Cannot edit speaker profiles because storage status is partial"
    );
  });

  it("loadEditable throws for invalid storage so write flows cannot replace unreadable data", async () => {
    const adapter = new FakeVaultAdapter();
    adapter.files.set(".local-asr/speakers.json", "{broken");
    const store = new SpeakerStore(adapter);

    await expect(store.loadEditable()).rejects.toThrow(
      "Cannot edit speaker profiles because storage status is invalid"
    );
  });

  it("reports partial status while preserving valid profiles when stored profiles include invalid entries", async () => {
    const adapter = new FakeVaultAdapter();
    adapter.files.set(
      ".local-asr/speakers.json",
      JSON.stringify([
        validProfile,
        { ...validProfile, id: " " },
        { ...validProfile, id: "vault-speaker-blank-display", displayName: "\t" },
        { ...validProfile, id: "vault-speaker-blank-alias", aliases: ["PM", " "] },
        { ...validProfile, id: "vault-speaker-blank-gateway", gatewaySpeakerId: " " },
        { ...validProfile, id: "vault-speaker-bad-created", createdAt: "not a date" },
        { ...validProfile, id: "vault-speaker-bad-updated", updatedAt: "not a date" }
      ])
    );
    const store = new SpeakerStore(adapter);

    await expect(store.loadWithStatus()).resolves.toEqual({
      status: "partial",
      profiles: [validProfile],
      invalidCount: 6,
      warnings: ["Ignored 6 profiles with invalid shape"]
    });
    await expect(store.load()).resolves.toEqual([validProfile]);
  });

  it("rejects parseable timestamps that do not round-trip to ISO strings", async () => {
    const adapter = new FakeVaultAdapter();
    adapter.files.set(
      ".local-asr/speakers.json",
      JSON.stringify([
        validProfile,
        { ...validProfile, id: "vault-speaker-non-iso-created", createdAt: "2026-06-02T00:00:00" },
        { ...validProfile, id: "vault-speaker-non-iso-updated", updatedAt: "2026-06-02" }
      ])
    );
    const store = new SpeakerStore(adapter);

    await expect(store.loadWithStatus()).resolves.toEqual({
      status: "partial",
      profiles: [validProfile],
      invalidCount: 2,
      warnings: ["Ignored 2 profiles with invalid shape"]
    });
  });

  it("reports reason-specific warning categories for skipped stored profiles", async () => {
    const adapter = new FakeVaultAdapter();
    adapter.files.set(
      ".local-asr/speakers.json",
      JSON.stringify([
        validProfile,
        { ...validProfile, id: " " },
        {
          ...validProfile,
          displayName: "Alice Duplicate",
          aliases: ["Alice Copy"],
          gatewaySpeakerId: "vp_alice_copy"
        },
        {
          ...validProfile,
          id: "vault-speaker-duplicate-gateway",
          displayName: "Gateway Duplicate",
          aliases: ["Gateway Copy"]
        },
        {
          ...validProfile,
          id: "vault-speaker-self-conflict",
          displayName: "Self Conflict",
          aliases: [" self conflict "],
          gatewaySpeakerId: "vp_self_conflict"
        },
        {
          ...validProfile,
          id: "vault-speaker-cross-conflict",
          displayName: "PM",
          aliases: ["Cross Conflict"],
          gatewaySpeakerId: "vp_cross_conflict"
        }
      ])
    );
    const store = new SpeakerStore(adapter);

    await expect(store.loadWithStatus()).resolves.toEqual({
      status: "partial",
      profiles: [validProfile],
      invalidCount: 5,
      warnings: [
        "Ignored 1 profile with invalid shape",
        "Ignored 1 profile with duplicate id",
        "Ignored 1 profile with duplicate gateway speaker id",
        "Ignored 1 profile with conflicting aliases",
        "Ignored 1 profile with conflicting display name or alias"
      ]
    });
  });

  it("rejects malformed profile JSON by returning an empty list", async () => {
    const adapter = new FakeVaultAdapter();
    adapter.files.set(".local-asr/speakers.json", "{broken");
    const store = new SpeakerStore(adapter);

    await expect(store.load()).resolves.toEqual([]);
  });

  it("reports invalid status for malformed JSON while load still returns an empty list", async () => {
    const adapter = new FakeVaultAdapter();
    adapter.files.set(".local-asr/speakers.json", "{broken");
    const store = new SpeakerStore(adapter);

    await expect(store.loadWithStatus()).resolves.toMatchObject({ status: "invalid", profiles: [] });
    await expect(store.load()).resolves.toEqual([]);
  });

  it("reports invalid status for non-array JSON while load still returns an empty list", async () => {
    const adapter = new FakeVaultAdapter();
    adapter.files.set(".local-asr/speakers.json", JSON.stringify({ profiles: [validProfile] }));
    const store = new SpeakerStore(adapter);

    await expect(store.loadWithStatus()).resolves.toEqual({
      status: "invalid",
      profiles: [],
      error: "Speaker profile storage must contain a JSON array"
    });
    await expect(store.load()).resolves.toEqual([]);
  });

  it("saves sorted pretty JSON with a trailing newline", async () => {
    const adapter = new FakeVaultAdapter();
    const store = new SpeakerStore(adapter);
    const alice = { ...validProfile, id: "vault-speaker-alice", displayName: " Alice " };
    const caro = {
      ...validProfile,
      id: "vault-speaker-caro",
      displayName: "Caro",
      aliases: ["Designer"],
      gatewaySpeakerId: "vp_caro"
    };
    const bob = {
      ...validProfile,
      id: "vault-speaker-bob",
      displayName: "Bob",
      aliases: ["Host"],
      gatewaySpeakerId: "vp_bob"
    };

    await store.save([caro, bob, alice]);

    expect(adapter.files.get(".local-asr/speakers.json")).toBe(
      `${JSON.stringify([{ ...alice, displayName: "Alice" }, bob, caro], null, 2)}\n`
    );
  });

  it("rejects invalid runtime profiles before writing", async () => {
    const adapter = new FakeVaultAdapter();
    const store = new SpeakerStore(adapter);

    await expect(store.save([{ ...validProfile, displayName: " " }])).rejects.toThrow(
      "Cannot save invalid speaker profiles"
    );

    expect(adapter.ensuredFolders).toEqual([]);
    expect(adapter.files.has(".local-asr/speakers.json")).toBe(false);
  });

  it("rejects duplicate runtime profile ids before writing", async () => {
    const adapter = new FakeVaultAdapter();
    const store = new SpeakerStore(adapter);

    await expect(store.save([validProfile, { ...validProfile, displayName: "Alice Duplicate" }])).rejects.toThrow(
      "Cannot save duplicate speaker profile ids"
    );

    expect(adapter.ensuredFolders).toEqual([]);
    expect(adapter.files.has(".local-asr/speakers.json")).toBe(false);
  });

  it("rejects duplicate runtime gateway speaker IDs before writing", async () => {
    const adapter = new FakeVaultAdapter();
    const store = new SpeakerStore(adapter);
    const duplicateGateway = {
      ...validProfile,
      id: "vault-speaker-bob",
      displayName: "Bob",
      aliases: ["Designer"]
    };

    await expect(store.save([validProfile, duplicateGateway])).rejects.toThrow(
      "Cannot save conflicting speaker profile identities"
    );

    expect(adapter.ensuredFolders).toEqual([]);
    expect(adapter.files.has(".local-asr/speakers.json")).toBe(false);
  });

  it("rejects runtime display name and alias identity collisions before writing", async () => {
    const adapter = new FakeVaultAdapter();
    const store = new SpeakerStore(adapter);
    const collidingProfile = {
      ...validProfile,
      id: "vault-speaker-bob",
      displayName: "Bob",
      aliases: [" ALICE "],
      gatewaySpeakerId: "vp_bob"
    };

    await expect(store.save([validProfile, collidingProfile])).rejects.toThrow(
      "Cannot save conflicting speaker profile identities"
    );

    expect(adapter.ensuredFolders).toEqual([]);
    expect(adapter.files.has(".local-asr/speakers.json")).toBe(false);
  });

  it("rejects duplicate aliases within one runtime profile before writing", async () => {
    const adapter = new FakeVaultAdapter();
    const store = new SpeakerStore(adapter);

    await expect(store.save([{ ...validProfile, aliases: ["PM", " pm "] }])).rejects.toThrow(
      "Cannot save conflicting speaker profile identities"
    );

    expect(adapter.ensuredFolders).toEqual([]);
    expect(adapter.files.has(".local-asr/speakers.json")).toBe(false);
  });

  it("rejects runtime profiles whose alias equals their display name before writing", async () => {
    const adapter = new FakeVaultAdapter();
    const store = new SpeakerStore(adapter);

    await expect(store.save([{ ...validProfile, aliases: [" alice "] }])).rejects.toThrow(
      "Cannot save conflicting speaker profile identities"
    );

    expect(adapter.ensuredFolders).toEqual([]);
    expect(adapter.files.has(".local-asr/speakers.json")).toBe(false);
  });

  it("strips extra runtime fields from serialized profile JSON", async () => {
    const adapter = new FakeVaultAdapter();
    const store = new SpeakerStore(adapter);
    const profileWithRuntimeFields = {
      ...validProfile,
      runtimeSpeakerMatch: { confidence: 0.9 },
      extra: true
    };

    await store.save([profileWithRuntimeFields]);

    expect(adapter.files.get(".local-asr/speakers.json")).toBe(`${JSON.stringify([validProfile], null, 2)}\n`);
  });

  it("trims persisted speaker identity fields when saving serialized JSON", async () => {
    const adapter = new FakeVaultAdapter();
    const store = new SpeakerStore(adapter);

    await store.save([
      {
        ...validProfile,
        id: " vault-speaker-alice ",
        displayName: " Alice ",
        aliases: [" PM ", " Facilitator "],
        gatewaySpeakerId: " vp_alice "
      }
    ]);

    expect(adapter.files.get(".local-asr/speakers.json")).toBe(
      `${JSON.stringify([{ ...validProfile, aliases: ["PM", "Facilitator"] }], null, 2)}\n`
    );
  });

  it("round-trips profiles created by the speaker domain helper", async () => {
    const adapter = new FakeVaultAdapter();
    const store = new SpeakerStore(adapter);
    const profile = createSpeakerProfile("Alice", "vp_alice");

    await store.save([profile]);

    expect(await store.loadEditable()).toEqual([profile]);
  });

  it("honors a custom path for reads and writes", async () => {
    const adapter = new FakeVaultAdapter();
    const store = new SpeakerStore(adapter, "custom/speakers.json");
    adapter.files.set("custom/speakers.json", JSON.stringify([validProfile]));

    await expect(store.load()).resolves.toEqual([validProfile]);

    const updated = { ...validProfile, displayName: "Alice Updated" };
    await store.save([updated]);
    expect(adapter.files.get("custom/speakers.json")).toBe(`${JSON.stringify([updated], null, 2)}\n`);
    expect(adapter.files.has(".local-asr/speakers.json")).toBe(false);
  });
});
