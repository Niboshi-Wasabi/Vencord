/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ActivityType } from "@vencord/discord-types/enums";

/** Current persisted schema. Unknown higher versions block publishing. */
export const CURRENT_SCHEMA_VERSION = 1;

export const enum TimestampMode {
    NONE,
    NOW,
    TIME,
    CUSTOM,
}

export type RpcActivityType =
    | ActivityType.PLAYING
    | ActivityType.STREAMING
    | ActivityType.LISTENING
    | ActivityType.WATCHING
    | ActivityType.COMPETING;

export interface RpcProfile {
    id: string;
    /** Display name in the settings list (not the public Activity name). */
    name: string;
    enabled: boolean;
    appID?: string;
    /** Public Activity name. */
    appName: string;
    type: RpcActivityType;
    details?: string;
    detailsURL?: string;
    state?: string;
    stateURL?: string;
    streamLink?: string;
    timestampMode: TimestampMode;
    /** Milliseconds since Unix epoch. 0 is treated as unspecified (same as CustomRPC). */
    startTime?: number;
    endTime?: number;
    /** Asset key or image source URL. */
    imageBig?: string;
    imageBigTooltip?: string;
    /** Image click destination URL (not the image source). */
    imageBigURL?: string;
    imageSmall?: string;
    imageSmallTooltip?: string;
    imageSmallURL?: string;
    buttonOneText?: string;
    buttonOneURL?: string;
    buttonTwoText?: string;
    buttonTwoURL?: string;
    partySize?: number;
    partyMaxSize?: number;
}

export interface BuildActivityContext {
    now?: () => number;
    resolveAsset?: (appID: string, key: string) => Promise<string>;
}

/** Prefix for all MultiCustomRPC local activity sockets. Keep in sync with cleanup parsers. */
export const SOCKET_ID_PREFIX = "MultiCustomRPC:";

export function socketIdForProfile(profileId: string): string {
    return `${SOCKET_ID_PREFIX}${profileId}`;
}

/** Inverse of socketIdForProfile; returns null when the socket is not ours. */
export function profileIdFromSocketId(socketId: string): string | null {
    if (!socketId.startsWith(SOCKET_ID_PREFIX)) return null;
    return socketId.slice(SOCKET_ID_PREFIX.length) || null;
}
