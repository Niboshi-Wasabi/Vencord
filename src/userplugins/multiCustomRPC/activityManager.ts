/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import { Activity } from "@vencord/discord-types";
import { FluxDispatcher } from "@webpack/common";

import { buildActivity } from "./activity";
import {
    analyzeProfiles,
    cloneProfile,
    publishContentKey,
    settings,
} from "./settings";
import { profileIdFromSocketId, RpcProfile, socketIdForProfile } from "./types";

const logger = new Logger("MultiCustomRPC");

type ErrorListener = () => void;

let running = false;
let epoch = 0;
/** Serialize publishes so Discord presence updates are not raced. */
let publishQueue: Promise<void> = Promise.resolve();
const revisions = new Map<string, number>();
const ownedSockets = new Set<string>();
const lastPublishedContent = new Map<string, string>();
/** Fingerprint of which profile ids are currently intended to be live. */
let lastEnabledFingerprint = "";
const runtimeErrors = new Map<string, string>();
const errorListeners = new Set<ErrorListener>();

function enabledFingerprint(profiles: RpcProfile[]): string {
    return profiles.filter(p => p.enabled).map(p => p.id).sort().join("\0");
}

function bumpRevision(profileId: string): number {
    const next = (revisions.get(profileId) ?? 0) + 1;
    revisions.set(profileId, next);
    return next;
}

function invalidateRevision(profileId: string) {
    bumpRevision(profileId);
}

function notifyErrors() {
    for (const listener of errorListeners) listener();
}

function setRuntimeError(profileId: string, message: string | null) {
    if (message) runtimeErrors.set(profileId, message);
    else runtimeErrors.delete(profileId);
    notifyErrors();
}

export function getRuntimeErrors(): Record<string, string> {
    return Object.fromEntries(runtimeErrors);
}

export function subscribeRuntimeErrors(listener: ErrorListener): () => void {
    errorListeners.add(listener);
    return () => errorListeners.delete(listener);
}

function dispatchActivity(socketId: string, activity: Activity | null) {
    FluxDispatcher.dispatch({
        type: "LOCAL_ACTIVITY_UPDATE",
        socketId,
        activity,
    });
}

/** Synchronous null dispatch for one owned socket. Does not await image work. */
export function removeActivity(profileId: string) {
    const socketId = socketIdForProfile(profileId);
    invalidateRevision(profileId);
    lastPublishedContent.delete(profileId);
    setRuntimeError(profileId, null);
    ownedSockets.add(socketId);
    dispatchActivity(socketId, null);
}

function removeSocket(socketId: string) {
    ownedSockets.add(socketId);
    dispatchActivity(socketId, null);
}

function clearAllOwnedSockets() {
    for (const socketId of [...ownedSockets]) {
        dispatchActivity(socketId, null);
    }
}

function isStillDesired(
    profileId: string,
    expectedEpoch: number,
    expectedRevision: number,
    enablePresence: boolean,
): boolean {
    if (!running) return false;
    if (epoch !== expectedEpoch) return false;
    if (revisions.get(profileId) !== expectedRevision) return false;
    if (!enablePresence || !settings.store.enablePresence) return false;

    const analysis = analyzeProfiles();
    if (!analysis.schemaOk) return false;

    const profile = analysis.publishable.find(p => p.id === profileId);
    return Boolean(profile?.enabled);
}

async function publishProfile(
    profile: RpcProfile,
    expectedEpoch: number,
    expectedRevision: number,
) {
    const socketId = socketIdForProfile(profile.id);
    ownedSockets.add(socketId);

    const { enablePresence } = settings.store;

    try {
        const activity = await buildActivity(profile);

        if (!isStillDesired(profile.id, expectedEpoch, expectedRevision, enablePresence)) {
            return;
        }

        if (!activity) {
            setRuntimeError(profile.id, "Activity could not be built (missing application name?).");
            dispatchActivity(socketId, null);
            lastPublishedContent.delete(profile.id);
            return;
        }

        dispatchActivity(socketId, activity);
        lastPublishedContent.set(profile.id, publishContentKey(profile));
        setRuntimeError(profile.id, null);
    } catch (err) {
        logger.error("Failed to publish profile", profile.id, err);

        if (!isStillDesired(profile.id, expectedEpoch, expectedRevision, enablePresence)) {
            return;
        }

        setRuntimeError(profile.id, err instanceof Error ? err.message : String(err));
        dispatchActivity(socketId, null);
        lastPublishedContent.delete(profile.id);
    }
}

/**
 * Diff desired vs running state and update only what changed.
 * Safe to call from settings listeners and CONNECTION_OPEN.
 * Pass `force` on reconnect so enabled profiles are re-sent even when content is unchanged.
 */
export function reconcileProfiles(options?: { force?: boolean; }) {
    if (!running) return;

    if (options?.force) {
        lastPublishedContent.clear();
    }

    const analysis = analyzeProfiles();
    const desiredIds = new Set<string>();

    if (!analysis.schemaOk || !settings.store.enablePresence) {
        // Invalidate in-flight publishes, then synchronously clear every owned socket.
        // 進行中の公開を無効化し、所有 socket を同期的に全解除する
        epoch++;
        revisions.clear();
        clearAllOwnedSockets();
        lastPublishedContent.clear();
        // Reset so the next enable treats the set as changed and republishes.
        // 次回有効化時に集合変化として再公開させる
        lastEnabledFingerprint = "";
        return;
    }

    const enabledNow = enabledFingerprint(analysis.publishable);
    // When the enabled set changes, re-send survivors. Discord collapses multiple PLAYING
    // activities to one; skipping republish after a disable can leave presence empty.
    // 有効集合が変わったら再送する。PLAYING 畳み込み後に空になるのを防ぐ。
    const enabledSetChanged = enabledNow !== lastEnabledFingerprint;
    lastEnabledFingerprint = enabledNow;
    if (enabledSetChanged) {
        lastPublishedContent.clear();
    }

    const tasks: Promise<void>[] = [];

    for (const profile of analysis.publishable) {
        desiredIds.add(profile.id);
        const socketId = socketIdForProfile(profile.id);
        ownedSockets.add(socketId);

        if (!profile.enabled) {
            // Only clear when we previously published; avoid null-spamming every reconcile.
            // After an enabled-set change lastPublished was cleared, so also clear owned sockets
            // that may still be live from the previous set.
            if (lastPublishedContent.has(profile.id) || (enabledSetChanged && ownedSockets.has(socketId))) {
                removeActivity(profile.id);
            }
            continue;
        }

        const contentKey = publishContentKey(profile);
        if (!enabledSetChanged && lastPublishedContent.get(profile.id) === contentKey) {
            continue;
        }

        const revision = bumpRevision(profile.id);
        const snapshot = cloneProfile(profile);
        // Queue serially: each publish awaits the previous (including asset fetch).
        const run = () => publishProfile(snapshot, epoch, revision);
        publishQueue = publishQueue.then(run, run);
        tasks.push(publishQueue);
    }

    // Remove sockets for profiles that disappeared or are no longer publishable
    for (const id of [...lastPublishedContent.keys()]) {
        if (!desiredIds.has(id)) {
            removeActivity(id);
        }
    }

    // Clear owned sockets whose profile id is gone from settings entirely
    const allIds = new Set(analysis.profiles.map(p => p.id).filter(Boolean));
    for (const socketId of [...ownedSockets]) {
        const id = profileIdFromSocketId(socketId);
        if (id == null) continue;
        if (!allIds.has(id) && !desiredIds.has(id)) {
            removeSocket(socketId);
            lastPublishedContent.delete(id);
            revisions.delete(id);
        }
    }

    void Promise.allSettled(tasks);
}

export function startManager() {
    if (running) {
        reconcileProfiles();
        return;
    }

    running = true;
    epoch++;
    revisions.clear();
    lastPublishedContent.clear();
    lastEnabledFingerprint = "";
    runtimeErrors.clear();
    notifyErrors();

    // Clear previously owned sockets (known from settings + prior run)
    const analysis = analyzeProfiles();
    for (const profile of analysis.profiles) {
        if (profile.id) ownedSockets.add(socketIdForProfile(profile.id));
    }
    clearAllOwnedSockets();

    reconcileProfiles();
}

/**
 * Synchronous stop: invalidate epoch, clear owned sockets, do not await image work.
 */
export function stopManager() {
    running = false;
    epoch++;
    revisions.clear();
    lastPublishedContent.clear();
    lastEnabledFingerprint = "";
    runtimeErrors.clear();
    notifyErrors();
    clearAllOwnedSockets();
    ownedSockets.clear();
}

export function scheduleReconcileFromFlux() {
    // Avoid re-entrant dispatch during CONNECTION_OPEN handlers.
    FluxDispatcher.wait(() => {
        if (running) reconcileProfiles({ force: true });
    });
}
