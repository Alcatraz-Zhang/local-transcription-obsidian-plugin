/* local-transcription */
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
  ObsidianVaultAdapter: () => ObsidianVaultAdapter,
  default: () => LocalTranscriptionPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");

// src/gatewayClient.ts
var GatewayClient = class {
  constructor(gatewayUrl) {
    this.gatewayUrl = gatewayUrl;
  }
  baseUrl() {
    return this.gatewayUrl.replace(/\/+$/, "");
  }
  async health() {
    const response = await fetch(`${this.baseUrl()}/health`);
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
    const response = await fetch(`${this.baseUrl()}/jobs`, {
      method: "POST",
      body: form
    });
    if (!response.ok) {
      throw new Error(`Gateway job submission failed with HTTP ${response.status}`);
    }
    return response.json();
  }
  async getJob(jobId) {
    const response = await fetch(`${this.baseUrl()}/jobs/${jobId}`);
    if (!response.ok) {
      throw new Error(`Gateway job polling failed with HTTP ${response.status}`);
    }
    return response.json();
  }
  async listVoiceprintSpeakers() {
    const response = await fetch(`${this.baseUrl()}/voiceprints/speakers`);
    if (!response.ok) {
      throw new Error(`Voiceprint speaker list failed with HTTP ${response.status}`);
    }
    return response.json();
  }
  async createVoiceprintSpeaker(options) {
    const form = new FormData();
    form.append("display_name", options.displayName);
    form.append("description", options.description ?? "");
    options.files.forEach((file, index) => {
      form.append("file", file, `voiceprint-${index + 1}.wav`);
    });
    const response = await fetch(`${this.baseUrl()}/voiceprints/speakers`, {
      method: "POST",
      body: form
    });
    if (!response.ok) {
      throw new Error(`Voiceprint speaker creation failed with HTTP ${response.status}`);
    }
    return response.json();
  }
  async addVoiceprintSamples(speakerId, files) {
    const form = new FormData();
    files.forEach((file, index) => {
      form.append("file", file, `voiceprint-sample-${index + 1}.wav`);
    });
    const response = await fetch(
      `${this.baseUrl()}/voiceprints/speakers/${encodeURIComponent(speakerId)}/samples`,
      {
        method: "POST",
        body: form
      }
    );
    if (!response.ok) {
      throw new Error(`Voiceprint sample upload failed with HTTP ${response.status}`);
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
var POST_PROCESSING_SECRET_ID = "local-transcription-post-processing-api-key";
var DEFAULT_SETTINGS = {
  gatewayUrl: "http://localhost:17003",
  audioSavePath: "Recordings/Audio",
  transcriptSavePath: "Recordings/Transcripts",
  speakerProfilesPath: ".local-transcription/speakers.json",
  autoApplySpeakerConfidence: 0.85,
  suggestSpeakerConfidence: 0.65,
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

// src/speakers.ts
var HIGH_CONFIDENCE_THRESHOLD = 0.85;
var MEDIUM_CONFIDENCE_THRESHOLD = 0.65;
var SPEAKER_MAP_SOURCE_PRIORITY = {
  suggested: 1,
  auto_high_confidence: 2,
  manual: 3
};
function normalizeSpeakerIdentity(value) {
  return value?.trim().toLowerCase() ?? "";
}
function validThreshold(value) {
  return value !== void 0 && Number.isFinite(value) && value >= 0 && value <= 1;
}
function resolveConfidenceThresholds(options) {
  const autoApplySpeakerConfidence = options?.autoApplySpeakerConfidence === void 0 || validThreshold(options.autoApplySpeakerConfidence) ? options?.autoApplySpeakerConfidence ?? HIGH_CONFIDENCE_THRESHOLD : HIGH_CONFIDENCE_THRESHOLD;
  const suggestSpeakerConfidence = options?.suggestSpeakerConfidence === void 0 || validThreshold(options.suggestSpeakerConfidence) ? options?.suggestSpeakerConfidence ?? MEDIUM_CONFIDENCE_THRESHOLD : MEDIUM_CONFIDENCE_THRESHOLD;
  if (autoApplySpeakerConfidence < suggestSpeakerConfidence) {
    return {
      autoApplySpeakerConfidence: HIGH_CONFIDENCE_THRESHOLD,
      suggestSpeakerConfidence: MEDIUM_CONFIDENCE_THRESHOLD
    };
  }
  return { autoApplySpeakerConfidence, suggestSpeakerConfidence };
}
function confidenceAction(confidence, options) {
  if (confidence === void 0 || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    return "ignore";
  }
  const thresholds = resolveConfidenceThresholds(options);
  if (confidence >= thresholds.autoApplySpeakerConfidence) {
    return "auto";
  }
  if (confidence >= thresholds.suggestSpeakerConfidence) {
    return "suggest";
  }
  return "ignore";
}
function profileIdentityForMatch(segment, profiles) {
  const speakerId = segment.speakerMatch?.speakerId;
  if (speakerId) {
    const profile2 = profiles.find((item) => item.gatewaySpeakerId === speakerId);
    if (profile2) {
      return {
        displayName: profile2.displayName,
        profileId: profile2.id
      };
    }
  }
  const displayName = segment.speakerMatch?.displayName;
  if (!displayName) {
    return void 0;
  }
  const normalizedDisplayName = normalizeSpeakerIdentity(displayName);
  if (!normalizedDisplayName) {
    return void 0;
  }
  const profile = profiles.find(
    (item) => normalizeSpeakerIdentity(item.displayName) === normalizedDisplayName || item.aliases.some((alias) => normalizeSpeakerIdentity(alias) === normalizedDisplayName)
  );
  if (profile) {
    return {
      displayName: profile.displayName,
      profileId: profile.id
    };
  }
  return { displayName: displayName.trim() };
}
function originalSpeakerLabel(segment) {
  return segment.originalSpeaker || segment.speaker;
}
function finiteConfidence(confidence) {
  return confidence !== void 0 && Number.isFinite(confidence) ? confidence : void 0;
}
function shouldReplaceSpeakerMapEntry(current, candidate) {
  if (!current) {
    return true;
  }
  const currentPriority = SPEAKER_MAP_SOURCE_PRIORITY[current.source];
  const candidatePriority = SPEAKER_MAP_SOURCE_PRIORITY[candidate.source];
  if (candidatePriority !== currentPriority) {
    return candidatePriority > currentPriority;
  }
  const currentConfidence = finiteConfidence(current.confidence);
  const candidateConfidence = finiteConfidence(candidate.confidence);
  if (candidateConfidence === void 0) {
    return false;
  }
  if (currentConfidence === void 0) {
    return true;
  }
  return candidateConfidence > currentConfidence;
}
function buildInitialSpeakerMap(segments, profiles, existing = {}, options) {
  const next = { ...existing };
  for (const segment of segments) {
    const label = originalSpeakerLabel(segment);
    if (!label || next[label]?.source === "manual") {
      continue;
    }
    const matchIdentity = profileIdentityForMatch(segment, profiles);
    if (!matchIdentity) {
      continue;
    }
    const confidence = segment.speakerMatch?.confidence;
    const gatewaySpeakerId = segment.speakerMatch?.speakerId;
    const action = confidenceAction(confidence, options);
    let candidate;
    if (action === "auto") {
      candidate = {
        displayName: matchIdentity.displayName,
        ...matchIdentity.profileId === void 0 ? {} : { profileId: matchIdentity.profileId },
        source: "auto_high_confidence",
        confidence,
        gatewaySpeakerId,
        autoMatched: true
      };
    }
    if (action === "suggest") {
      candidate = {
        suggestedDisplayName: matchIdentity.displayName,
        ...matchIdentity.profileId === void 0 ? {} : { profileId: matchIdentity.profileId },
        source: "suggested",
        confidence,
        gatewaySpeakerId
      };
    }
    if (candidate && shouldReplaceSpeakerMapEntry(next[label], candidate)) {
      next[label] = candidate;
    }
  }
  return next;
}
function applySpeakerMap(segments, speakerMap) {
  return segments.map((segment) => {
    const originalSpeaker = originalSpeakerLabel(segment);
    const mapped = originalSpeaker ? speakerMap[originalSpeaker] : void 0;
    if (!originalSpeaker) {
      return { ...segment };
    }
    if (!mapped?.displayName) {
      return { ...segment, originalSpeaker };
    }
    return {
      ...segment,
      originalSpeaker,
      speaker: mapped.displayName
    };
  });
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
function transcriptText(payload, mode, speakerMap) {
  const segments = normalizeSegments(payload);
  if (segments.length) {
    return formatTranscript(speakerMap ? applySpeakerMap(segments, speakerMap) : segments, mode);
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

// src/speakerStore.ts
var SPEAKER_PROFILE_PATH = ".local-transcription/speakers.json";
function isNonblankString(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function isIsoTimestampString(value) {
  if (typeof value !== "string") {
    return false;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(value).toISOString() === value;
}
function isProfile(value) {
  if (!value || typeof value !== "object") {
    return false;
  }
  const item = value;
  return Boolean(
    isNonblankString(item.id) && isNonblankString(item.displayName) && Array.isArray(item.aliases) && item.aliases.every(isNonblankString) && (item.gatewaySpeakerId === void 0 || isNonblankString(item.gatewaySpeakerId)) && isIsoTimestampString(item.createdAt) && isIsoTimestampString(item.updatedAt)
  );
}
function compareProfiles(a, b) {
  const byDisplayName = normalizeSpeakerIdentity(a.displayName).localeCompare(normalizeSpeakerIdentity(b.displayName));
  if (byDisplayName !== 0) {
    return byDisplayName;
  }
  return a.id.localeCompare(b.id);
}
function hasDuplicateProfileIds(profiles) {
  const seen = /* @__PURE__ */ new Set();
  for (const profile of profiles) {
    if (seen.has(profile.id)) {
      return true;
    }
    seen.add(profile.id);
  }
  return false;
}
function createSpeakerIdentityIndex() {
  return {
    ids: /* @__PURE__ */ new Set(),
    gatewaySpeakerIds: /* @__PURE__ */ new Set(),
    namesAndAliases: /* @__PURE__ */ new Set()
  };
}
function normalizedAliases(profile) {
  return profile.aliases.map((alias) => normalizeSpeakerIdentity(alias));
}
function normalizeGatewaySpeakerId(value) {
  return value?.trim() ?? "";
}
function hasDuplicateAliases(profile) {
  const seen = /* @__PURE__ */ new Set();
  for (const alias of normalizedAliases(profile)) {
    if (seen.has(alias)) {
      return true;
    }
    seen.add(alias);
  }
  return false;
}
function hasAliasDisplayNameCollision(profile) {
  const displayName = normalizeSpeakerIdentity(profile.displayName);
  return normalizedAliases(profile).some((alias) => alias === displayName);
}
function hasInvalidProfileIdentities(profile) {
  return hasDuplicateAliases(profile) || hasAliasDisplayNameCollision(profile);
}
function conflictsWithExistingIdentity(profile, index) {
  if (index.ids.has(profile.id)) {
    return true;
  }
  const gatewaySpeakerId = normalizeGatewaySpeakerId(profile.gatewaySpeakerId);
  if (gatewaySpeakerId && index.gatewaySpeakerIds.has(gatewaySpeakerId)) {
    return true;
  }
  const namesAndAliases = [normalizeSpeakerIdentity(profile.displayName), ...normalizedAliases(profile)];
  return namesAndAliases.some((identity) => index.namesAndAliases.has(identity));
}
function hasDuplicateGatewaySpeakerId(profile, index) {
  const gatewaySpeakerId = normalizeGatewaySpeakerId(profile.gatewaySpeakerId);
  return Boolean(gatewaySpeakerId && index.gatewaySpeakerIds.has(gatewaySpeakerId));
}
function hasCrossProfileNameOrAliasCollision(profile, index) {
  const namesAndAliases = [normalizeSpeakerIdentity(profile.displayName), ...normalizedAliases(profile)];
  return namesAndAliases.some((identity) => index.namesAndAliases.has(identity));
}
function addProfileIdentity(profile, index) {
  index.ids.add(profile.id);
  const gatewaySpeakerId = normalizeGatewaySpeakerId(profile.gatewaySpeakerId);
  if (gatewaySpeakerId) {
    index.gatewaySpeakerIds.add(gatewaySpeakerId);
  }
  index.namesAndAliases.add(normalizeSpeakerIdentity(profile.displayName));
  for (const alias of normalizedAliases(profile)) {
    index.namesAndAliases.add(alias);
  }
}
function hasConflictingProfileIdentities(profiles) {
  const index = createSpeakerIdentityIndex();
  for (const profile of profiles) {
    if (hasInvalidProfileIdentities(profile) || conflictsWithExistingIdentity(profile, index)) {
      return true;
    }
    addProfileIdentity(profile, index);
  }
  return false;
}
function sanitizeProfile(profile) {
  if (profile.gatewaySpeakerId === void 0) {
    return {
      id: profile.id.trim(),
      displayName: profile.displayName.trim(),
      aliases: profile.aliases.map((alias) => alias.trim()),
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt
    };
  }
  return {
    id: profile.id.trim(),
    displayName: profile.displayName.trim(),
    aliases: profile.aliases.map((alias) => alias.trim()),
    gatewaySpeakerId: profile.gatewaySpeakerId.trim(),
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt
  };
}
function createInvalidReasonCounts() {
  return {
    invalidShape: 0,
    duplicateId: 0,
    duplicateGatewaySpeakerId: 0,
    conflictingAliases: 0,
    conflictingDisplayNameOrAlias: 0
  };
}
function totalInvalidReasonCount(reasonCounts) {
  return Object.values(reasonCounts).reduce((total, count) => total + count, 0);
}
function pluralizeProfile(count) {
  return count === 1 ? "profile" : "profiles";
}
function buildInvalidWarnings(reasonCounts) {
  const warnings = [];
  if (reasonCounts.invalidShape > 0) {
    warnings.push(`Ignored ${reasonCounts.invalidShape} ${pluralizeProfile(reasonCounts.invalidShape)} with invalid shape`);
  }
  if (reasonCounts.duplicateId > 0) {
    warnings.push(`Ignored ${reasonCounts.duplicateId} ${pluralizeProfile(reasonCounts.duplicateId)} with duplicate id`);
  }
  if (reasonCounts.duplicateGatewaySpeakerId > 0) {
    warnings.push(
      `Ignored ${reasonCounts.duplicateGatewaySpeakerId} ${pluralizeProfile(
        reasonCounts.duplicateGatewaySpeakerId
      )} with duplicate gateway speaker id`
    );
  }
  if (reasonCounts.conflictingAliases > 0) {
    warnings.push(
      `Ignored ${reasonCounts.conflictingAliases} ${pluralizeProfile(reasonCounts.conflictingAliases)} with conflicting aliases`
    );
  }
  if (reasonCounts.conflictingDisplayNameOrAlias > 0) {
    warnings.push(
      `Ignored ${reasonCounts.conflictingDisplayNameOrAlias} ${pluralizeProfile(
        reasonCounts.conflictingDisplayNameOrAlias
      )} with conflicting display name or alias`
    );
  }
  return warnings;
}
function collectValidProfiles(values) {
  const profiles = [];
  const index = createSpeakerIdentityIndex();
  const reasonCounts = createInvalidReasonCounts();
  for (const value of values) {
    if (!isProfile(value)) {
      reasonCounts.invalidShape += 1;
      continue;
    }
    const profile = sanitizeProfile(value);
    if (hasInvalidProfileIdentities(profile)) {
      reasonCounts.conflictingAliases += 1;
      continue;
    }
    if (index.ids.has(profile.id)) {
      reasonCounts.duplicateId += 1;
      continue;
    }
    if (hasDuplicateGatewaySpeakerId(profile, index)) {
      reasonCounts.duplicateGatewaySpeakerId += 1;
      continue;
    }
    if (hasCrossProfileNameOrAliasCollision(profile, index)) {
      reasonCounts.conflictingDisplayNameOrAlias += 1;
      continue;
    }
    addProfileIdentity(profile, index);
    profiles.push(profile);
  }
  return {
    profiles,
    invalidCount: totalInvalidReasonCount(reasonCounts),
    warnings: buildInvalidWarnings(reasonCounts)
  };
}
function parentFolder(path) {
  const slash = path.lastIndexOf("/");
  const backslash = path.lastIndexOf("\\");
  const separator = Math.max(slash, backslash);
  if (separator <= 0) {
    return void 0;
  }
  return path.slice(0, separator);
}
var SpeakerStore = class {
  constructor(adapter, path = SPEAKER_PROFILE_PATH) {
    this.adapter = adapter;
    this.path = path;
  }
  /**
   * Sanitized convenience load for read-only display paths. Write flows should
   * use loadEditable() so partial or invalid storage cannot be silently replaced.
   */
  async load() {
    const result = await this.loadWithStatus();
    return result.profiles;
  }
  async loadEditable() {
    const result = await this.loadWithStatus();
    if (result.status === "partial" || result.status === "invalid") {
      throw new Error(`Cannot edit speaker profiles because storage status is ${result.status}`);
    }
    return result.profiles;
  }
  async loadWithStatus() {
    const content = await this.adapter.read(this.path);
    if (content === null) {
      return { status: "missing", profiles: [] };
    }
    if (content.trim().length === 0) {
      return { status: "invalid", profiles: [] };
    }
    try {
      const parsed = JSON.parse(content);
      if (!Array.isArray(parsed)) {
        return {
          status: "invalid",
          profiles: [],
          error: "Speaker profile storage must contain a JSON array"
        };
      }
      const { profiles, invalidCount, warnings } = collectValidProfiles(parsed);
      if (invalidCount > 0) {
        return {
          status: profiles.length > 0 ? "partial" : "invalid",
          profiles,
          invalidCount,
          warnings
        };
      }
      return { status: "ok", profiles };
    } catch (error) {
      return {
        status: "invalid",
        profiles: [],
        error: error instanceof Error ? error.message : "Malformed speaker profile storage JSON"
      };
    }
  }
  async save(profiles) {
    if (!profiles.every(isProfile)) {
      throw new Error("Cannot save invalid speaker profiles");
    }
    const sanitized = profiles.map(sanitizeProfile);
    if (hasDuplicateProfileIds(sanitized)) {
      throw new Error("Cannot save duplicate speaker profile ids");
    }
    if (hasConflictingProfileIdentities(sanitized)) {
      throw new Error("Cannot save conflicting speaker profile identities");
    }
    const sorted = sanitized.sort(compareProfiles);
    const folder = parentFolder(this.path);
    if (folder) {
      await this.adapter.ensureFolder(folder);
    }
    await this.adapter.write(this.path, `${JSON.stringify(sorted, null, 2)}
`);
  }
};

// src/noteArtifacts.ts
var SPEAKER_SIDECAR_THRESHOLD_BYTES = 4096;
function buildSpeakerFrontmatter(speakerMap) {
  return { local_transcription_speakers: speakerMap };
}
function scalarValue(value) {
  if (value === null) {
    return "null";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  return void 0;
}
function yamlKey(key, indent) {
  if (indent === 0 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    return key;
  }
  if (indent >= 4 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    return key;
  }
  return JSON.stringify(key);
}
function appendYaml(lines, key, value, indent) {
  if (value === void 0) {
    return;
  }
  const prefix = " ".repeat(indent);
  const scalar = scalarValue(value);
  if (scalar !== void 0) {
    lines.push(`${prefix}${yamlKey(key, indent)}: ${scalar}`);
    return;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Unsupported frontmatter value for ${key}`);
  }
  const entries = Object.entries(value).filter(([, entryValue]) => entryValue !== void 0);
  if (entries.length === 0) {
    lines.push(`${prefix}${yamlKey(key, indent)}: {}`);
    return;
  }
  lines.push(`${prefix}${yamlKey(key, indent)}:`);
  for (const [entryKey, entryValue] of entries) {
    appendYaml(lines, entryKey, entryValue, indent + 2);
  }
}
function speakerFrontmatterBlock(frontmatter) {
  const lines = ["---"];
  for (const [key, value] of Object.entries(frontmatter)) {
    appendYaml(lines, key, value, 0);
  }
  lines.push("---", "");
  return lines.join("\n");
}
function prependSpeakerFrontmatter(content, frontmatter) {
  return `${speakerFrontmatterBlock(frontmatter)}${content}`;
}
function shouldUseSpeakerSidecar(speakerMap) {
  const encoded = new TextEncoder().encode(JSON.stringify(speakerMap));
  return encoded.length > SPEAKER_SIDECAR_THRESHOLD_BYTES;
}
function speakerSidecarPath(notePath) {
  if (/\.md$/i.test(notePath)) {
    return notePath.replace(/\.md$/i, ".speaker-map.json");
  }
  return `${notePath}.speaker-map.json`;
}

// src/main.ts
function parentFolder2(path) {
  const normalized = (0, import_obsidian.normalizePath)(path);
  const separator = normalized.lastIndexOf("/");
  if (separator <= 0) {
    return void 0;
  }
  return normalized.slice(0, separator);
}
var ObsidianVaultAdapter = class {
  constructor(app) {
    this.app = app;
  }
  async read(path) {
    const file = this.app.vault.getAbstractFileByPath((0, import_obsidian.normalizePath)(path));
    if (!(file instanceof import_obsidian.TFile)) {
      return null;
    }
    return this.app.vault.read(file);
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
      const existing = this.app.vault.getAbstractFileByPath(current);
      if (existing === null) {
        await this.app.vault.createFolder(current);
        continue;
      }
      if (existing instanceof import_obsidian.TFolder) {
        continue;
      }
      throw new Error(`Cannot create folder because a file exists at ${current}`);
    }
  }
  async write(path, content) {
    const normalized = (0, import_obsidian.normalizePath)(path);
    const folder = parentFolder2(normalized);
    if (folder) {
      await this.ensureFolder(folder);
    }
    const file = this.app.vault.getAbstractFileByPath(normalized);
    if (file instanceof import_obsidian.TFile) {
      await this.app.vault.modify(file, content);
      return;
    }
    if (file instanceof import_obsidian.TFolder) {
      throw new Error(`Cannot write file because a folder exists at ${normalized}`);
    }
    await this.app.vault.create(normalized, content);
  }
};
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
var StatusModal = class extends import_obsidian.Modal {
  constructor(app, status) {
    super(app);
    this.status = status;
  }
  statusEl;
  onOpen() {
    this.contentEl.empty();
    this.contentEl.createEl("h2", { text: "local-transcription" });
    this.statusEl = this.contentEl.createEl("pre", {
      cls: "local-transcription-status",
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
var LocalTranscriptionPlugin = class extends import_obsidian.Plugin {
  pluginSettings;
  recorder = null;
  chunks = [];
  statusModal = null;
  async onload() {
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
      name: "local-transcription: List Speakers",
      callback: () => this.listSpeakers()
    });
    this.addCommand({
      id: "local-transcription-refresh-voiceprint-speakers",
      name: "local-transcription: Check Voiceprint Speakers",
      callback: () => this.checkVoiceprintSpeakers()
    });
    this.addRibbonIcon("mic", "local-transcription", () => this.pickAndTranscribeFile());
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
  speakerStore() {
    return new SpeakerStore(new ObsidianVaultAdapter(this.app), this.pluginSettings.speakerProfilesPath);
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
  async listSpeakers() {
    try {
      const profiles = await this.speakerStore().load();
      new import_obsidian.Notice(
        profiles.length ? profiles.map((profile) => profile.displayName).join(", ") : "No local-transcription speaker profiles yet."
      );
    } catch (error) {
      new import_obsidian.Notice(`Could not load local-transcription speakers: ${errorMessage(error)}`);
    }
  }
  async checkVoiceprintSpeakers() {
    try {
      const speakers = await this.client().listVoiceprintSpeakers();
      new import_obsidian.Notice(`Gateway voiceprint speakers: ${speakers.speakers.length}`);
    } catch (error) {
      new import_obsidian.Notice(`Could not check gateway voiceprint speakers: ${errorMessage(error)}`);
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
    const now = /* @__PURE__ */ new Date();
    const date = now.toISOString().slice(0, 10);
    const datetime = now.toISOString().replace("T", " ").slice(0, 19).replace(/:/g, "-");
    const variables = { audioFile: audioPath, transcription: finalText, title, date, datetime };
    const filename = safeNoteFileName(expandTemplate(this.pluginSettings.noteFilenameTemplate, variables));
    const notePath = await this.availablePath((0, import_obsidian.normalizePath)(`${this.pluginSettings.transcriptSavePath}/${filename}.md`));
    const rawAsrPath = await this.availablePath(notePath.replace(/\.md$/i, ".raw-asr.json"));
    const rawAsrContent = `${JSON.stringify(result, null, 2)}
`;
    const speakerMapContent = `${JSON.stringify(speakerMap, null, 2)}
`;
    const speakerMapSidecarPath = shouldUseSpeakerSidecar(speakerMap) ? await this.availablePath(speakerSidecarPath(notePath)) : void 0;
    const frontmatter = speakerMapSidecarPath ? { local_transcription_speaker_map: speakerMapSidecarPath } : buildSpeakerFrontmatter(speakerMap);
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
  async ensureFolder(path) {
    await new ObsidianVaultAdapter(this.app).ensureFolder(path);
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
var LocalTranscriptionSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "local-transcription" });
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
