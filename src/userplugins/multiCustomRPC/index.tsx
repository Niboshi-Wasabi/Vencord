/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { SettingsStore } from "@api/Settings";
import { getUserSettingLazy } from "@api/UserSettings";
import { BaseText } from "@components/BaseText";
import { Button } from "@components/Button";
import { Card } from "@components/Card";
import { Flex } from "@components/Flex";
import { Link } from "@components/Link";
import { Paragraph } from "@components/Paragraph";
import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";
import { Menu } from "@webpack/common";

import {
    reconcileProfiles,
    scheduleReconcileFromFlux,
    startManager,
    stopManager,
} from "./activityManager";
import { ensureSchemaVersionPersisted, settings } from "./settings";

const PLUGIN_NAME = "MultiCustomRPC";
const logger = new Logger(PLUGIN_NAME);
const ShowCurrentGame = getUserSettingLazy<boolean>("status", "showCurrentGame")!;

function onProfilesOrPresenceChange() {
    reconcileProfiles();
}

function registerSettingsListeners() {
    SettingsStore.addChangeListener(`plugins.${PLUGIN_NAME}.profiles`, onProfilesOrPresenceChange);
    SettingsStore.addChangeListener(`plugins.${PLUGIN_NAME}.enablePresence`, onProfilesOrPresenceChange);
}

function unregisterSettingsListeners() {
    SettingsStore.removeChangeListener(`plugins.${PLUGIN_NAME}.profiles`, onProfilesOrPresenceChange);
    SettingsStore.removeChangeListener(`plugins.${PLUGIN_NAME}.enablePresence`, onProfilesOrPresenceChange);
}

export default definePlugin({
    name: PLUGIN_NAME,
    description: "Multi Custom RPC — manage multiple custom Rich Presence profiles with independent sockets",
    tags: ["Activity", "Customisation"],
    // Keep spaced phrases so Filters search matches "Multi Custom" / "multi custom rpc"
    // スペース付き検索語を入れて「Multi Custom」でも一覧にヒットさせる
    searchTerms: [
        "Multi Custom RPC",
        "multi custom",
        "custom rpc",
        "rich presence",
        "multiple rpc",
        "activity",
    ],
    authors: [{ name: "N Cho-chin", id: 0n }],
    dependencies: ["UserSettingsAPI"],
    requiresRestart: false,
    settings,

    // Same optional UX as CustomRPC: Discord hides own-profile RPC buttons otherwise.
    // CustomRPC と同様、自分のプロフィールでも RPC ボタンを見えるようにする
    patches: [
        {
            find: ".USER_PROFILE_ACTIVITY_BUTTONS),",
            replacement: {
                match: /.getId\(\)===\i.id/,
                replace: "$& && false"
            }
        }
    ],

    toolboxActions() {
        const { enablePresence } = settings.use(["enablePresence"]);

        return (
            <Menu.MenuCheckboxItem
                id="multi-custom-rpc-toggle-toolbox"
                label="Show Multi Custom RPC"
                checked={enablePresence}
                action={() => {
                    settings.store.enablePresence = !enablePresence;
                }}
            />
        );
    },

    start() {
        ensureSchemaVersionPersisted();
        registerSettingsListeners();
        try {
            startManager();
        } catch (err) {
            // 途中失敗時に listener / epoch を残さない
            // On failure, roll back so we do not leave listeners or a half-started manager.
            logger.error("start failed", err);
            try {
                stopManager();
            } catch (stopErr) {
                logger.error("rollback stopManager failed", stopErr);
            }
            unregisterSettingsListeners();
        }
    },

    stop() {
        unregisterSettingsListeners();
        stopManager();
    },

    flux: {
        CONNECTION_OPEN() {
            scheduleReconcileFromFlux();
        },
    },

    settingsAboutComponent: () => {
        const { enablePresence } = settings.use(["enablePresence"]);
        const gameActivityEnabled = ShowCurrentGame.useSetting();

        return (
            <Flex flexDirection="column" gap=".5em">
                {!enablePresence && (
                    <Card variant="warning">
                        <Flex flexDirection="column" gap=".5em" alignItems="flex-start">
                            <BaseText size="md" weight="bold">Multi Custom RPC disabled</BaseText>
                            <Paragraph>
                                The "Enable Presence" setting is off, so no Multi Custom RPC profiles are published.
                                Individual profile toggles are preserved.
                            </Paragraph>
                        </Flex>
                    </Card>
                )}

                {!gameActivityEnabled && (
                    <Card variant="danger">
                        <Flex flexDirection="column" gap=".5em" alignItems="flex-start">
                            <BaseText size="md" weight="bold">Activity Sharing disabled</BaseText>
                            <Paragraph>
                                Activity Sharing isn't enabled, so people won't be able to see your custom rich presence!
                            </Paragraph>
                            <Button
                                variant="overlayPrimary"
                                onClick={() => ShowCurrentGame.updateSetting(true)}
                            >
                                Enable Activity Sharing
                            </Button>
                        </Flex>
                    </Card>
                )}

                <Paragraph>
                    Go to the <Link href="https://discord.com/developers/applications">Discord Developer Portal</Link> to
                    create applications and get application IDs. Upload images in the Rich Presence tab for asset keys,
                    or use direct Imgur/Tenor image links.
                </Paragraph>
                <Paragraph>
                    This plugin is independent from CustomRPC. Use "Import from CustomRPC" in the profile list to copy
                    the current CustomRPC settings into a new disabled profile (CustomRPC data is not modified).
                    Turn CustomRPC off if you do not want duplicate activities.
                    Simultaneous multi-profile display for other users is not guaranteed by Discord; prefer a distinct
                    Application ID per profile if activities collapse together.
                </Paragraph>
                <Paragraph>
                    Timestamp mode labels match CustomRPC. "Since discord open" uses Activity generation time (same as CustomRPC),
                    not Discord's process start. Custom timestamps are stored per profile and are not rewritten on reconnect.
                </Paragraph>
                <Paragraph>
                    Discord normally hides Rich Presence buttons on your own profile. This plugin includes the same
                    workaround as CustomRPC so you can see them; others can see them either way.
                </Paragraph>
            </Flex>
        );
    },
});
