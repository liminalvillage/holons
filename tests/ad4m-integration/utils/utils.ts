/**
 * Test Utilities for AD4M Integration Tests
 *
 * Adapted from ~/Desktop/ad4m/tests/js/utils/utils.ts
 * Provides executor management, Apollo client creation, and helper functions.
 */

import { ChildProcess, exec, ExecException, execSync } from "node:child_process";
import { rmSync, existsSync } from "node:fs";
import { GraphQLWsLink } from "@apollo/client/link/subscriptions/index.js";
import { ApolloClient, InMemoryCache } from "@apollo/client/core/index.js";
import Websocket from "ws";
import { createClient } from "graphql-ws";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Path to the ad4m-executor binary.
 * NOTE: This must be built from the AD4M repo before running tests.
 * Build with: cd ~/Desktop/ad4m && cargo build --release -p ad4m-executor
 *
 * If the binary doesn't exist, tests will fail with a clear error message.
 */
export const AD4M_EXECUTOR_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "ad4m",
  "target",
  "release",
  "ad4m-executor"
);

/**
 * Path to the bootstrap seed file.
 */
export const BOOTSTRAP_SEED_PATH = path.resolve(
  __dirname,
  "..",
  "bootstrapSeed.json"
);

/**
 * Check if the ad4m-executor binary exists
 */
export function checkExecutorExists(): boolean {
  return existsSync(AD4M_EXECUTOR_PATH);
}

/**
 * Assert that the executor binary exists (throws if not)
 */
export function assertExecutorExists(): void {
  if (!checkExecutorExists()) {
    throw new Error(
      `ad4m-executor binary not found at ${AD4M_EXECUTOR_PATH}.\n` +
        `Build it first: cd ~/Desktop/ad4m && cargo build --release -p ad4m-executor`
    );
  }
}

/**
 * Check if a process is running by name
 */
export async function isProcessRunning(processName: string): Promise<boolean> {
  const cmd = (() => {
    switch (process.platform) {
      case "win32":
        return `tasklist`;
      case "darwin":
        return `ps -ax | grep ${processName}`;
      case "linux":
        return `ps -A`;
      default:
        return false;
    }
  })();

  if (!cmd) throw new Error("Invalid OS");

  return new Promise((resolve, reject) => {
    exec(cmd, (err: ExecException | null, stdout: string) => {
      if (err) reject(err);
      resolve(stdout.toLowerCase().indexOf(processName.toLowerCase()) > -1);
    });
  });
}

/**
 * Run local Holochain bootstrap services (kitsune2-bootstrap-srv).
 *
 * Returns URLs for proxy, bootstrap, and relay services, plus the child process.
 */
export async function runHcLocalServices(): Promise<{
  proxyUrl: string | null;
  bootstrapUrl: string | null;
  relayUrl: string | null;
  process: ChildProcess;
}> {
  let servicesProcess = exec(`kitsune2-bootstrap-srv`);

  let proxyUrl: string | null = null;
  let bootstrapUrl: string | null = null;
  let relayUrl: string | null = null;
  let bootstrapPort: string | null = null;
  let relayPort: string | null = null;

  let servicesReady = new Promise<void>((resolve, reject) => {
    const SERVICES_READY_TIMEOUT_MS = 60000;
    let timeoutId: NodeJS.Timeout | null = null;
    let resolved = false;

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    };

    const stdoutHandler = (data: Buffer) => {
      const dataStr = data.toString();
      console.log("Bootstrap server output: ", dataStr);

      if (dataStr.includes("#kitsune2_bootstrap_srv#listening#")) {
        const lines = dataStr.split("\n");
        const portLine = lines.find((line: string) =>
          line.includes("#kitsune2_bootstrap_srv#listening#")
        );
        if (portLine) {
          const parts = portLine.split("#");
          const portPart = parts[3];
          bootstrapPort = portPart.split(":")[1];
          bootstrapUrl = `https://127.0.0.1:${bootstrapPort}`;
          proxyUrl = `wss://127.0.0.1:${bootstrapPort}`;
        }
      }

      if (dataStr.includes("Internal iroh relay server started at")) {
        const match = dataStr.match(
          /Internal iroh relay server started at ([\d.]+:\d+)/
        );
        if (match) {
          const address = match[1];
          relayPort = address.split(":")[1];
          relayUrl = `http://127.0.0.1:${relayPort}`;
        }
      }

      if (bootstrapPort && relayPort && !resolved) {
        resolved = true;
        cleanup();
        resolve();
      }
    };

    servicesProcess.stdout!.on("data", stdoutHandler);
    servicesProcess.stderr!.on("data", (data: Buffer) => {
      console.log("Bootstrap server stderr: ", data.toString());
    });

    timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        cleanup();
        try {
          servicesProcess.kill("SIGKILL");
        } catch {}
        reject(
          new Error(
            `Services startup timeout: bootstrapPort=${bootstrapPort}, relayPort=${relayPort}`
          )
        );
      }
    }, SERVICES_READY_TIMEOUT_MS);
  });

  await servicesReady;
  return { proxyUrl, bootstrapUrl, relayUrl, process: servicesProcess };
}

/**
 * Start an AD4M executor process.
 *
 * Initializes a fresh data directory, runs the executor, and waits for it to
 * start listening on the specified GraphQL port.
 *
 * @param dataPath - Directory for executor data (will be wiped)
 * @param bootstrapSeedPath - Path to bootstrapSeed.json
 * @param gqlPort - GraphQL WebSocket port
 * @param hcAdminPort - Holochain admin port
 * @param hcAppPort - Holochain app port
 * @param languageLanguageOnly - If true, only install the language language
 * @param adminCredential - Optional admin credential
 * @param proxyUrl - WebSocket proxy URL
 * @param bootstrapUrl - Bootstrap URL
 * @param relayUrl - Optional relay URL
 */
export async function startExecutor(
  dataPath: string,
  bootstrapSeedPath: string,
  gqlPort: number,
  hcAdminPort: number,
  hcAppPort: number,
  languageLanguageOnly: boolean = false,
  adminCredential?: string,
  proxyUrl: string = "wss://dev-test-bootstrap2.holochain.org",
  bootstrapUrl: string = "https://dev-test-bootstrap2.holochain.org",
  relayUrl?: string
): Promise<ChildProcess> {
  assertExecutorExists();

  const command = AD4M_EXECUTOR_PATH;

  console.log("Bootstrap seed path:", bootstrapSeedPath);
  console.log("Data path:", dataPath);

  rmSync(dataPath, { recursive: true, force: true });
  execSync(
    `${command} init --data-path ${dataPath} --network-bootstrap-seed ${bootstrapSeedPath}`,
    { cwd: process.cwd() }
  );

  console.log("Starting executor...");
  console.log("Using bootstrap:", bootstrapUrl, "proxy:", proxyUrl);
  if (relayUrl) console.log("Using relay:", relayUrl);

  const execOptions = {
    maxBuffer: 100 * 1024 * 1024, // 100MB
  };

  const relayUrlArg = relayUrl ? `--hc-relay-url ${relayUrl}` : "";

  let executorProcess: ChildProcess;

  const baseArgs = `run --app-data-path ${dataPath} --gql-port ${gqlPort} --hc-admin-port ${hcAdminPort} --hc-app-port ${hcAppPort} --hc-proxy-url ${proxyUrl} --hc-bootstrap-url ${bootstrapUrl} ${relayUrlArg} --hc-use-bootstrap true --hc-use-proxy true --hc-use-local-proxy true --hc-use-mdns true --language-language-only ${languageLanguageOnly} --run-dapp-server false`;

  if (!adminCredential) {
    executorProcess = exec(`${command} ${baseArgs}`, execOptions);
  } else {
    executorProcess = exec(
      `${command} ${baseArgs} --admin-credential ${adminCredential}`,
      execOptions
    );
  }

  let executorReady = new Promise<void>((resolve) => {
    executorProcess!.stdout!.on("data", (data: Buffer) => {
      if (data.toString().includes(`listening on http://127.0.0.1:${gqlPort}`)) {
        resolve();
      }
    });
    executorProcess!.stderr!.on("data", (data: Buffer) => {
      if (data.toString().includes(`listening on http://127.0.0.1:${gqlPort}`)) {
        resolve();
      }
    });
  });

  executorProcess!.stdout!.on("data", (data: Buffer) => {
    console.log(`${data}`);
  });
  executorProcess!.stderr!.on("data", (data: Buffer) => {
    console.log(`${data}`);
  });

  console.log("Waiting for executor to settle...");
  await executorReady;
  return executorProcess;
}

/**
 * Create an Apollo Client connected to an AD4M executor's GraphQL endpoint.
 *
 * @param port - The GraphQL WebSocket port
 * @param token - Optional JWT auth token
 * @returns ApolloClient instance
 */
export function apolloClient(port: number, token?: string): ApolloClient<any> {
  const wsLink = new GraphQLWsLink(
    createClient({
      url: `ws://127.0.0.1:${port}/graphql`,
      webSocketImpl: Websocket,
      connectionParams: () => ({
        headers: {
          authorization: token || "",
        },
      }),
    })
  );

  (wsLink as any).client?.on?.("message", (data: any) => {
    if (data.payload?.errors) {
      console.dir(data.payload.errors, { depth: null });
    }
  });

  return new ApolloClient({
    link: wsLink,
    cache: new InMemoryCache({ resultCaching: false, addTypename: false }),
    defaultOptions: {
      watchQuery: { fetchPolicy: "no-cache" },
      query: { fetchPolicy: "no-cache" },
      mutate: { fetchPolicy: "no-cache" },
    },
  });
}

/**
 * Sleep for a given number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Kill a child process and wait for it to die
 */
export async function killProcess(
  proc: ChildProcess | null,
  name: string = "process"
): Promise<void> {
  if (!proc) return;
  // Destroy stdio streams to release event loop references
  proc.stdout?.destroy();
  proc.stderr?.destroy();
  proc.stdin?.destroy();
  // Try SIGTERM first
  proc.kill('SIGTERM');
  await sleep(2000);
  // Force SIGKILL if still alive
  if (!proc.killed) {
    proc.kill('SIGKILL');
    console.log(`Force-killed ${name}`);
  }
  // Also kill by PID to handle grandchildren (exec() creates shell wrapper)
  if (proc.pid) {
    try {
      process.kill(-proc.pid, 'SIGKILL'); // negative PID = process group
    } catch {}
    try {
      process.kill(proc.pid, 'SIGKILL');
    } catch {}
  }
  // Nuclear option: kill all executor processes by name
  try {
    execSync('pkill -9 -f ad4m-executor 2>/dev/null || true', { stdio: 'ignore' });
    execSync('pkill -9 -f holochain 2>/dev/null || true', { stdio: 'ignore' });
    execSync('pkill -9 -f lair-keystore 2>/dev/null || true', { stdio: 'ignore' });
  } catch {}
  // Unref so node doesn't wait for this process
  proc.unref();
  await sleep(500);
}
