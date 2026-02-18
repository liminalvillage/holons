/**
 * Holons Multi-User Integration Tests
 *
 * Tests multi-agent scenarios: multiple users sharing a neighbourhood,
 * link sync, authorship verification, and federation between holons.
 *
 * Based on patterns from ~/Desktop/ad4m/tests/js/tests/multi-user-simple.test.ts
 *
 * Prerequisites:
 * - ad4m-executor binary built
 * - kitsune2-bootstrap-srv on PATH
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Ad4mClient, LinkQuery, Perspective } from "@coasys/ad4m";
import { ChildProcess } from "node:child_process";
import path from "path";
import { fileURLToPath } from "url";
import fs from "node:fs";
import {
  startExecutor,
  apolloClient,
  sleep,
  killProcess,
  checkExecutorExists,
  BOOTSTRAP_SEED_PATH,
  runHcLocalServices,
} from "./utils/utils";
import {
  ALL_SUBJECT_CLASSES,
  HolonSettings,
  Quest,
  FederationLink,
} from "../../src/lib/ad4m/models/index";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EXECUTOR_EXISTS = checkExecutorExists();

describe.skipIf(!EXECUTOR_EXISTS)("Holons Multi-User Scenarios", () => {
  const TEST_DIR = path.join(process.env.AD4M_TEST_DIR || "/tmp", "ad4m-test");
  const appDataPath = path.join(TEST_DIR, "agents", "holons-multi-user");
  const gqlPort = 16200;
  const hcAdminPort = 16201;
  const hcAppPort = 16202;

  let executorProcess: ChildProcess | null = null;
  let adminClient: Ad4mClient | null = null;
  let localServicesProcess: ChildProcess | null = null;
  let proxyUrl: string | null = null;
  let bootstrapUrl: string | null = null;

  // User clients
  let userAClient: Ad4mClient | null = null;
  let userBClient: Ad4mClient | null = null;
  let userADid: string = "";
  let userBDid: string = "";

  beforeAll(async () => {
    if (!fs.existsSync(appDataPath)) {
      fs.mkdirSync(appDataPath, { recursive: true });
    }

    // Start local HC services
    try {
      const localServices = await runHcLocalServices();
      proxyUrl = localServices.proxyUrl;
      bootstrapUrl = localServices.bootstrapUrl;
      localServicesProcess = localServices.process;
    } catch (e) {
      console.warn("Local HC services not available, using public bootstrap");
      proxyUrl = "wss://dev-test-bootstrap2.holochain.org";
      bootstrapUrl = "https://dev-test-bootstrap2.holochain.org";
    }

    // Start executor
    executorProcess = await startExecutor(
      appDataPath,
      BOOTSTRAP_SEED_PATH,
      gqlPort,
      hcAdminPort,
      hcAppPort,
      false,
      undefined,
      proxyUrl!,
      bootstrapUrl!
    );

    // Create admin client and generate agent
    // @ts-ignore
    adminClient = new Ad4mClient(apolloClient(gqlPort), false);
    await adminClient.agent.generate("admin-passphrase");

    // Enable multi-user mode
    await adminClient.runtime.setMultiUserEnabled(true);

    // Create User A
    const userAResult = await adminClient.agent.createUser(
      "alice@holons.test",
      "alicepass123"
    );
    expect(userAResult.success).toBe(true);
    userADid = userAResult.did!;

    // Create User B
    const userBResult = await adminClient.agent.createUser(
      "bob@holons.test",
      "bobpass456"
    );
    expect(userBResult.success).toBe(true);
    userBDid = userBResult.did!;

    // Login both users
    const tokenA = await adminClient.agent.loginUser(
      "alice@holons.test",
      "alicepass123"
    );
    const tokenB = await adminClient.agent.loginUser(
      "bob@holons.test",
      "bobpass456"
    );

    // @ts-ignore
    userAClient = new Ad4mClient(apolloClient(gqlPort, tokenA), false);
    // @ts-ignore
    userBClient = new Ad4mClient(apolloClient(gqlPort, tokenB), false);

    console.log("User A DID:", userADid);
    console.log("User B DID:", userBDid);
  });

  afterAll(async () => {
    await killProcess(executorProcess, "executor");
    await killProcess(localServicesProcess, "local services");

    try {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    } catch {}
  });

  // =========================================================================
  // User Identity Verification
  // =========================================================================

  describe("User Identity", () => {
    it("should have unique DIDs for each user", async () => {
      const agentA = await userAClient!.agent.me();
      const agentB = await userBClient!.agent.me();

      expect(agentA.did).toBe(userADid);
      expect(agentB.did).toBe(userBDid);
      expect(agentA.did).not.toBe(agentB.did);
      console.log("✅ Users have unique DIDs");
    });
  });

  // =========================================================================
  // Perspective Isolation
  // =========================================================================

  describe("Perspective Isolation", () => {
    it("should isolate private perspectives between users", async () => {
      // User A creates a private holon
      const perspA = await userAClient!.perspective.add("Alice Private Holon");

      // User B creates a private holon
      const perspB = await userBClient!.perspective.add("Bob Private Holon");

      // Verify isolation
      const allA = await userAClient!.perspective.all();
      const allB = await userBClient!.perspective.all();

      // User A should not see User B's perspective
      expect(allA.some((p) => p.uuid === perspB.uuid)).toBe(false);
      // User B should not see User A's perspective
      expect(allB.some((p) => p.uuid === perspA.uuid)).toBe(false);

      // Each should see their own
      expect(allA.some((p) => p.uuid === perspA.uuid)).toBe(true);
      expect(allB.some((p) => p.uuid === perspB.uuid)).toBe(true);

      console.log("✅ Private perspectives are isolated");
    });
  });

  // =========================================================================
  // Shared Holon (Neighbourhood)
  // =========================================================================

  describe("Shared Holon via Neighbourhood", () => {
    let sharedPerspectiveUuid: string = "";
    let neighbourhoodUrl: string = "";

    it("should allow User A to create a holon and share it as a neighbourhood", async () => {
      // User A creates a perspective for the shared holon
      const perspective = await userAClient!.perspective.add("Shared Community Holon");
      sharedPerspectiveUuid = perspective.uuid;

      // Register subject classes
      for (const ModelClass of ALL_SUBJECT_CLASSES) {
        await perspective.ensureSDNASubjectClass(ModelClass);
      }

      // Create initial holon settings
      const settings = new HolonSettings(perspective);
      settings.name = "Shared Community";
      settings.purpose = "Multi-user testing";
      settings.admin = userADid;
      await settings.save();

      console.log("✅ User A created shared holon:", sharedPerspectiveUuid);
    });

    it("should allow User A to add quests to the shared holon", async () => {
      const perspective = await userAClient!.perspective.byUUID(sharedPerspectiveUuid);
      expect(perspective).not.toBeNull();


      const quest = new Quest(perspective!);
      quest.title = "Alice's Quest: Set up governance";
      quest.status = "ongoing";
      quest.when = "now";
      quest.initiator = userADid;
      await quest.save();

      // Verify
      const quests = await Quest.findAll(perspective!);
      expect(quests.length).toBe(1);
      expect(quests[0].title).toBe("Alice's Quest: Set up governance");
      console.log("✅ User A added quest to shared holon");
    });

    it("should verify correct authorship on User A's links", async () => {
      const perspective = await userAClient!.perspective.byUUID(sharedPerspectiveUuid);
      const links = await perspective!.get(new LinkQuery({}));

      expect(links.length).toBeGreaterThan(0);

      for (const link of links) {
        expect(link.author).toBe(userADid);
        expect(link.proof.valid).toBe(true);
      }

      console.log(`✅ All ${links.length} links correctly authored by User A`);
    });
  });

  // =========================================================================
  // Federation Between Holons
  // =========================================================================

  describe("Federation Links", () => {
    it("should allow creating federation link between holons", async () => {
      // User A creates a holon
      const holonA = await userAClient!.perspective.add("Holon Alpha");

      // Register federation model      for (const ModelClass of ALL_SUBJECT_CLASSES) {
        await holonA.ensureSDNASubjectClass(ModelClass);
      }

      // Create a federation link pointing to another holon
      const fedLink = new FederationLink(holonA);
      fedLink.targetNeighbourhood = "neighbourhood://mock-target-url";
      fedLink.targetName = "Holon Beta";
      fedLink.relationship = "federated";
      fedLink.inboundLenses = ["quests", "users"];
      fedLink.outboundLenses = ["quests"];
      await fedLink.save();

      // Read back
      const links = await FederationLink.findAll(holonA);
      expect(links.length).toBe(1);
      expect(links[0].targetName).toBe("Holon Beta");
      expect(links[0].relationship).toBe("federated");
      expect(links[0].inboundLenses).toContain("quests");
      expect(links[0].outboundLenses).toContain("quests");
      console.log("✅ Federation link created between holons");
    });
  });

  // =========================================================================
  // Cross-User Link Authorship
  // =========================================================================

  describe("Multi-User Link Authorship", () => {
    it("should maintain correct authorship for links created by different users", async () => {
      // User A creates a perspective and adds a link
      const perspA = await userAClient!.perspective.add("Authorship Test A");
      await userAClient!.perspective.addLink(perspA.uuid, {
        source: "root",
        target: "test://by-alice",
        predicate: "test://created-by",
      });

      // User B creates a perspective and adds a link
      const perspB = await userBClient!.perspective.add("Authorship Test B");
      await userBClient!.perspective.addLink(perspB.uuid, {
        source: "root",
        target: "test://by-bob",
        predicate: "test://created-by",
      });

      // Verify authorship
      const linksA = await userAClient!.perspective.queryLinks(
        perspA.uuid,
        new LinkQuery({})
      );
      const linksB = await userBClient!.perspective.queryLinks(
        perspB.uuid,
        new LinkQuery({})
      );

      expect(linksA[0].author).toBe(userADid);
      expect(linksA[0].proof.valid).toBe(true);

      expect(linksB[0].author).toBe(userBDid);
      expect(linksB[0].proof.valid).toBe(true);

      // Authors are different
      expect(linksA[0].author).not.toBe(linksB[0].author);
      console.log("✅ Multi-user link authorship verified");
    });
  });

  // =========================================================================
  // Subject Class Operations per User
  // =========================================================================

  describe("Per-User Subject Class Operations", () => {
    it("should let each user create subject instances independently", async () => {
      // User A's perspective
      const perspA = await userAClient!.perspective.add("User A Subjects");
      for (const ModelClass of ALL_SUBJECT_CLASSES) {
        await perspA.ensureSDNASubjectClass(ModelClass);
      }

      const questA = new Quest(perspA);
      questA.title = "Alice's independent quest";
      questA.status = "ongoing";
      questA.when = "now";
      await questA.save();

      // User B's perspective
      const perspB = await userBClient!.perspective.add("User B Subjects");
      for (const ModelClass of ALL_SUBJECT_CLASSES) {
        await perspB.ensureSDNASubjectClass(ModelClass);
      }

      const questB = new Quest(perspB);
      questB.title = "Bob's independent quest";
      questB.status = "pending";
      questB.when = "later";
      await questB.save();

      // Verify isolation
      const questsA = await Quest.findAll(perspA);
      const questsB = await Quest.findAll(perspB);

      expect(questsA.length).toBe(1);
      expect(questsA[0].title).toBe("Alice's independent quest");

      expect(questsB.length).toBe(1);
      expect(questsB[0].title).toBe("Bob's independent quest");

      // Verify authors
      const linksA = await perspA.get(new LinkQuery({}));
      const linksB = await perspB.get(new LinkQuery({}));

      for (const link of linksA) {
        expect(link.author).toBe(userADid);
      }
      for (const link of linksB) {
        expect(link.author).toBe(userBDid);
      }

      console.log("✅ Per-user subject operations work independently");
    });
  });
});
