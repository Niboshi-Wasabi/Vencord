/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { Paragraph } from "@components/Paragraph";
import { classNameFactory } from "@utils/css";
import { useAwaiter } from "@utils/react";
import { findByCodeLazy, findComponentByCodeLazy } from "@webpack";
import { UserStore } from "@webpack/common";

import { buildActivity } from "./activity";
import { publishContentKey, validateProfile } from "./settings";
import { RpcProfile } from "./types";

const cl = classNameFactory("vc-multiCustomRPC-");

// Same webpack finds as bundled CustomRPC preview
const useProfileThemeStyle = findByCodeLazy("profileThemeStyle:", "--profile-gradient-primary-color");
const ActivityView = findComponentByCodeLazy(".party?(0", "USER_PROFILE_ACTIVITY");

interface ActivityPreviewProps {
    profile: RpcProfile | null;
}

/**
 * Read-only Activity preview. Uses buildActivity only — never the publish manager.
 * 公開 manager は呼ばず builder のみ（revision / 公開時刻を変えない）
 */
export function ActivityPreview({ profile }: ActivityPreviewProps) {
    const { profileThemeStyle } = useProfileThemeStyle({});

    const contentKey = profile ? publishContentKey(profile) : "";
    const validationError = profile ? validateProfile(profile) : null;

    const [activity] = useAwaiter(
        async () => {
            if (!profile?.appName) return undefined;
            // Still build when invalid so the user can see partial state; Discord may omit some fields.
            // 不正でもプレビュー用に生成する（公開は validate 側で止まる）
            return buildActivity(profile);
        },
        {
            fallbackValue: undefined,
            deps: [profile?.id, contentKey, profile?.name, profile?.appName],
        }
    );

    return (
        <div className={cl("preview")}>
            {validationError && profile?.appName && (
                <Paragraph className={cl("preview-hint")} size="sm">
                    Validation issues (Save disabled until fixed): {validationError}
                </Paragraph>
            )}
            {profile && !profile.appName && (
                <Paragraph className={cl("preview-hint")} size="sm">
                    Enter an Application Name to see the preview.
                </Paragraph>
            )}
            <div
                className={cl("preview-frame")}
                style={{ width: "284px", ...profileThemeStyle, borderRadius: 8, background: "var(--background-mod-muted)" }}
            >
                <ErrorBoundary noop>
                    {activity && (
                        <ActivityView
                            activity={activity}
                            user={UserStore.getCurrentUser()}
                            currentUser={UserStore.getCurrentUser()}
                        />
                    )}
                </ErrorBoundary>
            </div>
        </div>
    );
}
