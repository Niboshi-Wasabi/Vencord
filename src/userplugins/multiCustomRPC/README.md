# MultiCustomRPC

Vencord userplugin: multiple CustomRPC-style Rich Presence profiles, each on socket `MultiCustomRPC:<profileId>`.

## Discord limits (important)

Discord's `SelfPresenceStore` keeps **at most one Playing** activity in presence. Enabling several Playing profiles will not show them all. Mix Activity Types (Playing + Watching + Listening + Competing) for simultaneous display. Same `type` + `application_id` + `name` may also collapse via Discord's uniqBy.

## Install

Clone into `src/userplugins/multiCustomRPC`, then `pnpm build` and `pnpm inject`.

See the public repo README for Japanese docs: https://github.com/Niboshi-Wasabi/multiCustomRPC