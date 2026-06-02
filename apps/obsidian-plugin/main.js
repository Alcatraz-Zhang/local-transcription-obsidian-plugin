/* Obsidian Local ASR Gateway */
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => LocalAsrGatewayPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");

// src/gatewayClient.ts
var GatewayClient = class {
  constructor(gatewayUrl) {
    this.gatewayUrl = gatewayUrl;
  }
  async health() {
    const response = await fetch(`${this.gatewayUrl.replace(/\/$/, "")}/health`);
    if (!response.ok) {
      throw new Error(`Gateway health check failed with HTTP ${response.status}`);
    }
    return response.json();
  }
  async submitJob(options) {
    const form = new FormData();
    form.append("file", options.blob, options.filename);
    form.append("language", options.language || "auto");
    form.append("model", options.model || "auto");
    form.append("output_mode", options.outputMode);
    const response = await fetch(`${this.gatewayUrl.replace(/\/$/, "")}/jobs`, {
      method: "POST",
      body: form
    });
    if (!response.ok) {
      throw new Error(`Gateway job submission failed with HTTP ${response.status}`);
    }
    return response.json();
  }
  async getJob(jobId) {
    const response = await fetch(`${this.gatewayUrl.replace(/\/$/, "")}/jobs/${jobId}`);
    if (!response.ok) {
      throw new Error(`Gateway job polling failed with HTTP ${response.status}`);
    }
    return response.json();
  }
  async waitForJob(jobId, onUpdate) {
    while (true) {
      const job = await this.getJob(jobId);
      onUpdate(job);
      if (job.status === "completed" || job.status === "failed") {
        return job;
      }
      await new Promise((resolve) => setTimeout(resolve, 2e3));
    }
  }
};

// src/settings.ts
var POST_PROCESSING_SECRET_ID = "local-asr-gateway-post-processing-api-key";
var DEFAULT_SETTINGS = {
  gatewayUrl: "http://localhost:17002",
  audioSavePath: "Recordings/Audio",
  transcriptSavePath: "Recordings/Transcripts",
  noteFilenameTemplate: "{{datetime}} - {{title}}",
  noteTemplate: "![[{{audioFile}}]]\n\n{{transcription}}",
  outputMode: "speaker_timestamp",
  language: "auto",
  asrModel: "auto",
  postProcessingEnabled: false,
  postProcessingUrl: "https://api.openai.com/v1/chat/completions",
  postProcessingModel: "",
  postProcessingPrompt: "You are a transcription editor. Clean up grammar and readability while preserving the original meaning and language.",
  keepOriginalTranscription: true
};

// src/template.ts
function expandTemplate(template, variables) {
  return template.replace(/\{\{(audioFile|transcription|title|date|datetime)\}\}/g, (_match, key) => {
    return variables[key];
  });
}
function safeNoteFileName(value) {
  return value.replace(/[\/\\?%*:|"<>]/g, "-").replace(/\s+/g, " ").trim() || "Untitled transcription";
}
function defaultTitleFromFile(filename) {
  const lastSlash = Math.max(filename.lastIndexOf("/"), filename.lastIndexOf("\\"));
  const basename = lastSlash >= 0 ? filename.slice(lastSlash + 1) : filename;
  return basename.replace(/\.[^.]+$/, "") || "Meeting transcription";
}

// src/transcript.ts
function formatTimestamp(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds ?? 0)));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total % 3600 / 60);
  const secs = total % 60;
  return [hours, minutes, secs].map((part) => part.toString().padStart(2, "0")).join(":");
}
function formatTranscript(segments, mode) {
  return segments.filter((segment) => segment.text.trim().length > 0).map((segment) => {
    const text = segment.text.trim();
    if (mode === "plain") {
      return text;
    }
    const range = `[${formatTimestamp(segment.start)} - ${formatTimestamp(segment.end)}]`;
    if (mode === "timestamp") {
      return `${range} ${text}`;
    }
    return `${range} ${segment.speaker?.trim() || "Speaker"}: ${text}`;
  }).join("\n");
}
function cleanAsrText(value) {
  return String(value ?? "").replace(/\s*language\s+[^<]*<asr_text>\s*/gi, "").replace(/<asr_text>/g, "").trim();
}
function timeValue(segment, keys) {
  for (const key of keys) {
    const value = segment[key];
    if (value === void 0 || value === null || value === "") {
      continue;
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      continue;
    }
    if ((key === "begin_time" || key === "end_time" || key === "begin_time_milliseconds" || key === "end_time_milliseconds") && numeric > 1e3) {
      return numeric / 1e3;
    }
    return numeric;
  }
  return 0;
}
function speakerMatchValue(segment) {
  const match = segment.speaker_match;
  if (!match) {
    return void 0;
  }
  const normalized = {
    speakerId: match.speaker_id,
    displayName: match.display_name,
    confidence: match.confidence,
    status: match.status
  };
  return Object.values(normalized).some((value) => value !== void 0 && value !== "") ? normalized : void 0;
}
function normalizeSegments(payload) {
  const source = payload.segments?.length ? payload.segments : payload.sentence_info ?? [];
  return source.map((segment) => {
    const text = cleanAsrText(segment.text ?? segment.sentence ?? segment.raw_text);
    if (!text) {
      return null;
    }
    const speaker = cleanAsrText(segment.speaker ?? segment.speaker_id ?? segment.spk);
    return {
      start: timeValue(segment, ["start", "start_time", "begin_time", "begin_time_milliseconds"]),
      end: timeValue(segment, ["end", "end_time", "end_time_milliseconds"]),
      speaker: speaker || void 0,
      text,
      words: Array.isArray(segment.words) ? segment.words : void 0,
      speakerMatch: speakerMatchValue(segment)
    };
  }).filter((segment) => segment !== null);
}
function transcriptText(payload, mode) {
  const segments = normalizeSegments(payload);
  if (segments.length) {
    return formatTranscript(segments, mode);
  }
  return payload.text?.trim() ?? "";
}

// src/postProcessing.ts
function buildPostProcessingPrompt(userPrompt) {
  return [
    userPrompt.trim(),
    "preserve every timestamp and speaker label exactly. Lines may begin like [00:00:00 - 00:00:05] Speaker1:. Keep those prefixes unchanged and keep one utterance per line. Return only the polished transcript."
  ].filter(Boolean).join("\n\n");
}
function mergeProcessedTranscript(processed, raw, keepOriginal) {
  if (!keepOriginal || processed.trim() === raw.trim()) {
    return processed;
  }
  return `${processed.trim()}

---

## Original transcription

${raw.trim()}`;
}
async function postProcessTranscript(options) {
  const response = await options.request(options.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${options.apiKey}`
    },
    body: JSON.stringify({
      model: options.model,
      messages: [
        { role: "system", content: buildPostProcessingPrompt(options.prompt) },
        { role: "user", content: options.transcript }
      ]
    })
  });
  if (!response.ok) {
    throw new Error(`Post-processing failed with HTTP ${response.status}`);
  }
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("Post-processing response did not include message content");
  }
  return content.trim();
}

// src/main.ts
var StatusModal = class extends import_obsidian.Modal {
  constructor(app, status) {
    super(app);
    this.status = status;
  }
  statusEl;
  onOpen() {
    this.contentEl.empty();
    this.contentEl.createEl("h2", { text: "Local ASR Gateway" });
    this.statusEl = this.contentEl.createEl("pre", {
      cls: "local-asr-status",
      text: this.status
    });
  }
  setStatus(status) {
    this.status = status;
    if (this.statusEl) {
      this.statusEl.setText(status);
    }
  }
};
var LocalAsrGatewayPlugin = class extends import_obsidian.Plugin {
  pluginSettings;
  recorder = null;
  chunks = [];
  statusModal = null;
  async onload() {
    this.pluginSettings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.addSettingTab(new LocalAsrSettingTab(this.app, this));
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
    this.addRibbonIcon("mic", "Local ASR Gateway", () => this.pickAndTranscribeFile());
  }
  async saveSettings() {
    await this.saveData(this.pluginSettings);
  }
  async setPostProcessingApiKey(value) {
    await this.app.secretStorage.setSecret(POST_PROCESSING_SECRET_ID, value);
  }
  async getPostProcessingApiKey() {
    return await this.app.secretStorage.getSecret(POST_PROCESSING_SECRET_ID) ?? "";
  }
  client() {
    return new GatewayClient(this.pluginSettings.gatewayUrl);
  }
  async testGatewayHealth() {
    const modal = this.openStatus("Checking gateway health...");
    try {
      const health = await this.client().health();
      modal.setStatus(JSON.stringify(health, null, 2));
    } catch (error) {
      modal.setStatus(error instanceof Error ? error.message : String(error));
    }
  }
  openStatus(message) {
    this.statusModal = new StatusModal(this.app, message);
    this.statusModal.open();
    return this.statusModal;
  }
  async pickAndTranscribeFile() {
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
  async startRecording() {
    if (this.recorder && this.recorder.state !== "inactive") {
      new import_obsidian.Notice("Already recording");
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
    this.recorder.start(1e3);
    new import_obsidian.Notice("Recording started");
  }
  async stopRecordingAndTranscribe() {
    if (!this.recorder || this.recorder.state === "inactive") {
      new import_obsidian.Notice("No active recording");
      return;
    }
    const recorder = this.recorder;
    const blob = await new Promise((resolve) => {
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
    const filename = `${(/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-")}.webm`;
    await this.transcribeBlob(blob, filename);
  }
  async transcribeBlob(blob, sourceName) {
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
    modal.setStatus(`Completed

${JSON.stringify(job, null, 2)}`);
    new import_obsidian.Notice("Transcription complete");
  }
  async saveAudio(blob, sourceName) {
    await this.ensureFolder(this.pluginSettings.audioSavePath);
    const audioPath = (0, import_obsidian.normalizePath)(`${this.pluginSettings.audioSavePath}/${sourceName}`);
    const buffer = await blob.arrayBuffer();
    await this.app.vault.adapter.writeBinary(audioPath, buffer);
    return audioPath;
  }
  async createTranscriptNote(job, audioPath, title) {
    await this.ensureFolder(this.pluginSettings.transcriptSavePath);
    const rawText = transcriptText(job.result ?? {}, this.pluginSettings.outputMode);
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
    const now = /* @__PURE__ */ new Date();
    const date = now.toISOString().slice(0, 10);
    const datetime = now.toISOString().replace("T", " ").slice(0, 19).replace(/:/g, "-");
    const variables = { audioFile: audioPath, transcription: finalText, title, date, datetime };
    const filename = safeNoteFileName(expandTemplate(this.pluginSettings.noteFilenameTemplate, variables));
    const notePath = await this.availablePath((0, import_obsidian.normalizePath)(`${this.pluginSettings.transcriptSavePath}/${filename}.md`));
    const content = expandTemplate(this.pluginSettings.noteTemplate, variables).trim() + "\n";
    await this.app.vault.create(notePath, content);
  }
  async ensureFolder(path) {
    if (!path) {
      return;
    }
    const normalized = (0, import_obsidian.normalizePath)(path);
    const parts = normalized.split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!await this.app.vault.adapter.exists(current)) {
        await this.app.vault.createFolder(current);
      }
    }
  }
  async availablePath(path) {
    if (!await this.app.vault.adapter.exists(path)) {
      return path;
    }
    const dot = path.lastIndexOf(".");
    const stem = dot >= 0 ? path.slice(0, dot) : path;
    const suffix = dot >= 0 ? path.slice(dot) : "";
    for (let index = 2; index < 1e3; index++) {
      const candidate = `${stem}-${index}${suffix}`;
      if (!await this.app.vault.adapter.exists(candidate)) {
        return candidate;
      }
    }
    throw new Error(`Could not find available path for ${path}`);
  }
};
var LocalAsrSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Local ASR Gateway" });
    new import_obsidian.Setting(containerEl).setName("Gateway URL").addText(
      (text) => text.setValue(this.plugin.pluginSettings.gatewayUrl).onChange(async (value) => {
        this.plugin.pluginSettings.gatewayUrl = value.trim();
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Audio folder").addText(
      (text) => text.setValue(this.plugin.pluginSettings.audioSavePath).onChange(async (value) => {
        this.plugin.pluginSettings.audioSavePath = value.trim();
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Transcript folder").addText(
      (text) => text.setValue(this.plugin.pluginSettings.transcriptSavePath).onChange(async (value) => {
        this.plugin.pluginSettings.transcriptSavePath = value.trim();
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Output mode").addDropdown(
      (dropdown) => dropdown.addOption("plain", "Plain text").addOption("timestamp", "Timestamp").addOption("speaker_timestamp", "Timestamp + speaker").setValue(this.plugin.pluginSettings.outputMode).onChange(async (value) => {
        this.plugin.pluginSettings.outputMode = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Language").addText(
      (text) => text.setValue(this.plugin.pluginSettings.language).onChange(async (value) => {
        this.plugin.pluginSettings.language = value.trim() || "auto";
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Note filename template").addText(
      (text) => text.setValue(this.plugin.pluginSettings.noteFilenameTemplate).onChange(async (value) => {
        this.plugin.pluginSettings.noteFilenameTemplate = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Note template").addTextArea(
      (text) => text.setValue(this.plugin.pluginSettings.noteTemplate).onChange(async (value) => {
        this.plugin.pluginSettings.noteTemplate = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Post-processing").addToggle(
      (toggle) => toggle.setValue(this.plugin.pluginSettings.postProcessingEnabled).onChange(async (value) => {
        this.plugin.pluginSettings.postProcessingEnabled = value;
        await this.plugin.saveSettings();
        this.display();
      })
    );
    if (this.plugin.pluginSettings.postProcessingEnabled) {
      new import_obsidian.Setting(containerEl).setName("Post-processing endpoint").addText(
        (text) => text.setValue(this.plugin.pluginSettings.postProcessingUrl).onChange(async (value) => {
          this.plugin.pluginSettings.postProcessingUrl = value.trim();
          await this.plugin.saveSettings();
        })
      );
      new import_obsidian.Setting(containerEl).setName("Post-processing model").addText(
        (text) => text.setValue(this.plugin.pluginSettings.postProcessingModel).onChange(async (value) => {
          this.plugin.pluginSettings.postProcessingModel = value.trim();
          await this.plugin.saveSettings();
        })
      );
      new import_obsidian.Setting(containerEl).setName("Post-processing API key").addText(
        (text) => text.setPlaceholder("sk-...").onChange(async (value) => {
          await this.plugin.setPostProcessingApiKey(value.trim());
        })
      );
      new import_obsidian.Setting(containerEl).setName("Keep original transcription").addToggle(
        (toggle) => toggle.setValue(this.plugin.pluginSettings.keepOriginalTranscription).onChange(async (value) => {
          this.plugin.pluginSettings.keepOriginalTranscription = value;
          await this.plugin.saveSettings();
        })
      );
    }
  }
};
