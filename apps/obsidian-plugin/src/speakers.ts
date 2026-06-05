import type { NormalizedSegment } from "./transcript";

export type SpeakerMapSource = "manual" | "auto_high_confidence" | "suggested";
export type ConfidenceAction = "auto" | "suggest" | "ignore";

export interface SpeakerProfile {
  id: string;
  displayName: string;
  aliases: string[];
  gatewaySpeakerId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MeetingSpeakerMapEntry {
  displayName?: string;
  suggestedDisplayName?: string;
  profileId?: string;
  source: SpeakerMapSource;
  confidence?: number;
  gatewaySpeakerId?: string;
  autoMatched?: boolean;
  mergedInto?: string;
}

export type MeetingSpeakerMap = Record<string, MeetingSpeakerMapEntry>;
export interface MappedSpeakerSegment extends NormalizedSegment {
  originalSpeaker?: string;
}

export interface SpeakerConfidenceOptions {
  autoApplySpeakerConfidence?: number;
  suggestSpeakerConfidence?: number;
}

export const HIGH_CONFIDENCE_THRESHOLD = 0.85;
export const MEDIUM_CONFIDENCE_THRESHOLD = 0.65;

const SPEAKER_MAP_SOURCE_PRIORITY: Record<SpeakerMapSource, number> = {
  suggested: 1,
  auto_high_confidence: 2,
  manual: 3
};

interface SpeakerMatchIdentity {
  displayName: string;
  profileId?: string;
}

export function normalizeSpeakerIdentity(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function validThreshold(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value >= 0 && value <= 1;
}

function resolveConfidenceThresholds(options?: SpeakerConfidenceOptions): {
  autoApplySpeakerConfidence: number;
  suggestSpeakerConfidence: number;
} {
  const autoApplySpeakerConfidence =
    options?.autoApplySpeakerConfidence === undefined || validThreshold(options.autoApplySpeakerConfidence)
      ? options?.autoApplySpeakerConfidence ?? HIGH_CONFIDENCE_THRESHOLD
      : HIGH_CONFIDENCE_THRESHOLD;
  const suggestSpeakerConfidence =
    options?.suggestSpeakerConfidence === undefined || validThreshold(options.suggestSpeakerConfidence)
      ? options?.suggestSpeakerConfidence ?? MEDIUM_CONFIDENCE_THRESHOLD
      : MEDIUM_CONFIDENCE_THRESHOLD;

  if (autoApplySpeakerConfidence < suggestSpeakerConfidence) {
    return {
      autoApplySpeakerConfidence: HIGH_CONFIDENCE_THRESHOLD,
      suggestSpeakerConfidence: MEDIUM_CONFIDENCE_THRESHOLD
    };
  }
  return { autoApplySpeakerConfidence, suggestSpeakerConfidence };
}

export function confidenceAction(confidence: number | undefined, options?: SpeakerConfidenceOptions): ConfidenceAction {
  if (confidence === undefined || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
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

function profileIdentityForMatch(segment: NormalizedSegment, profiles: SpeakerProfile[]): SpeakerMatchIdentity | undefined {
  const speakerId = segment.speakerMatch?.speakerId;
  if (speakerId) {
    const profile = profiles.find((item) => item.gatewaySpeakerId === speakerId);
    if (profile) {
      return {
        displayName: profile.displayName,
        profileId: profile.id
      };
    }
  }

  const displayName = segment.speakerMatch?.displayName;
  if (!displayName) {
    return undefined;
  }
  const normalizedDisplayName = normalizeSpeakerIdentity(displayName);
  if (!normalizedDisplayName) {
    return undefined;
  }
  const profile = profiles.find(
    (item) =>
      normalizeSpeakerIdentity(item.displayName) === normalizedDisplayName ||
      item.aliases.some((alias) => normalizeSpeakerIdentity(alias) === normalizedDisplayName)
  );
  if (profile) {
    return {
      displayName: profile.displayName,
      profileId: profile.id
    };
  }
  return { displayName: displayName.trim() };
}

function originalSpeakerLabel(segment: NormalizedSegment): string | undefined {
  return (segment as MappedSpeakerSegment).originalSpeaker || segment.speaker;
}

function finiteConfidence(confidence: number | undefined): number | undefined {
  return confidence !== undefined && Number.isFinite(confidence) ? confidence : undefined;
}

function shouldReplaceSpeakerMapEntry(
  current: MeetingSpeakerMapEntry | undefined,
  candidate: MeetingSpeakerMapEntry
): boolean {
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
  if (candidateConfidence === undefined) {
    return false;
  }
  if (currentConfidence === undefined) {
    return true;
  }
  return candidateConfidence > currentConfidence;
}

export function buildInitialSpeakerMap(
  segments: NormalizedSegment[],
  profiles: SpeakerProfile[],
  existing: MeetingSpeakerMap = {},
  options?: SpeakerConfidenceOptions
): MeetingSpeakerMap {
  const next: MeetingSpeakerMap = { ...existing };
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
    let candidate: MeetingSpeakerMapEntry | undefined;
    if (action === "auto") {
      candidate = {
        displayName: matchIdentity.displayName,
        ...(matchIdentity.profileId === undefined ? {} : { profileId: matchIdentity.profileId }),
        source: "auto_high_confidence",
        confidence,
        gatewaySpeakerId,
        autoMatched: true
      };
    }
    if (action === "suggest") {
      candidate = {
        suggestedDisplayName: matchIdentity.displayName,
        ...(matchIdentity.profileId === undefined ? {} : { profileId: matchIdentity.profileId }),
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

export function applySpeakerMap(
  segments: NormalizedSegment[],
  speakerMap: MeetingSpeakerMap
): MappedSpeakerSegment[] {
  return segments.map((segment) => {
    const originalSpeaker = originalSpeakerLabel(segment);
    const mapped = originalSpeaker ? speakerMap[originalSpeaker] : undefined;
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

export function mergeSpeakerLabels(
  speakerMap: MeetingSpeakerMap,
  sourceLabel: string,
  targetLabel: string
): MeetingSpeakerMap {
  if (sourceLabel === targetLabel) {
    return speakerMap;
  }
  const target = speakerMap[targetLabel];
  if (!target?.displayName) {
    return speakerMap;
  }
  return {
    ...speakerMap,
    [sourceLabel]: {
      displayName: target.displayName,
      ...(target.profileId === undefined ? {} : { profileId: target.profileId }),
      source: "manual",
      gatewaySpeakerId: target.gatewaySpeakerId,
      mergedInto: targetLabel
    }
  };
}

function randomProfileIdSuffix(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) {
    return uuid;
  }

  const randomValues = globalThis.crypto?.getRandomValues?.(new Uint32Array(2));
  const randomPart = randomValues
    ? Array.from(randomValues, (value) => value.toString(36)).join("-")
    : Math.random().toString(36).slice(2);
  return `${Date.now().toString(36)}-${randomPart}`;
}

export function createSpeakerProfile(displayName: string, gatewaySpeakerId?: string): SpeakerProfile {
  const trimmedDisplayName = displayName.trim();
  if (!trimmedDisplayName) {
    throw new Error("Speaker display name is required");
  }
  const now = new Date().toISOString();
  const slug = trimmedDisplayName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "speaker";
  const id = `vault-speaker-${slug}-${randomProfileIdSuffix()}`;
  return {
    id,
    displayName: trimmedDisplayName,
    aliases: [],
    gatewaySpeakerId,
    createdAt: now,
    updatedAt: now
  };
}
