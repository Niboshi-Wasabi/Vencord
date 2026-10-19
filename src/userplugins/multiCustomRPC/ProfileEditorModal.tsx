/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Divider } from "@components/Divider";
import { Heading } from "@components/Heading";
import { classNameFactory } from "@utils/css";
import { RenderModalProps } from "@vencord/discord-types";
import { ActivityType } from "@vencord/discord-types/enums";
import { Modal, openModal, Select, Text, TextInput, useState } from "@webpack/common";

import {
    cloneProfile,
    isAppIdValid,
    isImageKeyValid,
    isNumberValid,
    isStreamLinkValid,
    isUrlValid,
    maxLength31,
    maxLength128,
    maxLength128Required,
    upsertProfile,
    validateProfile,
} from "./settings";
import { RpcProfile, TimestampMode } from "./types";

const cl = classNameFactory("vc-multiCustomRPC-");

function resolveError(valid: true | string): string | null {
    return valid === true ? null : valid;
}

function parseNumber(value: string): number {
    return value ? parseInt(value, 10) : 0;
}

interface FieldProps {
    label: string;
    value: string;
    disabled?: boolean;
    error?: string | null;
    onChange: (value: string) => void;
}

function Field({ label, value, disabled, error, onChange }: FieldProps) {
    return (
        <div className={cl("field", { disabled })}>
            <Heading tag="h5">{label}</Heading>
            <TextInput
                type="text"
                placeholder="Enter a value"
                value={value}
                onChange={onChange}
                disabled={disabled}
            />
            {error && <Text className={cl("field-error")} variant="text-sm/normal">{error}</Text>}
        </div>
    );
}

export function openProfileEditorModal(initial?: RpcProfile) {
    openModal(modalProps => (
        <ProfileEditorModal initial={initial} modalProps={modalProps} isNew={!initial} />
    ));
}

function ProfileEditorModal({ initial, modalProps, isNew }: {
    initial?: RpcProfile;
    modalProps: RenderModalProps;
    isNew: boolean;
}) {
    const isEdit = !isNew;
    const [draft, setDraft] = useState<RpcProfile>(() =>
        initial ? cloneProfile(initial) : {
            id: crypto.randomUUID(),
            name: "New RPC",
            enabled: false,
            appName: "",
            type: ActivityType.PLAYING,
            timestampMode: TimestampMode.NONE,
        }
    );

    function patch(partial: Partial<RpcProfile>) {
        setDraft(prev => ({ ...prev, ...partial }));
    }

    const validationError = validateProfile({
        ...draft,
        id: draft.id || crypto.randomUUID(),
    });

    // Field layout / labels / validators match bundled CustomRPC RpcSettings.
    // Profile Name is MultiCustomRPC-only (list management; not part of the Activity).
    return (
        <Modal
            {...modalProps}
            size="md"
            title={isEdit ? "Edit RPC Profile" : "Add RPC Profile"}
            subtitle="Changes apply only when you Save. Cancel discards the draft."
            actions={[
                {
                    text: "Cancel",
                    variant: "secondary",
                    onClick: modalProps.onClose,
                },
                {
                    text: "Save",
                    variant: "primary",
                    disabled: validationError != null,
                    onClick: () => {
                        const toSave = cloneProfile(draft);
                        if (!toSave.id) toSave.id = crypto.randomUUID();
                        if (validateProfile(toSave) != null) return;
                        upsertProfile(toSave, initial?.id);
                        modalProps.onClose();
                    },
                },
            ]}
            notice={validationError ? { message: validationError, type: "critical" } : undefined}
        >
            <div className={cl("modal")}>
                <Field
                    label="Profile Name"
                    value={draft.name}
                    onChange={v => patch({ name: v })}
                />

                <div className={cl("field")}>
                    <Heading tag="h5">Activity Type</Heading>
                    <Select
                        placeholder="Select an option"
                        options={[
                            { label: "Playing", value: ActivityType.PLAYING, default: true },
                            { label: "Streaming", value: ActivityType.STREAMING },
                            { label: "Listening", value: ActivityType.LISTENING },
                            { label: "Watching", value: ActivityType.WATCHING },
                            { label: "Competing", value: ActivityType.COMPETING },
                        ]}
                        maxVisibleItems={5}
                        closeOnSelect={true}
                        select={v => patch({ type: v })}
                        isSelected={v => v === draft.type}
                        serialize={v => String(v)}
                    />
                </div>

                <div className={cl("pair")}>
                    <Field
                        label="Application ID"
                        value={draft.appID ?? ""}
                        error={resolveError(isAppIdValid(draft.appID ?? ""))}
                        onChange={v => patch({ appID: v || undefined })}
                    />
                    <Field
                        label="Application Name"
                        value={draft.appName}
                        error={resolveError(maxLength128Required(draft.appName))}
                        onChange={v => patch({ appName: v })}
                    />
                </div>

                <div className={cl("pair")}>
                    <Field
                        label="Detail (line 1)"
                        value={draft.details ?? ""}
                        error={resolveError(maxLength128(draft.details ?? ""))}
                        onChange={v => patch({ details: v || undefined })}
                    />
                    <Field
                        label="Detail URL"
                        value={draft.detailsURL ?? ""}
                        error={resolveError(isUrlValid(draft.detailsURL ?? ""))}
                        onChange={v => patch({ detailsURL: v || undefined })}
                    />
                </div>

                <div className={cl("pair")}>
                    <Field
                        label="State (line 2)"
                        value={draft.state ?? ""}
                        error={resolveError(maxLength128(draft.state ?? ""))}
                        onChange={v => patch({ state: v || undefined })}
                    />
                    <Field
                        label="State URL"
                        value={draft.stateURL ?? ""}
                        error={resolveError(isUrlValid(draft.stateURL ?? ""))}
                        onChange={v => patch({ stateURL: v || undefined })}
                    />
                </div>

                <Field
                    label="Stream Link (Twitch or YouTube, only if activity type is Streaming)"
                    value={draft.streamLink ?? ""}
                    disabled={draft.type !== ActivityType.STREAMING}
                    error={resolveError(isStreamLinkValid(draft.streamLink ?? "", draft.type))}
                    onChange={v => patch({ streamLink: v || undefined })}
                />

                <div className={cl("pair")}>
                    <Field
                        label="Party Size"
                        value={draft.partySize ? String(draft.partySize) : ""}
                        disabled={draft.type !== ActivityType.PLAYING}
                        error={resolveError(isNumberValid(draft.partySize ?? 0))}
                        onChange={v => patch({ partySize: parseNumber(v) || undefined })}
                    />
                    <Field
                        label="Maximum Party Size"
                        value={draft.partyMaxSize ? String(draft.partyMaxSize) : ""}
                        disabled={draft.type !== ActivityType.PLAYING}
                        error={resolveError(isNumberValid(draft.partyMaxSize ?? 0))}
                        onChange={v => patch({ partyMaxSize: parseNumber(v) || undefined })}
                    />
                </div>

                <Divider />

                <div className={cl("pair")}>
                    <Field
                        label="Large Image URL/Key"
                        value={draft.imageBig ?? ""}
                        error={resolveError(isImageKeyValid(draft.imageBig ?? ""))}
                        onChange={v => patch({ imageBig: v || undefined })}
                    />
                    <Field
                        label="Large Image Text"
                        value={draft.imageBigTooltip ?? ""}
                        error={resolveError(maxLength128(draft.imageBigTooltip ?? ""))}
                        onChange={v => patch({ imageBigTooltip: v || undefined })}
                    />
                </div>
                <Field
                    label="Large Image clickable URL"
                    value={draft.imageBigURL ?? ""}
                    error={resolveError(isUrlValid(draft.imageBigURL ?? ""))}
                    onChange={v => patch({ imageBigURL: v || undefined })}
                />

                <div className={cl("pair")}>
                    <Field
                        label="Small Image URL/Key"
                        value={draft.imageSmall ?? ""}
                        error={resolveError(isImageKeyValid(draft.imageSmall ?? ""))}
                        onChange={v => patch({ imageSmall: v || undefined })}
                    />
                    <Field
                        label="Small Image Text"
                        value={draft.imageSmallTooltip ?? ""}
                        error={resolveError(maxLength128(draft.imageSmallTooltip ?? ""))}
                        onChange={v => patch({ imageSmallTooltip: v || undefined })}
                    />
                </div>
                <Field
                    label="Small Image clickable URL"
                    value={draft.imageSmallURL ?? ""}
                    error={resolveError(isUrlValid(draft.imageSmallURL ?? ""))}
                    onChange={v => patch({ imageSmallURL: v || undefined })}
                />

                <Divider />

                <div className={cl("pair")}>
                    <Field
                        label="Button1 Text"
                        value={draft.buttonOneText ?? ""}
                        error={resolveError(maxLength31(draft.buttonOneText ?? ""))}
                        onChange={v => patch({ buttonOneText: v || undefined })}
                    />
                    <Field
                        label="Button1 URL"
                        value={draft.buttonOneURL ?? ""}
                        error={resolveError(isUrlValid(draft.buttonOneURL ?? ""))}
                        onChange={v => patch({ buttonOneURL: v || undefined })}
                    />
                </div>
                <div className={cl("pair")}>
                    <Field
                        label="Button2 Text"
                        value={draft.buttonTwoText ?? ""}
                        error={resolveError(maxLength31(draft.buttonTwoText ?? ""))}
                        onChange={v => patch({ buttonTwoText: v || undefined })}
                    />
                    <Field
                        label="Button2 URL"
                        value={draft.buttonTwoURL ?? ""}
                        error={resolveError(isUrlValid(draft.buttonTwoURL ?? ""))}
                        onChange={v => patch({ buttonTwoURL: v || undefined })}
                    />
                </div>

                <Divider />

                <div className={cl("field")}>
                    <Heading tag="h5">Timestamp Mode</Heading>
                    <Select
                        placeholder="Select an option"
                        options={[
                            { label: "None", value: TimestampMode.NONE, default: true },
                            { label: "Since discord open", value: TimestampMode.NOW },
                            { label: "Same as your current time (not reset after 24h)", value: TimestampMode.TIME },
                            { label: "Custom", value: TimestampMode.CUSTOM },
                        ]}
                        maxVisibleItems={5}
                        closeOnSelect={true}
                        select={v => patch({ timestampMode: v })}
                        isSelected={v => v === draft.timestampMode}
                        serialize={v => String(v)}
                    />
                </div>

                <div className={cl("pair")}>
                    <Field
                        label="Start Timestamp (in milliseconds)"
                        value={draft.startTime ? String(draft.startTime) : ""}
                        disabled={draft.timestampMode !== TimestampMode.CUSTOM}
                        error={draft.timestampMode === TimestampMode.CUSTOM
                            ? resolveError(isNumberValid(draft.startTime ?? 0))
                            : null}
                        onChange={v => patch({ startTime: parseNumber(v) || undefined })}
                    />
                    <Field
                        label="End Timestamp (in milliseconds)"
                        value={draft.endTime ? String(draft.endTime) : ""}
                        disabled={draft.timestampMode !== TimestampMode.CUSTOM}
                        error={draft.timestampMode === TimestampMode.CUSTOM
                            ? resolveError(isNumberValid(draft.endTime ?? 0))
                            : null}
                        onChange={v => patch({ endTime: parseNumber(v) || undefined })}
                    />
                </div>
            </div>
        </Modal>
    );
}
