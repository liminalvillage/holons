# Flows

Resource projects directly. Money is a detour — you pay a project, it goes to
market for what it actually needed — so Flows lets anyone give the thing
itself: space, tools, seeds, skills, time, at any level (the Pot, a fund, a
project, a person). Each gift is one of the eight forms of capital the
CapitalGame plays with; financial is one stream among eight. `/story` walks
the whole idea, scene by scene, into the screens that do it.

A mobile-first account for everyone under a Pot. It opens on **you**: your
name, what you can take out, and what you can do — claim it, see which funds
it comes through, apply to others. A project, a fund and the Pot open as the
same kind of account, and every row and every bar is a way on to the next.

|                  |                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------- |
| **Claim**        | to a web3 wallet, or — through the fund's OpenCollective — as an expense, by PayPal or by bank transfer |
| **Fund**         | the account's Pot address and its collective's contribute page; a steward links the collective          |
| **Redistribute** | `/h/<holon>/split`: what stays, the rings, who sits on which. Stewards edit; everyone else reads        |
| **Resource**     | give any of the eight capitals; it counts once the recipient's steward receives it, with its proof      |
| **Offer**        | a steward lists what the account offers, each with its terms (when, for whom, how), public to all       |
| **Trace**        | follow an amount from the Pot down to the account, path by path, beside every resource that reached it  |
| **Apply**        | ask a fund for a seat; its stewards approve (which seats you) or decline with a reason                  |

No bank detail or PayPal address is entered here: OpenCollective holds them
and pays. See "The account" in
[`docs/flows-artisan-fork.md`](../../docs/flows-artisan-fork.md).

```
/              Me (signed in) — or the way in: sign in, paste an address, explore
/p/<party>     a person, or a seat nobody has claimed yet
/h/<holon>     a fund, a project, the Pot
/h/<holon>/split   how it divides what reaches it (editable by its stewards)
/a/<0x…>       whoever is paid at an address
/eco           the whole map: every party in a space that slowly turns, each
               line as wide as the share of the Pot it carries
               (?view=diagram: the Pot, its funds, who they pay, as a Sankey)
/rise          the most resourced: ranked by resource base, one block per gift, the top two starred
/story         the storyline, each scene opening onto the live screen
/search?q=     by name, id or address
```

Every address is public and shareable; nothing needs an account to be read.
`?unit=<code>` shows amounts instead of shares once the Pot holds something;
`?up=2` draws one more column of provenance.

## Where the data comes from

The app draws one document: the Pot's **flow graph**, published as a snapshot
on the Pot holon's `flow_graph` lens and loaded in one read (then cached, so
the app opens offline). The snapshot is made by walking the Pot's cascade:

```bash
# dry run: prints what it found, writes nothing
node --env-file=.env scripts/publish-flow-graph.mjs --pot <pot holon>
# publish (the key must be one the Pot holon accepts writes from)
node --env-file=.env scripts/publish-flow-graph.mjs --pot <pot holon> --write
```

or with the MCP tools `flow_graph_publish` / `flow_graph_get`. Publish again
after the split changes; the app says how old the map on screen is.

When a holon's page is opened its own split is read afresh and the diagram
redrawn from it, with a line saying so if the snapshot had drifted. What the
Pot holds, the table it pays from and a seat's collected / collectable /
accruing amounts are read live from the chain and the rights log.

A balance is read live too: the seat in the Pot off the chain, and a right
in each fund above the party that holds money of its own (mints, a linked
collective), judged by that fund's claims log. A collective's balance comes
through `/api/opencollective` (set `OPENCOLLECTIVE_TOKEN` only to raise the
rate limit).

All of the meaning — the graph, how it is stored, the views, what a seat or a
right is worth, the ways out, applications, the split draft — is
`@holons/core/flows`. This app only renders it.

## Run it

```bash
pnpm -F @holons/core build      # the app consumes core's compiled dist
pnpm dev:flows                  # http://localhost:5473
```

Configure in the root `.env` (see `.env.example`): `VITE_FLOWS_POT` (the Pot
holon), `VITE_FLOWS_APP` (namespace; an unconfigured dev run uses
`HolonsDebug`), `VITE_FLOWS_RELAYS`, `VITE_FLOWS_LOGIN`. `?pot=` and `?app=`
override per device and persist. Sign-in uses the same server variables as
the kiosk (`TELEGRAM_OIDC_*`, `AUTH_JWT_SECRET`); `VITE_DEV_TELEGRAM_USER_ID`
signs a dev session in.

In dev only, `?graph=<url>` draws a graph file instead of the published
snapshot — the `--out` of the publish script — which is how the app is looked
at before a Pot has been published:

```
http://localhost:5473/eco?graph=/@fs/abs/path/to/flow-graph.json
```

## Wallets on a phone

Reading works in any browser. Signing in with a wallet, setting the payout
wallet from a wallet and collecting need an injected wallet
(`window.ethereum`), which a phone's ordinary browser does not have: the app
then says to open the page inside the wallet app's own browser, and a payout
address can be pasted instead. There is no WalletConnect yet.

## Verify

`pnpm -F flows typecheck && pnpm -F flows test && pnpm -F flows lint`. The
specs are pure logic (hit-testing a tap on the diagram, the URL grammar,
formatting, the catalogs). For the screen itself, drive a 390×844 touch
viewport with `playwright-core` from a scratch directory, as
`apps/kiosk/.claude/skills/verify/SKILL.md` describes.
