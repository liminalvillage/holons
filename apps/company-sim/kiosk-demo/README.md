<!-- SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Meridian Works in the real kiosk

Seeds the simulated company (`../src/scenario.ts`) into a **private, in-memory
relay** and points a local kiosk at it. Nothing touches the production relays;
stop the relay and the demo is gone.

Every write goes through the core calls the kiosk, bot and MCP use, signed by
the person who would make it: circles founded and members seated by key,
federation links, splits and value equations, one lunation of tasks (with
holograms between circles), contributions such as article views, one mint per
money rail, and later the claims.

## Run it

```sh
pnpm -F @holons/core build && pnpm -F @holons/ai-ui build   # the kiosk runs core from dist/

# 1. the private relay
node apps/company-sim/kiosk-demo/relay.mjs 7787

# 2. seed it (writes seeded.json: holon ids + the demo people's keys)
cd apps/company-sim/kiosk-demo
E=../../../node_modules/.pnpm/node_modules/.bin/esbuild
for f in seed verify claims attest; do
  $E $f.ts --bundle --platform=node --format=cjs \
    --alias:@holons/core=../../../packages/core/src --outfile=dist/$f.cjs
done
node dist/seed.cjs            # ws://127.0.0.1:7787, app MeridianSim
node dist/verify.cjs          # scores, mints, the company cascade, Lena's inbound rights

# 3. the kiosk, on that relay (a throwaway session secret; no dev Telegram user)
cd ../../kiosk
AUTH_JWT_SECRET=$(openssl rand -hex 32) VITE_DEV_TELEGRAM_USER_ID= \
VITE_KIOSK_APP=MeridianSim VITE_KIOSK_RELAYS=ws://127.0.0.1:7787 \
  pnpm exec vite dev --port 5291
```

Open `http://localhost:5291/<holon id>/flows?app=MeridianSim` (ids are in
`seeded.json`). Turn on the Flows tab with the + in the tab bar. To act as
someone, use **Log in → Sign in → Sign in with your key** with that person's
`sk` from `seeded.json`. These are demo keys only.

- `node dist/claims.cjs <circle>` prints each claim in a circle's log with its
  judged status.
- `node dist/attest.cjs <circle> <lead>` is the lead link attesting the claims
  that wait for an admin's word.

## The video

`record.mjs` drives the kiosk and writes a frame list; ffmpeg turns it into
`meridian-kiosk-demo.mp4`. Page loads are cut out, and captions plus a visible
cursor are drawn over the page.

```sh
OUT=/tmp/meridian node record.mjs
ffmpeg -f concat -safe 0 -i /tmp/meridian/frames.txt -vsync vfr \
  -vf "fps=30,format=yuv420p" -c:v libx264 -crf 20 meridian-kiosk-demo.mp4
```

Reseed a fresh relay before each take, so the claims start from zero.
