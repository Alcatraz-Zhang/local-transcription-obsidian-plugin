import { normalizeSpeakerIdentity, type SpeakerProfile } from "./speakers";

export const SPEAKER_PROFILE_PATH = ".local-transcription/speakers.json";

export type SpeakerStoreLoadStatus = "ok" | "missing" | "invalid" | "partial";

export interface SpeakerStoreLoadResult {
  status: SpeakerStoreLoadStatus;
  profiles: SpeakerProfile[];
  error?: string;
  invalidCount?: number;
  warnings?: string[];
}

export interface VaultAdapter {
  read(path: string): Promise<string | null>;
  // Must ensure the full parent path recursively, or provide equivalent behavior.
  ensureFolder(path: string): Promise<void>;
  write(path: string, content: string): Promise<void>;
}

function isNonblankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isIsoTimestampString(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(value).toISOString() === value;
}

function isProfile(value: unknown): value is SpeakerProfile {
  if (!value || typeof value !== "object") {
    return false;
  }
  const item = value as Partial<SpeakerProfile>;
  return Boolean(
    isNonblankString(item.id) &&
      isNonblankString(item.displayName) &&
      Array.isArray(item.aliases) &&
      item.aliases.every(isNonblankString) &&
      (item.gatewaySpeakerId === undefined || isNonblankString(item.gatewaySpeakerId)) &&
      isIsoTimestampString(item.createdAt) &&
      isIsoTimestampString(item.updatedAt)
  );
}

function compareProfiles(a: SpeakerProfile, b: SpeakerProfile): number {
  const byDisplayName = normalizeSpeakerIdentity(a.displayName).localeCompare(normalizeSpeakerIdentity(b.displayName));
  if (byDisplayName !== 0) {
    return byDisplayName;
  }
  return a.id.localeCompare(b.id);
}

function hasDuplicateProfileIds(profiles: SpeakerProfile[]): boolean {
  const seen = new Set<string>();
  for (const profile of profiles) {
    if (seen.has(profile.id)) {
      return true;
    }
    seen.add(profile.id);
  }
  return false;
}

interface SpeakerIdentityIndex {
  ids: Set<string>;
  gatewaySpeakerIds: Set<string>;
  namesAndAliases: Set<string>;
}

type InvalidSpeakerProfileReason =
  | "invalidShape"
  | "duplicateId"
  | "duplicateGatewaySpeakerId"
  | "conflictingAliases"
  | "conflictingDisplayNameOrAlias";

type InvalidSpeakerProfileReasonCounts = Record<InvalidSpeakerProfileReason, number>;

function createSpeakerIdentityIndex(): SpeakerIdentityIndex {
  return {
    ids: new Set(),
    gatewaySpeakerIds: new Set(),
    namesAndAliases: new Set()
  };
}

function normalizedAliases(profile: SpeakerProfile): string[] {
  return profile.aliases.map((alias) => normalizeSpeakerIdentity(alias));
}

function normalizeGatewaySpeakerId(value: string | undefined): string {
  return value?.trim() ?? "";
}

function hasDuplicateAliases(profile: SpeakerProfile): boolean {
  const seen = new Set<string>();
  for (const alias of normalizedAliases(profile)) {
    if (seen.has(alias)) {
      return true;
    }
    seen.add(alias);
  }
  return false;
}

function hasAliasDisplayNameCollision(profile: SpeakerProfile): boolean {
  const displayName = normalizeSpeakerIdentity(profile.displayName);
  return normalizedAliases(profile).some((alias) => alias === displayName);
}

function hasInvalidProfileIdentities(profile: SpeakerProfile): boolean {
  return hasDuplicateAliases(profile) || hasAliasDisplayNameCollision(profile);
}

function conflictsWithExistingIdentity(profile: SpeakerProfile, index: SpeakerIdentityIndex): boolean {
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

function hasDuplicateGatewaySpeakerId(profile: SpeakerProfile, index: SpeakerIdentityIndex): boolean {
  const gatewaySpeakerId = normalizeGatewaySpeakerId(profile.gatewaySpeakerId);
  return Boolean(gatewaySpeakerId && index.gatewaySpeakerIds.has(gatewaySpeakerId));
}

function hasCrossProfileNameOrAliasCollision(profile: SpeakerProfile, index: SpeakerIdentityIndex): boolean {
  const namesAndAliases = [normalizeSpeakerIdentity(profile.displayName), ...normalizedAliases(profile)];
  return namesAndAliases.some((identity) => index.namesAndAliases.has(identity));
}

function addProfileIdentity(profile: SpeakerProfile, index: SpeakerIdentityIndex): void {
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

function hasConflictingProfileIdentities(profiles: SpeakerProfile[]): boolean {
  const index = createSpeakerIdentityIndex();
  for (const profile of profiles) {
    if (hasInvalidProfileIdentities(profile) || conflictsWithExistingIdentity(profile, index)) {
      return true;
    }
    addProfileIdentity(profile, index);
  }
  return false;
}

function sanitizeProfile(profile: SpeakerProfile): SpeakerProfile {
  if (profile.gatewaySpeakerId === undefined) {
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

function createInvalidReasonCounts(): InvalidSpeakerProfileReasonCounts {
  return {
    invalidShape: 0,
    duplicateId: 0,
    duplicateGatewaySpeakerId: 0,
    conflictingAliases: 0,
    conflictingDisplayNameOrAlias: 0
  };
}

function totalInvalidReasonCount(reasonCounts: InvalidSpeakerProfileReasonCounts): number {
  return Object.values(reasonCounts).reduce((total, count) => total + count, 0);
}

function pluralizeProfile(count: number): string {
  return count === 1 ? "profile" : "profiles";
}

function buildInvalidWarnings(reasonCounts: InvalidSpeakerProfileReasonCounts): string[] {
  const warnings: string[] = [];
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

function collectValidProfiles(values: unknown[]): {
  profiles: SpeakerProfile[];
  invalidCount: number;
  warnings: string[];
} {
  const profiles: SpeakerProfile[] = [];
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

function parentFolder(path: string): string | undefined {
  const slash = path.lastIndexOf("/");
  const backslash = path.lastIndexOf("\\");
  const separator = Math.max(slash, backslash);
  if (separator <= 0) {
    return undefined;
  }
  return path.slice(0, separator);
}

export class SpeakerStore {
  constructor(
    private readonly adapter: VaultAdapter,
    private readonly path = SPEAKER_PROFILE_PATH
  ) {}

  /**
   * Sanitized convenience load for read-only display paths. Write flows should
   * use loadEditable() so partial or invalid storage cannot be silently replaced.
   */
  async load(): Promise<SpeakerProfile[]> {
    const result = await this.loadWithStatus();
    return result.profiles;
  }

  async loadEditable(): Promise<SpeakerProfile[]> {
    const result = await this.loadWithStatus();
    if (result.status === "partial" || result.status === "invalid") {
      throw new Error(`Cannot edit speaker profiles because storage status is ${result.status}`);
    }
    return result.profiles;
  }

  async loadWithStatus(): Promise<SpeakerStoreLoadResult> {
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

  async save(profiles: SpeakerProfile[]): Promise<void> {
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
    await this.adapter.write(this.path, `${JSON.stringify(sorted, null, 2)}\n`);
  }
}
