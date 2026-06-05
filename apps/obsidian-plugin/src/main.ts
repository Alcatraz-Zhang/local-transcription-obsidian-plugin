import {
  App,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  TFolder,
  normalizePath
} from "obsidian";

import { GatewayClient, type GatewayJob } from "./gatewayClient";
import {
  DEFAULT_SETTINGS,
  POST_PROCESSING_SECRET_ID,
  type LocalTranscriptionSettings
} from "./settings";
import { expandTemplate, defaultTitleFromFile, safeNoteFileName } from "./template";
import { normalizeSegments, transcriptText } from "./transcript";
import { mergeProcessedTranscript, postProcessTranscript } from "./postProcessing";
import { SpeakerStore, type VaultAdapter } from "./speakerStore";
import { buildInitialSpeakerMap } from "./speakers";
import {
  buildSpeakerFrontmatter,
  prependSpeakerFrontmatter,
  shouldUseSpeakerSidecar,
  speakerSidecarPath
} from "./noteArtifacts";

function parentFolder(path: string): string | undefined {
  const normalized = normalizePath(path);
  const separator = normalized.lastIndexOf("/");
  if (separator <= 0) {
    return undefined;
  }
  return normalized.slice(0, separator);
}

export class ObsidianVaultAdapter implements VaultAdapter {
  constructor(private readonly app: App) {}

  async read(path: string): Promise<string | null> {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
    if (!(file instanceof TFile)) {
      return null;
    }
    return this.app.vault.read(file);
  }

  async ensureFolder(path: string): Promise<void> {
    if (!path) {
      return;
    }
    const normalized = normalizePath(path);
    const parts = normalized.split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      const existing = this.app.vault.getAbstractFileByPath(current);
      if (existing === null) {
        await this.app.vault.createFolder(current);
        continue;
      }
      if (existing instanceof TFolder) {
        continue;
      }
      throw new Error(`Cannot create folder because a file exists at ${current}`);
    }
  }

  async write(path: string, content: string): Promise<void> {
    const normalized = normalizePath(path);
    const folder = parentFolder(normalized);
    if (folder) {
      await this.ensureFolder(folder);
    }
    const file = this.app.vault.getAbstractFileByPath(normalized);
    if (file instanceof TFile) {
      await this.app.vault.modify(file, content);
      return;
    }
    if (file instanceof TFolder) {
      throw new Error(`Cannot write file because a folder exists at ${normalized}`);
    }
    await this.app.vault.create(normalized, content);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class StatusModal extends Modal {
  private statusEl: HTMLElement;

  constructor(app: App, private status: string) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.empty();
    this.contentEl.createEl("h2", { text: "Local Transcription" });
    this.statusEl = this.contentEl.createEl("pre", {
      cls: "local-transcription-status",
      text: this.status
    });
  }

  setStatus(status: string): void {
    this.status = status;
    if (this.statusEl) {
      this.statusEl.setText(status);
    }
  }
}

export default class LocalTranscriptionPlugin extends Plugin {
  pluginSettings: LocalTranscriptionSettings;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private statusModal: StatusModal | null = null;

  async onload(): Promise<void> {
    this.pluginSettings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.addSettingTab(new LocalTranscriptionSettingTab(this.app, this));

    this.addCommand({
      id: "upload-audio-file",
      name: "Upload audio file for transcription",
      callback: () => this.pickAndTranscribeFile()
    });
    this.addCommand({
      id: "start-recording",
      name: "Start recording",
      callback: () => this.startRecording()
    });
    this.addCommand({
      id: "stop-recording-and-transcribe",
      name: "Stop recording and transcribe",
      callback: () => this.stopRecordingAndTranscribe()
    });
    this.addCommand({
      id: "test-gateway-health",
      name: "Test gateway health",
      callback: () => this.testGatewayHealth()
    });
    this.addCommand({
      id: "local-transcription-list-speakers",
      name: "Local Transcription: List Speakers",
      callback: () => this.listSpeakers()
    });
    this.addCommand({
      id: "local-transcription-refresh-voiceprint-speakers",
      name: "Local Transcription: Check Voiceprint Speakers",
      callback: () => this.checkVoiceprintSpeakers()
    });
    this.addRibbonIcon("mic", "Local Transcription", () => this.pickAndTranscribeFile());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.pluginSettings);
  }

  async setPostProcessingApiKey(value: string): Promise<void> {
    await this.app.secretStorage.setSecret(POST_PROCESSING_SECRET_ID, value);
  }

  async getPostProcessingApiKey(): Promise<string> {
    return (await this.app.secretStorage.getSecret(POST_PROCESSING_SECRET_ID)) ?? "";
  }

  private client(): GatewayClient {
    return new GatewayClient(this.pluginSettings.gatewayUrl);
  }

  private speakerStore(): SpeakerStore {
    return new SpeakerStore(new ObsidianVaultAdapter(this.app), this.pluginSettings.speakerProfilesPath);
  }

  private async testGatewayHealth(): Promise<void> {
    const modal = this.openStatus("Checking gateway health...");
    try {
      const health = await this.client().health();
      modal.setStatus(JSON.stringify(health, null, 2));
    } catch (error) {
      modal.setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  private async listSpeakers(): Promise<void> {
    try {
      const profiles = await this.speakerStore().load();
      new Notice(
        profiles.length
          ? profiles.map((profile) => profile.displayName).join(", ")
          : "No Local Transcription speaker profiles yet."
      );
    } catch (error) {
      new Notice(`Could not load Local Transcription speakers: ${errorMessage(error)}`);
    }
  }

  private async checkVoiceprintSpeakers(): Promise<void> {
    try {
      const speakers = await this.client().listVoiceprintSpeakers();
      new Notice(`Gateway voiceprint speakers: ${speakers.speakers.length}`);
    } catch (error) {
      new Notice(`Could not check gateway voiceprint speakers: ${errorMessage(error)}`);
    }
  }

  private openStatus(message: string): StatusModal {
    this.statusModal = new StatusModal(this.app, message);
    this.statusModal.open();
    return this.statusModal;
  }

  private async pickAndTranscribeFile(): Promise<void> {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "audio/*,video/*";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        return;
      }
      await this.transcribeBlob(file, file.name);
    };
    input.click();
  }

  private async startRecording(): Promise<void> {
    if (this.recorder && this.recorder.state !== "inactive") {
      new Notice("Already recording");
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.chunks = [];
    this.recorder = new MediaRecorder(stream);
    this.recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) {
        this.chunks.push(event.data);
      }
    });
    this.recorder.start(1000);
    new Notice("Recording started");
  }

  private async stopRecordingAndTranscribe(): Promise<void> {
    if (!this.recorder || this.recorder.state === "inactive") {
      new Notice("No active recording");
      return;
    }
    const recorder = this.recorder;
    const blob = await new Promise<Blob>((resolve) => {
      recorder.addEventListener(
        "stop",
        () => {
          recorder.stream.getTracks().forEach((track) => track.stop());
          resolve(new Blob(this.chunks, { type: recorder.mimeType || "audio/webm" }));
        },
        { once: true }
      );
      recorder.stop();
    });
    this.recorder = null;
    const filename = `${new Date().toISOString().replace(/[:.]/g, "-")}.webm`;
    await this.transcribeBlob(blob, filename);
  }

  private async transcribeBlob(blob: Blob, sourceName: string): Promise<void> {
    const modal = this.openStatus("Saving audio...");
    const title = defaultTitleFromFile(sourceName);
    const audioPath = await this.saveAudio(blob, sourceName);
    modal.setStatus("Submitting transcription job...");

    const initialJob = await this.client().submitJob({
      blob,
      filename: sourceName,
      language: this.pluginSettings.language,
      model: this.pluginSettings.asrModel,
      outputMode: this.pluginSettings.outputMode
    });
    modal.setStatus(JSON.stringify(initialJob, null, 2));

    const job = await this.client().waitForJob(initialJob.id, (update) => {
      modal.setStatus(JSON.stringify(update, null, 2));
    });
    if (job.status !== "completed" || !job.result) {
      throw new Error(job.error || "Transcription failed");
    }

    await this.createTranscriptNote(job, audioPath, title);
    modal.setStatus(`Completed\n\n${JSON.stringify(job, null, 2)}`);
    new Notice("Transcription complete");
  }

  private async saveAudio(blob: Blob, sourceName: string): Promise<string> {
    await this.ensureFolder(this.pluginSettings.audioSavePath);
    const audioPath = normalizePath(`${this.pluginSettings.audioSavePath}/${sourceName}`);
    const buffer = await blob.arrayBuffer();
    await this.app.vault.adapter.writeBinary(audioPath, buffer);
    return audioPath;
  }

  private async createTranscriptNote(job: GatewayJob, audioPath: string, title: string): Promise<void> {
    await this.ensureFolder(this.pluginSettings.transcriptSavePath);
    const result = job.result ?? {};
    const normalizedSegments = normalizeSegments(result);
    const speakerProfiles = await this.speakerStore().load();
    const speakerMap = buildInitialSpeakerMap(normalizedSegments, speakerProfiles, {}, {
      autoApplySpeakerConfidence: this.pluginSettings.autoApplySpeakerConfidence,
      suggestSpeakerConfidence: this.pluginSettings.suggestSpeakerConfidence
    });
    const rawText = transcriptText(result, this.pluginSettings.outputMode, speakerMap);
    let finalText = rawText;
    if (this.pluginSettings.postProcessingEnabled) {
      const apiKey = await this.getPostProcessingApiKey();
      if (!apiKey) {
        throw new Error("Post-processing API key is not configured");
      }
      const processed = await postProcessTranscript({
        endpoint: this.pluginSettings.postProcessingUrl,
        apiKey,
        model: this.pluginSettings.postProcessingModel,
        prompt: this.pluginSettings.postProcessingPrompt,
        transcript: rawText,
        request: fetch
      });
      finalText = mergeProcessedTranscript(processed, rawText, this.pluginSettings.keepOriginalTranscription);
    }

    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const datetime = now.toISOString().replace("T", " ").slice(0, 19).replace(/:/g, "-");
    const variables = { audioFile: audioPath, transcription: finalText, title, date, datetime };
    const filename = safeNoteFileName(expandTemplate(this.pluginSettings.noteFilenameTemplate, variables));
    const notePath = await this.availablePath(normalizePath(`${this.pluginSettings.transcriptSavePath}/${filename}.md`));
    const rawAsrPath = await this.availablePath(notePath.replace(/\.md$/i, ".raw-asr.json"));
    const rawAsrContent = `${JSON.stringify(result, null, 2)}\n`;
    const speakerMapContent = `${JSON.stringify(speakerMap, null, 2)}\n`;
    const speakerMapSidecarPath = shouldUseSpeakerSidecar(speakerMap)
      ? await this.availablePath(speakerSidecarPath(notePath))
      : undefined;
    const frontmatter = speakerMapSidecarPath
      ? { local_transcription_speaker_map: speakerMapSidecarPath }
      : buildSpeakerFrontmatter(speakerMap);
    const content = prependSpeakerFrontmatter(
      expandTemplate(this.pluginSettings.noteTemplate, variables).trim() + "\n",
      frontmatter
    );
    const vaultAdapter = new ObsidianVaultAdapter(this.app);
    await vaultAdapter.write(rawAsrPath, rawAsrContent);
    if (speakerMapSidecarPath) {
      await vaultAdapter.write(speakerMapSidecarPath, speakerMapContent);
    }
    await this.app.vault.create(notePath, content);
  }

  private async ensureFolder(path: string): Promise<void> {
    await new ObsidianVaultAdapter(this.app).ensureFolder(path);
  }

  private async availablePath(path: string): Promise<string> {
    if (!(await this.app.vault.adapter.exists(path))) {
      return path;
    }
    const dot = path.lastIndexOf(".");
    const stem = dot >= 0 ? path.slice(0, dot) : path;
    const suffix = dot >= 0 ? path.slice(dot) : "";
    for (let index = 2; index < 1000; index++) {
      const candidate = `${stem}-${index}${suffix}`;
      if (!(await this.app.vault.adapter.exists(candidate))) {
        return candidate;
      }
    }
    throw new Error(`Could not find available path for ${path}`);
  }
}

class LocalTranscriptionSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: LocalTranscriptionPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Local Transcription" });

    new Setting(containerEl)
      .setName("Gateway URL")
      .addText((text) =>
        text.setValue(this.plugin.pluginSettings.gatewayUrl).onChange(async (value) => {
          this.plugin.pluginSettings.gatewayUrl = value.trim();
          await this.plugin.saveSettings();
        })
      );
    new Setting(containerEl)
      .setName("Audio folder")
      .addText((text) =>
        text.setValue(this.plugin.pluginSettings.audioSavePath).onChange(async (value) => {
          this.plugin.pluginSettings.audioSavePath = value.trim();
          await this.plugin.saveSettings();
        })
      );
    new Setting(containerEl)
      .setName("Transcript folder")
      .addText((text) =>
        text.setValue(this.plugin.pluginSettings.transcriptSavePath).onChange(async (value) => {
          this.plugin.pluginSettings.transcriptSavePath = value.trim();
          await this.plugin.saveSettings();
        })
      );
    new Setting(containerEl)
      .setName("Output mode")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("plain", "Plain text")
          .addOption("timestamp", "Timestamp")
          .addOption("speaker_timestamp", "Timestamp + speaker")
          .setValue(this.plugin.pluginSettings.outputMode)
          .onChange(async (value) => {
            this.plugin.pluginSettings.outputMode = value as LocalTranscriptionSettings["outputMode"];
            await this.plugin.saveSettings();
          })
      );
    new Setting(containerEl)
      .setName("Language")
      .addText((text) =>
        text.setValue(this.plugin.pluginSettings.language).onChange(async (value) => {
          this.plugin.pluginSettings.language = value.trim() || "auto";
          await this.plugin.saveSettings();
        })
      );
    new Setting(containerEl)
      .setName("Note filename template")
      .addText((text) =>
        text.setValue(this.plugin.pluginSettings.noteFilenameTemplate).onChange(async (value) => {
          this.plugin.pluginSettings.noteFilenameTemplate = value;
          await this.plugin.saveSettings();
        })
      );
    new Setting(containerEl)
      .setName("Note template")
      .addTextArea((text) =>
        text.setValue(this.plugin.pluginSettings.noteTemplate).onChange(async (value) => {
          this.plugin.pluginSettings.noteTemplate = value;
          await this.plugin.saveSettings();
        })
      );
    new Setting(containerEl)
      .setName("Post-processing")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.pluginSettings.postProcessingEnabled).onChange(async (value) => {
          this.plugin.pluginSettings.postProcessingEnabled = value;
          await this.plugin.saveSettings();
          this.display();
        })
      );
    if (this.plugin.pluginSettings.postProcessingEnabled) {
      new Setting(containerEl)
        .setName("Post-processing endpoint")
        .addText((text) =>
          text.setValue(this.plugin.pluginSettings.postProcessingUrl).onChange(async (value) => {
            this.plugin.pluginSettings.postProcessingUrl = value.trim();
            await this.plugin.saveSettings();
          })
        );
      new Setting(containerEl)
        .setName("Post-processing model")
        .addText((text) =>
          text.setValue(this.plugin.pluginSettings.postProcessingModel).onChange(async (value) => {
            this.plugin.pluginSettings.postProcessingModel = value.trim();
            await this.plugin.saveSettings();
          })
        );
      new Setting(containerEl)
        .setName("Post-processing API key")
        .addText((text) =>
          text.setPlaceholder("sk-...").onChange(async (value) => {
            await this.plugin.setPostProcessingApiKey(value.trim());
          })
        );
      new Setting(containerEl)
        .setName("Keep original transcription")
        .addToggle((toggle) =>
          toggle.setValue(this.plugin.pluginSettings.keepOriginalTranscription).onChange(async (value) => {
            this.plugin.pluginSettings.keepOriginalTranscription = value;
            await this.plugin.saveSettings();
          })
        );
    }
  }
}
