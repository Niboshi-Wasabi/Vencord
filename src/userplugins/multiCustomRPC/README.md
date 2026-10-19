# MultiCustomRPC

Independent userplugin that manages multiple CustomRPC-style Rich Presence profiles, each on its own local activity socket (`MultiCustomRPC:<profileId>`).

## Status / PoC Gate

Design doc: `docs/multi-custom-rpc-design.md`.

**Discord live PoC (Phase 0 Gate) has not been verified in this implementation pass.** Simultaneous display of two sockets on another user's profile, aggregation by app ID/type, and reload residual behavior must still be confirmed in a real Discord session. Do not treat multi-display as guaranteed.

## Based on

Activity field mapping and validation rules are ported from bundled `src/plugins/customRPC` at Vencord commit `32c90633` (package `1.15.11`), with these intentional differences:

- Profile snapshot builder (no direct `settings.store` coupling in `buildActivity`)
- Button label/URL arrays built from validated pairs (no independent `.filter` skew)
- Synchronous socket cleanup on disable/delete/stop (does not await asset resolution)
- Epoch + per-profile revision guards against stale async publishes
- Management name + per-profile enabled flag
- Timestamp Mode UI labels match CustomRPC (including "Since discord open"); stamp is still generation time

When updating from upstream CustomRPC, re-compare `createActivity` / `RpcSettings` validators with `activity.ts` and `settings.ts`.

## Usage

1. Build/inject Vencord with this tree under `src/userplugins/multiCustomRPC`.
2. Enable **MultiCustomRPC** in plugin settings (leave bundled **CustomRPC** off unless you intentionally want both).
3. Turn on Discord **Activity Sharing** if prompted.
4. Add profiles via **+ Add RPC**, or **Import from CustomRPC** to snapshot the bundled CustomRPC settings into a new disabled profile (non-destructive; re-import adds another profile).
5. In the Add/Edit modal, the live **Preview** uses the activity builder only (does not publish).
6. Enable individual profiles and the master **Enable Presence** switch.
7. Confirm buttons on your own profile (same unhide patch as CustomRPC) and/or from another account.

## Constraints (do not over-claim)

- Display count, order, and priority are Discord-side and unverified here.
- Same Application ID / type may collapse; try distinct app IDs if needed.
- Import from CustomRPC is a manual non-destructive copy only (no auto-migration, no forced mutual exclusion, no generic file Import/Export).
- Schema version is `1`. Unknown higher versions stop publishing and keep raw data.
- Corrupt or duplicate-id rows are not published and are not auto-deleted.

## Settings model

| Key | Role |
| --- | --- |
| `enablePresence` | Master publish switch |
| `profiles` | `RpcProfile[]` (`OptionType.CUSTOM`) |
| `schemaVersion` | Private setting, currently `1` |

## Manual test checklist

- [ ] Two enabled profiles with real app IDs appear for another user; remove one socket only.
- [ ] Duplicate creates new id, name suffix `コピー`, `enabled: false`.
- [ ] Save/Cancel: Cancel does not change settings or presence.
- [ ] Disable profile / master OFF / plugin stop clears only `MultiCustomRPC:*` sockets.
- [ ] Edit during image resolve / stop during resolve does not resurrect removed activities.
- [ ] `CONNECTION_OPEN` republishes enabled profiles without duplicates.
- [ ] Restart Discord: ids, names, enabled, fields, custom ms timestamps persist.
- [ ] Coexistence with CustomRPC / MusicRichPresence / Spotify / games recorded (expected constraints noted).
