import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TFile, TFolder } from "obsidian";
import LocalTranscriptionPlugin, { ObsidianVaultAdapter } from "./main";
import { DEFAULT_SETTINGS } from "./settings";
import type { GatewayJob } from "./gatewayClient";

const noticeMessages = vi.hoisted((): string[] => []);

vi.mock("obsidian", () => {
  class TFile {
    constructor(public path: string) {}
  }

  class TFolder {
    constructor(public path: string) {}
  }

  class Plugin {
    app: unknown;

    constructor(app: unknown) {
      this.app = app;
    }

    addCommand = vi.fn();
    addRibbonIcon = vi.fn();
    addSettingTab = vi.fn();
    loadData = vi.fn();
    saveData = vi.fn();
  }

  class Modal {
    contentEl = {
      empty: vi.fn(),
      createEl: vi.fn(() => ({ setText: vi.fn() }))
    };

    constructor(public app: unknown) {}
    open = vi.fn();
  }

  class PluginSettingTab {
    containerEl = {
      empty: vi.fn(),
      createEl: vi.fn()
    };

    constructor(
      public app: unknown,
      public plugin: unknown
    ) {}
  }

  class Setting {
    constructor(public containerEl: unknown) {}
    setName = vi.fn(() => this);
    addText = vi.fn(() => this);
    addTextArea = vi.fn(() => this);
    addDropdown = vi.fn(() => this);
    addToggle = vi.fn(() => this);
  }

  class Notice {
    constructor(public message: string) {
      noticeMessages.push(message);
    }
  }

  return {
    App: class App {},
    Modal,
    Notice,
    Plugin,
    PluginSettingTab,
    Setting,
    TFile,
    TFolder,
    normalizePath: (path: string) => path.replace(/\\/g, "/").replace(/\/+/g, "/")
  };
});

function fakeTFile(path: string): TFile {
  return Object.assign(new TFile(), { path });
}

function fakeTFolder(path: string): TFolder {
  return Object.assign(new TFolder(), { path });
}

class FakeVault {
  files = new Map<string, string>();
  folders = new Set<string>();
  createdFolders: string[] = [];
  createdFiles: Array<{ path: string; content: string }> = [];
  modifiedFiles: Array<{ path: string; content: string }> = [];
  createFailures = new Map<string, Error>();
  readFailures = new Map<string, Error>();

  adapter = {
    exists: vi.fn(async (path: string) => this.files.has(path) || this.folders.has(path)),
    writeBinary: vi.fn()
  };

  getAbstractFileByPath(path: string): TFile | TFolder | null {
    if (this.files.has(path)) {
      return fakeTFile(path);
    }
    if (this.folders.has(path)) {
      return fakeTFolder(path);
    }
    return null;
  }

  async read(file: TFile): Promise<string> {
    const failure = this.readFailures.get(file.path);
    if (failure) {
      throw failure;
    }
    return this.files.get(file.path) ?? "";
  }

  async modify(file: TFile, content: string): Promise<void> {
    this.files.set(file.path, content);
    this.modifiedFiles.push({ path: file.path, content });
  }

  async create(path: string, content: string): Promise<TFile> {
    const failure = this.createFailures.get(path);
    if (failure) {
      throw failure;
    }
    if (this.files.has(path) || this.folders.has(path)) {
      throw new Error(`File already exists at ${path}`);
    }
    this.files.set(path, content);
    this.createdFiles.push({ path, content });
    return fakeTFile(path);
  }

  async createFolder(path: string): Promise<void> {
    if (this.files.has(path)) {
      throw new Error(`File exists at ${path}`);
    }
    if (this.folders.has(path)) {
      throw new Error(`Folder already exists at ${path}`);
    }
    this.folders.add(path);
    this.createdFolders.push(path);
  }
}

function createFakeApp(vault = new FakeVault()) {
  return {
    vault,
    secretStorage: {
      getSecret: vi.fn(),
      setSecret: vi.fn()
    }
  };
}

function largeSpeakerProfiles(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `vault-speaker-${index}`,
    displayName: `Speaker ${index}`,
    aliases: [],
    gatewaySpeakerId: `vp_${index}`,
    createdAt: "2026-06-02T00:00:00.000Z",
    updatedAt: "2026-06-02T00:00:00.000Z"
  }));
}

function largeMatchedSegments(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    start: index,
    end: index + 1,
    speaker: `Original${index}`,
    text: `hello ${index}`,
    speaker_match: {
      speaker_id: `vp_${index}`,
      display_name: `Gateway Speaker ${index}`,
      confidence: 0.9
    }
  }));
}

describe("DEFAULT_SETTINGS speaker workflow fields", () => {
  it("sets the speaker profile path and confidence thresholds", () => {
    expect(DEFAULT_SETTINGS.speakerProfilesPath).toBe(".local-transcription/speakers.json");
    expect(DEFAULT_SETTINGS.autoApplySpeakerConfidence).toBe(0.85);
    expect(DEFAULT_SETTINGS.suggestSpeakerConfidence).toBe(0.65);
  });
});

describe("ObsidianVaultAdapter", () => {
  it("reads only TFile entries and returns null for missing paths or folders", async () => {
    const vault = new FakeVault();
    vault.files.set(".local-transcription/speakers.json", "[]");
    vault.folders.add(".local-transcription");
    const adapter = new ObsidianVaultAdapter(createFakeApp(vault) as never);

    await expect(adapter.read(".local-transcription/speakers.json")).resolves.toBe("[]");
    await expect(adapter.read(".local-transcription")).resolves.toBeNull();
    await expect(adapter.read("missing.json")).resolves.toBeNull();
  });

  it("ensures the parent folder and creates new files when writing", async () => {
    const vault = new FakeVault();
    const adapter = new ObsidianVaultAdapter(createFakeApp(vault) as never);

    await adapter.write(".local-transcription/speakers.json", "[]\n");

    expect(vault.createdFolders).toEqual([".local-transcription"]);
    expect(vault.createdFiles).toEqual([{ path: ".local-transcription/speakers.json", content: "[]\n" }]);
    expect(vault.modifiedFiles).toEqual([]);
  });

  it("modifies an existing TFile when writing", async () => {
    const vault = new FakeVault();
    vault.folders.add(".local-transcription");
    vault.files.set(".local-transcription/speakers.json", "[]");
    const adapter = new ObsidianVaultAdapter(createFakeApp(vault) as never);

    await adapter.write(".local-transcription/speakers.json", "[\n]\n");

    expect(vault.createdFiles).toEqual([]);
    expect(vault.modifiedFiles).toEqual([{ path: ".local-transcription/speakers.json", content: "[\n]\n" }]);
  });

  it("throws a clear error when an intermediate folder path is an existing file", async () => {
    const vault = new FakeVault();
    vault.files.set(".local-transcription", "not a folder");
    const adapter = new ObsidianVaultAdapter(createFakeApp(vault) as never);

    await expect(adapter.ensureFolder(".local-transcription/nested")).rejects.toThrow(
      "Cannot create folder because a file exists at .local-transcription"
    );
    expect(vault.createdFolders).toEqual([]);
  });

  it("throws a clear error when writing to an existing folder path", async () => {
    const vault = new FakeVault();
    vault.folders.add(".local-transcription");
    vault.folders.add(".local-transcription/speakers.json");
    const adapter = new ObsidianVaultAdapter(createFakeApp(vault) as never);

    await expect(adapter.write(".local-transcription/speakers.json", "[]\n")).rejects.toThrow(
      "Cannot write file because a folder exists at .local-transcription/speakers.json"
    );
    expect(vault.createdFiles).toEqual([]);
    expect(vault.modifiedFiles).toEqual([]);
  });
});

describe("createTranscriptNote speaker workflow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-05T08:09:10.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders a speaker profile map and saves raw ASR JSON beside the note without overwriting", async () => {
    const vault = new FakeVault();
    vault.files.set(
      ".local-transcription/speakers.json",
      JSON.stringify([
        {
          id: "vault-speaker-alice",
          displayName: "Alice",
          aliases: [],
          gatewaySpeakerId: "vp_alice",
          createdAt: "2026-06-02T00:00:00.000Z",
          updatedAt: "2026-06-02T00:00:00.000Z"
        }
      ])
    );
    vault.files.set("Recordings/Transcripts/Meeting.raw-asr.json", "existing");
    const plugin = new LocalTranscriptionPlugin(createFakeApp(vault) as never, {} as never);
    plugin.pluginSettings = {
      ...DEFAULT_SETTINGS,
      noteFilenameTemplate: "Meeting",
      noteTemplate: "{{transcription}}",
      postProcessingEnabled: false
    };
    const result = {
      segments: [
        {
          start: 0,
          end: 1,
          speaker: "Speaker1",
          text: "hello",
          speaker_match: {
            speaker_id: "vp_alice",
            display_name: "Gateway Alice",
            confidence: 0.9
          }
        }
      ]
    };
    const job: GatewayJob = { id: "job-1", status: "completed", result };

    await (
      plugin as unknown as {
        createTranscriptNote(job: GatewayJob, audioPath: string, title: string): Promise<void>;
      }
    ).createTranscriptNote(job, "Recordings/Audio/input.wav", "ignored");

    const note = vault.files.get("Recordings/Transcripts/Meeting.md");
    expect(note).toMatch(/^---\nlocal_transcription_speakers:\n/);
    expect(note).toContain('"Speaker1":');
    expect(note).toContain('displayName: "Alice"');
    expect(note).toContain('source: "auto_high_confidence"');
    expect(note).toContain("confidence: 0.9");
    expect(note).toContain('profileId: "vault-speaker-alice"');
    expect(note).toContain('gatewaySpeakerId: "vp_alice"');
    expect(note).toMatch(/\n---\n\[00:00:00 - 00:00:01\] Alice: hello\n$/);
    expect(vault.files.get("Recordings/Transcripts/Meeting.raw-asr-2.json")).toBe(
      `${JSON.stringify(result, null, 2)}\n`
    );
    expect(vault.files.get("Recordings/Transcripts/Meeting.raw-asr.json")).toBe("existing");
  });

  it("writes large speaker maps to a sidecar and links the chosen path in frontmatter", async () => {
    const vault = new FakeVault();
    vault.files.set(".local-transcription/speakers.json", JSON.stringify(largeSpeakerProfiles(60)));
    vault.files.set("Recordings/Transcripts/Meeting.speaker-map.json", "existing");
    const plugin = new LocalTranscriptionPlugin(createFakeApp(vault) as never, {} as never);
    plugin.pluginSettings = {
      ...DEFAULT_SETTINGS,
      noteFilenameTemplate: "Meeting",
      noteTemplate: "{{transcription}}",
      postProcessingEnabled: false
    };
    const result = { segments: largeMatchedSegments(60) };
    const job: GatewayJob = { id: "job-1", status: "completed", result };

    await (
      plugin as unknown as {
        createTranscriptNote(job: GatewayJob, audioPath: string, title: string): Promise<void>;
      }
    ).createTranscriptNote(job, "Recordings/Audio/input.wav", "ignored");

    const note = vault.files.get("Recordings/Transcripts/Meeting.md");
    expect(note).toMatch(/^---\nlocal_transcription_speaker_map: "Recordings\/Transcripts\/Meeting.speaker-map-2.json"\n---\n/);
    expect(vault.files.get("Recordings/Transcripts/Meeting.speaker-map.json")).toBe("existing");
    const sidecar = vault.files.get("Recordings/Transcripts/Meeting.speaker-map-2.json");
    expect(sidecar).toBeTruthy();
    expect(sidecar?.endsWith("\n")).toBe(true);
    expect(JSON.parse(sidecar ?? "{}")).toMatchObject({
      Original0: {
        displayName: "Speaker 0",
        source: "auto_high_confidence",
        confidence: 0.9,
        profileId: "vault-speaker-0",
        gatewaySpeakerId: "vp_0"
      }
    });
  });

  it("does not create the markdown note when speaker map sidecar writing fails", async () => {
    const vault = new FakeVault();
    vault.files.set(".local-transcription/speakers.json", JSON.stringify(largeSpeakerProfiles(60)));
    vault.createFailures.set(
      "Recordings/Transcripts/Meeting.speaker-map.json",
      new Error("speaker map write failed")
    );
    const plugin = new LocalTranscriptionPlugin(createFakeApp(vault) as never, {} as never);
    plugin.pluginSettings = {
      ...DEFAULT_SETTINGS,
      noteFilenameTemplate: "Meeting",
      noteTemplate: "{{transcription}}",
      postProcessingEnabled: false
    };
    const result = { segments: largeMatchedSegments(60) };
    const job: GatewayJob = { id: "job-1", status: "completed", result };

    await expect(
      (
        plugin as unknown as {
          createTranscriptNote(job: GatewayJob, audioPath: string, title: string): Promise<void>;
        }
      ).createTranscriptNote(job, "Recordings/Audio/input.wav", "ignored")
    ).rejects.toThrow("speaker map write failed");

    expect(vault.files.has("Recordings/Transcripts/Meeting.raw-asr.json")).toBe(true);
    expect(vault.files.has("Recordings/Transcripts/Meeting.speaker-map.json")).toBe(false);
    expect(vault.files.has("Recordings/Transcripts/Meeting.md")).toBe(false);
  });

  it("does not create the markdown note when raw ASR sidecar writing fails", async () => {
    const vault = new FakeVault();
    vault.createFailures.set("Recordings/Transcripts/Meeting.raw-asr.json", new Error("raw write failed"));
    const plugin = new LocalTranscriptionPlugin(createFakeApp(vault) as never, {} as never);
    plugin.pluginSettings = {
      ...DEFAULT_SETTINGS,
      noteFilenameTemplate: "Meeting",
      noteTemplate: "{{transcription}}",
      postProcessingEnabled: false
    };
    const result = { text: "fallback text" };
    const job: GatewayJob = { id: "job-1", status: "completed", result };

    await expect(
      (
        plugin as unknown as {
          createTranscriptNote(job: GatewayJob, audioPath: string, title: string): Promise<void>;
        }
      ).createTranscriptNote(job, "Recordings/Audio/input.wav", "ignored")
    ).rejects.toThrow("raw write failed");

    expect(vault.files.has("Recordings/Transcripts/Meeting.raw-asr.json")).toBe(false);
    expect(vault.files.has("Recordings/Transcripts/Meeting.md")).toBe(false);
  });

  it("uses custom speaker confidence settings when rendering the transcript note", async () => {
    const vault = new FakeVault();
    vault.files.set(
      ".local-transcription/speakers.json",
      JSON.stringify([
        {
          id: "vault-speaker-alice",
          displayName: "Alice",
          aliases: [],
          gatewaySpeakerId: "vp_alice",
          createdAt: "2026-06-02T00:00:00.000Z",
          updatedAt: "2026-06-02T00:00:00.000Z"
        }
      ])
    );
    const plugin = new LocalTranscriptionPlugin(createFakeApp(vault) as never, {} as never);
    plugin.pluginSettings = {
      ...DEFAULT_SETTINGS,
      autoApplySpeakerConfidence: 0.95,
      suggestSpeakerConfidence: 0.5,
      noteFilenameTemplate: "Meeting",
      noteTemplate: "{{transcription}}",
      postProcessingEnabled: false
    };
    const result = {
      segments: [
        {
          start: 0,
          end: 1,
          speaker: "Speaker1",
          text: "hello",
          speaker_match: {
            speaker_id: "vp_alice",
            display_name: "Gateway Alice",
            confidence: 0.9
          }
        }
      ]
    };
    const job: GatewayJob = { id: "job-1", status: "completed", result };

    await (
      plugin as unknown as {
        createTranscriptNote(job: GatewayJob, audioPath: string, title: string): Promise<void>;
      }
    ).createTranscriptNote(job, "Recordings/Audio/input.wav", "ignored");

    expect(vault.files.get("Recordings/Transcripts/Meeting.md")).toMatch(
      /\n---\n\[00:00:00 - 00:00:01\] Speaker1: hello\n$/
    );
  });
});

describe("speaker commands", () => {
  afterEach(() => {
    noticeMessages.length = 0;
    vi.unstubAllGlobals();
  });

  it("shows a Notice when local speaker profiles fail to load", async () => {
    const vault = new FakeVault();
    vault.files.set(".local-transcription/speakers.json", "[]");
    vault.readFailures.set(".local-transcription/speakers.json", new Error("read failed"));
    const plugin = new LocalTranscriptionPlugin(createFakeApp(vault) as never, {} as never);
    plugin.pluginSettings = { ...DEFAULT_SETTINGS };

    await (
      plugin as unknown as {
        listSpeakers(): Promise<void>;
      }
    ).listSpeakers();

    expect(noticeMessages).toEqual(["Could not load local-transcription speakers: read failed"]);
  });

  it("shows a Notice when gateway voiceprint speaker checks fail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("gateway offline");
      })
    );
    const plugin = new LocalTranscriptionPlugin(createFakeApp() as never, {} as never);
    plugin.pluginSettings = { ...DEFAULT_SETTINGS };

    await (
      plugin as unknown as {
        checkVoiceprintSpeakers(): Promise<void>;
      }
    ).checkVoiceprintSpeakers();

    expect(noticeMessages).toEqual(["Could not check gateway voiceprint speakers: gateway offline"]);
  });
});
