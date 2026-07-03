#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
/**
 * Boot an isolated, single-user ad4m-executor for local development, so the
 * apps can run the AD4M storage backend without touching any other executor on
 * the machine (its own data dir + ports + admin credential).
 *
 * Because the executor runs single-user, the `--admin-credential` doubles as
 * the RPC token the browser Ad4mClient authenticates with — wire the same
 * value into the apps as `VITE_AD4M_TOKEN`, and `VITE_AD4M_URL=http://HOST:PORT`.
 *
 * Usage:
 *   node scripts/ad4m-dev-executor.mjs           # boot + supervise (stays up)
 *   node scripts/ad4m-dev-executor.mjs --smoke   # boot, verify, tear down, exit
 *
 * Env (all optional):
 *   AD4M_DEV_PORT=12100  AD4M_DEV_HC_ADMIN_PORT=12101  AD4M_DEV_HC_APP_PORT=12102
 *   AD4M_DEV_DATA=~/.ad4m-harvest-dev   AD4M_DEV_TOKEN=harvest-dev
 *   AD4M_DEV_PASSPHRASE=harvest-dev-pass  AD4M_EXECUTOR=ad4m-executor
 *   AD4M_DEV_CONNECT_HOLOCHAIN=false      AD4M_DEV_TIMEOUT=180
 */

import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { Ad4mClient } from "@coasys/ad4m";

const PORT = Number(process.env.AD4M_DEV_PORT ?? 12100);
const HC_ADMIN = Number(process.env.AD4M_DEV_HC_ADMIN_PORT ?? 12101);
const HC_APP = Number(process.env.AD4M_DEV_HC_APP_PORT ?? 12102);
const DATA = process.env.AD4M_DEV_DATA ?? join(homedir(), ".ad4m-harvest-dev");
const TOKEN = process.env.AD4M_DEV_TOKEN ?? "harvest-dev";
const PASSPHRASE = process.env.AD4M_DEV_PASSPHRASE ?? "harvest-dev-pass";
const BINARY = process.env.AD4M_EXECUTOR ?? "ad4m-executor";
const CONNECT_HC = (process.env.AD4M_DEV_CONNECT_HOLOCHAIN ?? "false") === "true";
const TIMEOUT_S = Number(process.env.AD4M_DEV_TIMEOUT ?? 180);
const SMOKE = process.argv.includes("--smoke");
const BASE_URL = `http://127.0.0.1:${PORT}`;

const log = (...a) => console.log("[ad4m-dev]", ...a);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function makeBootstrapSeed() {
  return {
    trustedAgents: [],
    knownLinkLanguages: [],
    directMessageLanguage: "",
    agentLanguage: "",
    perspectiveLanguage: "",
    neighbourhoodLanguage: "",
    languageLanguageBundle: "",
  };
}

function tryConnect(port) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ port, host: "127.0.0.1" }, () => {
      socket.end();
      resolve();
    });
    socket.once("error", reject);
  });
}

async function initDataDir(seedPath) {
  if (existsSync(join(DATA, "ad4m"))) {
    log(`data dir already initialised: ${DATA}`);
    return;
  }
  log(`initialising data dir: ${DATA}`);
  await new Promise((resolve, reject) => {
    const child = spawn(
      BINARY,
      ["init", "--data-path", DATA, "--network-bootstrap-seed", seedPath],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`init failed (${code}): ${out.slice(-800)}`)),
    );
    child.on("error", reject);
  });
}

function runExecutor(seedPath) {
  const args = [
    "run",
    "--app-data-path", DATA,
    "--network-bootstrap-seed", seedPath,
    "--port", String(PORT),
    "--hc-admin-port", String(HC_ADMIN),
    "--hc-app-port", String(HC_APP),
    "--language-language-only", "false",
    "--connect-holochain", String(CONNECT_HC),
    "--admin-credential", TOKEN,
    "--localhost", "true",
    "--hc-use-bootstrap", "false",
    "--hc-use-mdns", "false",
    "--hc-use-proxy", "false",
    "--run-dapp-server", "false",
  ];
  log(`starting executor on ${PORT} (holochain=${CONNECT_HC})`);
  const child = spawn(BINARY, args, { stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (d) => process.stdout.write(`[exec] ${d}`));
  child.stderr.on("data", (d) => process.stderr.write(`[exec] ${d}`));
  return child;
}

async function waitForListening(child) {
  const deadline = Date.now() + TIMEOUT_S * 1000;
  let exited = null;
  child.once("exit", (code, sig) => (exited = { code, sig }));
  while (Date.now() < deadline) {
    if (exited) throw new Error(`executor exited early (code=${exited.code}, sig=${exited.sig})`);
    try {
      await tryConnect(PORT);
      return;
    } catch {
      await wait(500);
    }
  }
  throw new Error(`executor not listening on ${PORT} within ${TIMEOUT_S}s`);
}

async function ensureAgent(client) {
  const status = await client.agent.status();
  if (!status.isInitialized) {
    log("generating agent…");
    await client.agent.generate(PASSPHRASE);
  } else if (!status.isUnlocked) {
    log("unlocking agent…");
    await client.agent.unlock(PASSPHRASE, CONNECT_HC);
  }
  const me = await client.agent.me();
  return me.did;
}

async function main() {
  if (!existsSync(DATA)) mkdirSync(DATA, { recursive: true });
  const seedPath = join(DATA, "bootstrap.json");
  writeFileSync(seedPath, JSON.stringify(makeBootstrapSeed()));

  await initDataDir(seedPath);
  const child = runExecutor(seedPath);
  await waitForListening(child);
  log("executor is listening; connecting client…");

  const client = new Ad4mClient(BASE_URL, TOKEN, true);
  const did = await ensureAgent(client);
  log(`agent ready: ${did}`);

  // Smoke: prove local-perspective CRUD works end to end.
  const all = await client.perspective.all();
  log(`perspectives: ${all.length} [${all.map((p) => p.name).join(", ")}]`);

  const dispose = async () => {
    try {
      await Promise.race([client.runtime.quit(), wait(2000)]);
    } catch { /* ignore */ }
    if (!child.killed) child.kill("SIGTERM");
  };

  if (SMOKE) {
    log("SMOKE OK — tearing down");
    await dispose();
    process.exit(0);
  }

  log("");
  log("──────────────────────────────────────────────");
  log(` AD4M dev executor ready`);
  log(`   VITE_HOLOSPHERE_BACKEND=ad4m`);
  log(`   VITE_AD4M_URL=${BASE_URL}`);
  log(`   VITE_AD4M_TOKEN=${TOKEN}`);
  log("──────────────────────────────────────────────");
  log("Supervising — Ctrl-C to stop.");

  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, async () => {
      log(`${sig} — shutting down executor`);
      await dispose();
      process.exit(0);
    });
  }
  // Keep the supervisor alive.
  await new Promise(() => {});
}

main().catch((err) => {
  console.error("[ad4m-dev] FATAL:", err?.message ?? err);
  process.exit(1);
});
