# Holons documentation

**Holons** is a decentralized holonic platform for organizational
governance, resource distribution, and collaborative coordination. It is a
pnpm monorepo: a shared `@holons/core` domain layer plus several UIs (web,
Telegram, text/CLI, AI, MCP) that all read and write the same peer-to-peer
data namespace, so an action means the same thing in every interface. For
build and run instructions, see the [repository root README](../README.md);
the project lives at <https://github.com/HolonicLabs/holons>.

## Documents

| Document | Description |
| --- | --- |
| [architecture.md](./architecture.md) | The monorepo's layered model, what each package owns, and the identity-aware Holosphere data layer (signed events on relays, local store). |
| [nostr-onboarding.md](./nostr-onboarding.md) | Handoff for new contributors: a Nostr primer, how Holons stores data as signed events on relays with a local event-sourced store, the Commons Hub kiosk's data path, repo map, gotchas, first tasks, and a community-relay runbook. |
| [realtime-sync.md](./realtime-sync.md) | How data stays live across UIs and federated holons: relay transport and local store, web initialization, subscriptions, federation messaging, notifications. |
| [USER_GUIDE.md](./USER_GUIDE.md) | End-user guide: identity/keys, joining holons, tasks, calendar, expenses, federation, and troubleshooting. |
| [FEDERATION_COMPONENT.md](./FEDERATION_COMPONENT.md) | The web Federation configuration component: managing federation relationships and per-lens data sharing. |
