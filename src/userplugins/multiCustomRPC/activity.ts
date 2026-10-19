/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Activity building ported from src/plugins/customRPC (commit 32c90633).
// Snapshot-based builder; button text/URL arrays filtered independently (same as CustomRPC).

import { isTruthy } from "@utils/guards";
import { Activity } from "@vencord/discord-types";
import { ActivityFlags, ActivityType } from "@vencord/discord-types/enums";
import { ApplicationAssetUtils } from "@webpack/common";

import { BuildActivityContext, RpcProfile, TimestampMode } from "./types";

async function defaultResolveAsset(appID: string, key: string): Promise<string> {
    return (await ApplicationAssetUtils.fetchAssetIds(appID, [key]))[0];
}

export async function resolveAsset(appID: string, key: string, ctx?: BuildActivityContext): Promise<string> {
    const resolver = ctx?.resolveAsset ?? defaultResolveAsset;
    return resolver(appID, key);
}

/**
 * Build a Discord Activity from a profile snapshot.
 * Does not read settings or call the activity manager.
 */
export async function buildActivity(
    profile: RpcProfile,
    ctx: BuildActivityContext = {},
): Promise<Activity | undefined> {
    if (!profile.appName) return;

    const now = ctx.now ?? Date.now;
    const appID = profile.appID || "0";

    const activity: Activity = {
        application_id: appID,
        name: profile.appName,
        type: profile.type ?? ActivityType.PLAYING,
        flags: ActivityFlags.INSTANCE,
    };

    if (profile.details) activity.details = profile.details;
    if (profile.state) activity.state = profile.state;
    if (profile.detailsURL) activity.details_url = profile.detailsURL;
    if (profile.stateURL) activity.state_url = profile.stateURL;

    if (profile.type === ActivityType.STREAMING && profile.streamLink)
        activity.url = profile.streamLink;

    switch (profile.timestampMode) {
        case TimestampMode.NOW:
            // Matches CustomRPC: stamp is taken at Activity generation time, not Discord open.
            activity.timestamps = { start: now() };
            break;
        case TimestampMode.TIME: {
            const d = new Date(now());
            activity.timestamps = {
                start: now() - (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) * 1000,
            };
            break;
        }
        case TimestampMode.CUSTOM: {
            // 0 is unspecified (same as CustomRPC truthy checks).
            const start = profile.startTime || undefined;
            const end = profile.endTime || undefined;
            if (start || end) {
                activity.timestamps = {};
                if (start) activity.timestamps.start = start;
                if (end) activity.timestamps.end = end;
            }
            break;
        }
        case TimestampMode.NONE:
        default:
            break;
    }

    // Same as CustomRPC: publish when button one has text; filter labels/URLs independently.
    if (profile.buttonOneText) {
        activity.buttons = [
            profile.buttonOneText,
            profile.buttonTwoText,
        ].filter(isTruthy);

        activity.metadata = {
            button_urls: [
                profile.buttonOneURL,
                profile.buttonTwoURL,
            ].filter(isTruthy),
        };
    }

    if (profile.imageBig) {
        activity.assets = {
            large_image: await resolveAsset(appID, profile.imageBig, ctx),
            large_text: profile.imageBigTooltip || undefined,
            large_url: profile.imageBigURL || undefined,
        };
    }

    if (profile.imageSmall) {
        activity.assets = {
            ...activity.assets,
            small_image: await resolveAsset(appID, profile.imageSmall, ctx),
            small_text: profile.imageSmallTooltip || undefined,
            small_url: profile.imageSmallURL || undefined,
        };
    }

    if (profile.partySize && profile.partyMaxSize) {
        activity.party = {
            size: [profile.partySize, profile.partyMaxSize],
        };
    }

    for (const k in activity) {
        if (k === "type") continue;
        const v = activity[k as keyof Activity];
        if (!v || (typeof v === "string" && v.length === 0) || (Array.isArray(v) && v.length === 0))
            delete activity[k as keyof Activity];
    }

    return activity;
}
