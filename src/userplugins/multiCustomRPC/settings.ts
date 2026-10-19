/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings, Settings } from "@api/Settings";
import { OptionType } from "@utils/types";
import { ActivityType } from "@vencord/discord-types/enums";

import { ProfileList } from "./ProfileList";
import { CURRENT_SCHEMA_VERSION, RpcActivityType, RpcProfile, TimestampMode } from "./types";

const ACTIVITY_TYPES = new Set<number>([
    ActivityType.PLAYING,
    ActivityType.STREAMING,
    ActivityType.LISTENING,
    ActivityType.WATCHING,
    ActivityType.COMPETING,
]);

const TIMESTAMP_MODES = new Set<number>([
    TimestampMode.NONE,
    TimestampMode.NOW,
    TimestampMode.TIME,
    TimestampMode.CUSTOM,
]);

export const settings = definePluginSettings({
    enablePresence: {
        type: OptionType.BOOLEAN,
        description: "Whether to show the presence",
        default: true,
    },
    profiles: {
        type: OptionType.CUSTOM,
        default: [] as RpcProfile[],
    },
    config: {
        type: OptionType.COMPONENT,
        component: ProfileList,
    },
}).withPrivateSettings<{
    schemaVersion?: number;
}>();

export type FieldError = string;

function makeLengthValidator(maxLength: number, isRequired = false) {
    return (value: string): true | FieldError => {
        if (isRequired && !value) return "This field is required.";
        if (value.length > maxLength) return `Must be not longer than ${maxLength} characters.`;
        return true;
    };
}

export const maxLength128 = makeLengthValidator(128);
export const maxLength128Required = makeLengthValidator(128, true);
export const maxLength31 = makeLengthValidator(31);

/** Same rule as CustomRPC RpcSettings.isAppIdValid. */
export function isAppIdValid(value: string): true | FieldError {
    if (!/^\d{16,21}$/.test(value)) return "Must be a valid Discord ID.";
    return true;
}

/** Same rule as CustomRPC RpcSettings.isStreamLinkValid (type gates the URL pattern). */
export function isStreamLinkValid(value: string, type: RpcActivityType): true | FieldError {
    if (type === ActivityType.STREAMING && !/https?:\/\/(www\.)?(twitch\.tv|youtube\.com)\/\w+/.test(value))
        return "Streaming link must be a valid URL.";
    if (value && value.length > 512) return "Streaming link must be not longer than 512 characters.";
    return true;
}

/** Same rule as CustomRPC RpcSettings.isNumberValid. */
export function isNumberValid(value: number): true | FieldError {
    if (Number.isNaN(value)) return "Must be a number.";
    if (value < 0) return "Must be a positive number.";
    return true;
}

export function isUrlValid(value: string): true | FieldError {
    if (value && !/^https?:\/\/.+/.test(value)) return "Must be a valid URL.";
    return true;
}

export function isImageKeyValid(value: string): true | FieldError {
    if (/https?:\/\/(cdn|media)\.discordapp\.(com|net)\//.test(value))
        return "Don't use a Discord link. Use an Imgur image link instead.";
    if (/https?:\/\/(?!i\.)?imgur\.com\//.test(value))
        return "Imgur link must be a direct link to the image (e.g. https://i.imgur.com/...). Right click the image and click 'Copy image address'";
    if (/https?:\/\/(?!media\.)?tenor\.com\//.test(value))
        return "Tenor link must be a direct link to the image (e.g. https://media.tenor.com/...). Right click the GIF and click 'Copy image address'";
    return true;
}

/** Match CustomRPC: text and URL are independent; neither is required for the other. */
function buttonFieldError(text: string | undefined, url: string | undefined, label: string): FieldError | null {
    if (text) {
        const textOk = maxLength31(text);
        if (textOk !== true) return `${label} text: ${textOk}`;
    }
    if (url) {
        const urlOk = isUrlValid(url);
        if (urlOk !== true) return `${label} URL: ${urlOk}`;
    }
    return null;
}

/**
 * Validates a profile for saving / publishing.
 * Returns null when valid, otherwise the first error message.
 */
export function validateProfile(profile: RpcProfile): FieldError | null {
    if (!profile.name?.trim()) return "Profile name is required.";
    const nameLen = maxLength128(profile.name);
    if (nameLen !== true) return `Profile name: ${nameLen}`;

    const appNameOk = maxLength128Required(profile.appName ?? "");
    if (appNameOk !== true) return `Application Name: ${appNameOk}`;

    if (!ACTIVITY_TYPES.has(profile.type)) return "Invalid activity type.";
    if (!TIMESTAMP_MODES.has(profile.timestampMode)) return "Invalid timestamp mode.";

    const appIdOk = isAppIdValid(profile.appID ?? "");
    if (appIdOk !== true) return `Application ID: ${appIdOk}`;

    for (const [key, label, validator] of [
        ["details", "Detail", maxLength128],
        ["state", "State", maxLength128],
        ["imageBigTooltip", "Large Image Text", maxLength128],
        ["imageSmallTooltip", "Small Image Text", maxLength128],
    ] as const) {
        const value = profile[key] ?? "";
        const ok = validator(value);
        if (ok !== true) return `${label}: ${ok}`;
    }

    for (const [key, label] of [
        ["detailsURL", "Detail URL"],
        ["stateURL", "State URL"],
        ["imageBigURL", "Large Image clickable URL"],
        ["imageSmallURL", "Small Image clickable URL"],
    ] as const) {
        const ok = isUrlValid(profile[key] ?? "");
        if (ok !== true) return `${label}: ${ok}`;
    }

    const streamOk = isStreamLinkValid(profile.streamLink ?? "", profile.type);
    if (streamOk !== true) return streamOk;

    for (const [key, label] of [
        ["imageBig", "Large Image URL/Key"],
        ["imageSmall", "Small Image URL/Key"],
    ] as const) {
        const ok = isImageKeyValid(profile[key] ?? "");
        if (ok !== true) return `${label}: ${ok}`;
    }

    const btn1 = buttonFieldError(profile.buttonOneText, profile.buttonOneURL, "Button1");
    if (btn1) return btn1;
    const btn2 = buttonFieldError(profile.buttonTwoText, profile.buttonTwoURL, "Button2");
    if (btn2) return btn2;

    if (profile.timestampMode === TimestampMode.CUSTOM) {
        const startOk = isNumberValid(profile.startTime ?? 0);
        if (startOk !== true) return `Start Timestamp: ${startOk}`;
        const endOk = isNumberValid(profile.endTime ?? 0);
        if (endOk !== true) return `End Timestamp: ${endOk}`;
    }

    // Same as CustomRPC: individual non-negative numbers; activity builder uses both only when truthy.
    const partySizeOk = isNumberValid(profile.partySize ?? 0);
    if (partySizeOk !== true) return `Party Size: ${partySizeOk}`;
    const partyMaxOk = isNumberValid(profile.partyMaxSize ?? 0);
    if (partyMaxOk !== true) return `Maximum Party Size: ${partyMaxOk}`;

    return null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asOptionalString(value: unknown): string | undefined {
    if (value == null) return undefined;
    if (typeof value === "string") return value;
    return undefined;
}

function asOptionalNumber(value: unknown): number | undefined {
    if (value == null) return undefined;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    return undefined;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
    return typeof value === "boolean" ? value : fallback;
}

/** Coerce unknown JSON into an RpcProfile shape without dropping the row. */
export function coerceProfile(raw: unknown, fallbackId?: string): RpcProfile | null {
    if (!isPlainObject(raw)) return null;

    const type = typeof raw.type === "number" && ACTIVITY_TYPES.has(raw.type)
        ? raw.type as RpcActivityType
        : ActivityType.PLAYING;

    const timestampMode = typeof raw.timestampMode === "number" && TIMESTAMP_MODES.has(raw.timestampMode)
        ? raw.timestampMode as TimestampMode
        : TimestampMode.NONE;

    return {
        id: typeof raw.id === "string" ? raw.id : (fallbackId ?? ""),
        name: typeof raw.name === "string" ? raw.name : "",
        enabled: asBoolean(raw.enabled, false),
        appID: asOptionalString(raw.appID),
        appName: typeof raw.appName === "string" ? raw.appName : "",
        type,
        details: asOptionalString(raw.details),
        detailsURL: asOptionalString(raw.detailsURL),
        state: asOptionalString(raw.state),
        stateURL: asOptionalString(raw.stateURL),
        streamLink: asOptionalString(raw.streamLink),
        timestampMode,
        startTime: asOptionalNumber(raw.startTime),
        endTime: asOptionalNumber(raw.endTime),
        imageBig: asOptionalString(raw.imageBig),
        imageBigTooltip: asOptionalString(raw.imageBigTooltip),
        imageBigURL: asOptionalString(raw.imageBigURL),
        imageSmall: asOptionalString(raw.imageSmall),
        imageSmallTooltip: asOptionalString(raw.imageSmallTooltip),
        imageSmallURL: asOptionalString(raw.imageSmallURL),
        buttonOneText: asOptionalString(raw.buttonOneText),
        buttonOneURL: asOptionalString(raw.buttonOneURL),
        buttonTwoText: asOptionalString(raw.buttonTwoText),
        buttonTwoURL: asOptionalString(raw.buttonTwoURL),
        partySize: asOptionalNumber(raw.partySize),
        partyMaxSize: asOptionalNumber(raw.partyMaxSize),
    };
}

export interface ProfileAnalysis {
    schemaOk: boolean;
    schemaVersion: number;
    /** Plain snapshots of every row (including invalid / non-publishable). */
    profiles: RpcProfile[];
    /** Profiles that may be published when enabled + global ON. */
    publishable: RpcProfile[];
    /** Error keyed by profile id, or `__index_N` when id is missing. */
    errors: Record<string, string>;
}

/** Read schema version without writing. Missing version is treated as current. */
export function getSchemaVersion(): number {
    return settings.store.schemaVersion ?? CURRENT_SCHEMA_VERSION;
}

/** Persist schema version once at plugin start (safe outside React render). */
export function ensureSchemaVersionPersisted() {
    if (settings.store.schemaVersion == null) {
        settings.store.schemaVersion = CURRENT_SCHEMA_VERSION;
    }
}

export function analyzeProfiles(rawProfiles: unknown = settings.store.profiles): ProfileAnalysis {
    const schemaVersion = getSchemaVersion();
    const schemaOk = schemaVersion <= CURRENT_SCHEMA_VERSION;

    const errors: Record<string, string> = {};
    if (!schemaOk) {
        return {
            schemaOk: false,
            schemaVersion,
            profiles: Array.isArray(rawProfiles)
                ? rawProfiles.map((p, i) => coerceProfile(p, `missing-${i}`)!).filter(Boolean)
                : [],
            publishable: [],
            errors: {
                __schema: `Unknown settings schema version ${schemaVersion}. Publishing is stopped; data was not modified.`,
            },
        };
    }

    if (!Array.isArray(rawProfiles)) {
        return {
            schemaOk: true,
            schemaVersion,
            profiles: [],
            publishable: [],
            errors: { __root: "Profiles data is corrupt (not an array). Publishing nothing." },
        };
    }

    const profiles: RpcProfile[] = [];
    const idCounts = new Map<string, number>();

    for (let i = 0; i < rawProfiles.length; i++) {
        const coerced = coerceProfile(rawProfiles[i]);
        if (!coerced) {
            errors[`__index_${i}`] = "Profile row is not a valid object.";
            continue;
        }
        profiles.push(coerced);
        if (coerced.id) idCounts.set(coerced.id, (idCounts.get(coerced.id) ?? 0) + 1);
    }

    const publishable: RpcProfile[] = [];

    for (let i = 0; i < profiles.length; i++) {
        const profile = profiles[i];
        const errorKey = profile.id || `__index_${i}`;

        if (!profile.id) {
            errors[errorKey] = "Missing profile id. Edit and save to repair.";
            continue;
        }
        if ((idCounts.get(profile.id) ?? 0) > 1) {
            errors[errorKey] = "Duplicate profile id. Edit and save to assign a new id, or remove extras.";
            continue;
        }

        const fieldError = validateProfile(profile);
        if (fieldError) {
            errors[errorKey] = fieldError;
            continue;
        }

        publishable.push(cloneProfile(profile));
    }

    return { schemaOk: true, schemaVersion, profiles, publishable, errors };
}

export function cloneProfile(profile: RpcProfile): RpcProfile {
    return JSON.parse(JSON.stringify(profile)) as RpcProfile;
}

export function getProfilesPlain(): RpcProfile[] {
    const raw = settings.store.profiles;
    if (!Array.isArray(raw)) return [];
    return raw.map(p => coerceProfile(p)).filter((p): p is RpcProfile => p != null).map(cloneProfile);
}

/** Replace the entire profiles array (avoids nested draft merge / multi-notify). */
export function setProfiles(nextProfiles: RpcProfile[]) {
    settings.store.profiles = nextProfiles.map(cloneProfile);
}

/**
 * Insert or replace a profile.
 * `previousId` is the id before this save (may be empty when repairing a missing-id row).
 */
export function upsertProfile(profile: RpcProfile, previousId?: string) {
    const next = getProfilesPlain();
    const lookupId = previousId !== undefined ? previousId : profile.id;
    let idx = lookupId ? next.findIndex(p => p.id === lookupId) : -1;
    if (idx < 0 && !lookupId) {
        idx = next.findIndex(p => !p.id);
    }

    const toWrite = cloneProfile(profile);
    if (!toWrite.id) toWrite.id = crypto.randomUUID();

    // Do not share a socket id with another row (duplicate-id repair).
    if (next.some((p, i) => i !== idx && p.id === toWrite.id)) {
        toWrite.id = crypto.randomUUID();
    }

    if (idx >= 0) next[idx] = toWrite;
    else next.push(toWrite);
    setProfiles(next);
}

export function removeProfile(id: string) {
    setProfiles(getProfilesPlain().filter(p => p.id !== id));
}

export function duplicateProfile(id: string) {
    const src = getProfilesPlain().find(p => p.id === id);
    if (!src) return;

    const copy = cloneProfile(src);
    copy.id = crypto.randomUUID();
    copy.name = `${src.name} コピー`;
    copy.enabled = false;
    setProfiles([...getProfilesPlain(), copy]);
}

export type ImportFromCustomRpcResult =
    | { ok: true; profile: RpcProfile }
    | { ok: false; reason: "missing" | "empty" };

/**
 * Non-destructive snapshot of bundled CustomRPC settings into a new MultiCustomRPC profile.
 * Does not modify CustomRPC data. New profile is always disabled to avoid accidental double publish.
 * Re-running creates another profile (no one-shot marker).
 */
export function importFromCustomRpc(): ImportFromCustomRpcResult {
    const raw = Settings.plugins.CustomRPC as Record<string, unknown> | undefined;
    if (!raw || typeof raw !== "object") {
        return { ok: false, reason: "missing" };
    }

    const appName = typeof raw.appName === "string" ? raw.appName.trim() : "";
    if (!appName) {
        return { ok: false, reason: "empty" };
    }

    const profile = coerceProfile({
        id: crypto.randomUUID(),
        name: appName,
        enabled: false,
        appID: raw.appID,
        appName,
        type: raw.type,
        details: raw.details,
        detailsURL: raw.detailsURL,
        state: raw.state,
        stateURL: raw.stateURL,
        streamLink: raw.streamLink,
        timestampMode: raw.timestampMode,
        startTime: raw.startTime,
        endTime: raw.endTime,
        imageBig: raw.imageBig,
        imageBigTooltip: raw.imageBigTooltip,
        imageBigURL: raw.imageBigURL,
        imageSmall: raw.imageSmall,
        imageSmallTooltip: raw.imageSmallTooltip,
        imageSmallURL: raw.imageSmallURL,
        buttonOneText: raw.buttonOneText,
        buttonOneURL: raw.buttonOneURL,
        buttonTwoText: raw.buttonTwoText,
        buttonTwoURL: raw.buttonTwoURL,
        partySize: raw.partySize,
        partyMaxSize: raw.partyMaxSize,
    });

    if (!profile?.id) {
        return { ok: false, reason: "empty" };
    }

    // Save even if field validation fails so the user can edit; Switch stays off until valid.
    // 検証前でも保存し、編集可能にする（有効化は検証通過まで不可）
    upsertProfile(profile);
    return { ok: true, profile: cloneProfile(profile) };
}

export function setProfileEnabled(id: string, enabled: boolean) {
    const next = getProfilesPlain();
    const profile = next.find(p => p.id === id);
    if (!profile) return;
    profile.enabled = enabled;
    setProfiles(next);
}

/** Publish-relevant fingerprint; management `name` alone must not force republish. */
export function publishContentKey(profile: RpcProfile): string {
    const { name: _name, enabled: _enabled, ...rest } = profile;
    return JSON.stringify(rest);
}
