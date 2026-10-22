/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { BaseText } from "@components/BaseText";
import { Button } from "@components/Button";
import { Card } from "@components/Card";
import { Flex } from "@components/Flex";
import { FormSwitch } from "@components/FormSwitch";
import { Margins } from "@components/margins";
import { Paragraph } from "@components/Paragraph";
import { Switch } from "@components/Switch";
import { classNameFactory } from "@utils/css";
import { ActivityType } from "@vencord/discord-types/enums";
import { ConfirmModal, openModal, showToast, Text, useEffect, useState } from "@webpack/common";

import { getRuntimeErrors, subscribeRuntimeErrors } from "./activityManager";
import { openProfileEditorModal } from "./ProfileEditorModal";
import {
    analyzeProfiles,
    duplicateProfile,
    importFromCustomRpc,
    removeProfile,
    setProfileEnabled,
    settings,
} from "./settings";
import { RpcProfile } from "./types";

const cl = classNameFactory("vc-multiCustomRPC-");

function PlayingCollisionWarning({ publishable }: { publishable: RpcProfile[]; }) {
    const playingEnabled = publishable.filter(p => p.enabled && p.type === ActivityType.PLAYING);
    if (playingEnabled.length < 2) return null;

    return (
        <Card variant="warning" className={Margins.top8}>
            <Paragraph>
                {playingEnabled.length} profiles are enabled as Playing. Discord's client keeps only one
                Playing activity (including Cursor / games / other RPC), so the others will not appear
                until you change their type or turn them off.
            </Paragraph>
        </Card>
    );
}

const ACTIVITY_TYPE_LABEL: Record<number, string> = {
    [ActivityType.PLAYING]: "Playing",
    [ActivityType.STREAMING]: "Streaming",
    [ActivityType.LISTENING]: "Listening",
    [ActivityType.WATCHING]: "Watching",
    [ActivityType.COMPETING]: "Competing",
};

function confirmDelete(profile: RpcProfile) {
    openModal(props => (
        <ConfirmModal
            {...props}
            title="Delete RPC profile?"
            subtitle={`Delete "${profile.name || profile.appName || profile.id}"? This cannot be undone.`}
            confirmText="Delete"
            cancelText="Cancel"
            onConfirm={() => removeProfile(profile.id)}
        />
    ));
}

function useRuntimeErrors() {
    const [errors, setErrors] = useState(getRuntimeErrors);
    useEffect(() => subscribeRuntimeErrors(() => setErrors(getRuntimeErrors())), []);
    return errors;
}

export function ProfileList() {
    const { profiles, enablePresence } = settings.use(["profiles", "enablePresence"]);
    const runtimeErrors = useRuntimeErrors();
    const analysis = analyzeProfiles(profiles);

    return (
        <div className={cl("root")}>
            <FormSwitch
                title="Enable Presence"
                description="Whether to show the presence"
                value={enablePresence}
                onChange={v => { settings.store.enablePresence = v; }}
                hideBorder
            />

            {!analysis.schemaOk && (
                <Card variant="danger">
                    <Paragraph className={cl("error")}>{analysis.errors.__schema}</Paragraph>
                </Card>
            )}

            {analysis.errors.__root && (
                <Card variant="danger">
                    <Paragraph className={cl("error")}>{analysis.errors.__root}</Paragraph>
                </Card>
            )}

            <section className={Margins.top8}>
                <BaseText size="md" weight="semibold">Custom RPC Profiles</BaseText>
                <Paragraph className={Margins.top8}>
                    Each enabled profile uses its own socket (<Text variant="text-sm/normal">MultiCustomRPC:&lt;id&gt;</Text>).
                    Discord keeps at most one Playing activity in presence. To show several at once, use different Activity Types
                    (for example Playing + Watching + Listening) and preferably distinct Application IDs.
                    Display order is not guaranteed.
                </Paragraph>

                <PlayingCollisionWarning publishable={analysis.publishable} />

                <Flex flexDirection="column" gap="0.5em" className={Margins.top8}>
                    {analysis.profiles.map((profile, index) => {
                        const errorKey = profile.id || `__index_${index}`;
                        const error = analysis.errors[errorKey] || runtimeErrors[profile.id];
                        const typeLabel = ACTIVITY_TYPE_LABEL[profile.type] ?? "Unknown";

                        return (
                            <Card key={profile.id || `index-${index}`} className={cl("card")}>
                                <Switch
                                    checked={profile.enabled}
                                    disabled={!profile.id || Boolean(analysis.errors[errorKey])}
                                    onChange={checked => {
                                        if (!profile.id) return;
                                        setProfileEnabled(profile.id, checked);
                                    }}
                                />
                                <div className={cl("card-main")}>
                                    <Paragraph size="md" weight="medium">
                                        {profile.name || "(unnamed)"}
                                        {profile.appName ? ` / ${profile.appName}` : ""}
                                    </Paragraph>
                                    <Text className={cl("type")} variant="text-sm/normal">{typeLabel}</Text>
                                    {error && (
                                        <Text className={cl("error")} variant="text-sm/normal">{error}</Text>
                                    )}
                                </div>
                                <div className={cl("card-actions")}>
                                    <Button
                                        variant="secondary"
                                        size="small"
                                        onClick={() => openProfileEditorModal(profile)}
                                    >
                                        Edit
                                    </Button>
                                    <Button
                                        variant="secondary"
                                        size="small"
                                        disabled={!profile.id}
                                        onClick={() => profile.id && duplicateProfile(profile.id)}
                                    >
                                        Duplicate
                                    </Button>
                                    <Button
                                        variant="dangerSecondary"
                                        size="small"
                                        disabled={!profile.id}
                                        onClick={() => profile.id && confirmDelete(profile)}
                                    >
                                        Delete
                                    </Button>
                                </div>
                            </Card>
                        );
                    })}

                    <Flex gap="0.5em" className={cl("add-row")}>
                        <Button onClick={() => openProfileEditorModal()}>
                            + Add RPC
                        </Button>
                        <Button
                            variant="secondary"
                            onClick={() => {
                                const result = importFromCustomRpc();
                                if (!result.ok) {
                                    showToast({
                                        text: result.reason === "missing"
                                            ? "CustomRPC settings were not found."
                                            : "CustomRPC has no Application Name to import. Configure CustomRPC first, or add a profile manually.",
                                        variant: "critical",
                                    });
                                    return;
                                }
                                showToast({
                                    text: `Imported "${result.profile.name}" from CustomRPC (disabled). Turn CustomRPC off before enabling this profile.`,
                                    variant: "success",
                                });
                            }}
                        >
                            Import from CustomRPC
                        </Button>
                    </Flex>
                </Flex>
            </section>
        </div>
    );
}
