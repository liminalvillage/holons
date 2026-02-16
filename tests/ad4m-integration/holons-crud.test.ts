/**
 * Holons CRUD Integration Tests
 *
 * Tests basic CRUD operations via the HoloSphereAd4mAdapter with a real AD4M executor.
 * Verifies that all subject classes register correctly and data round-trips properly.
 *
 * Prerequisites:
 * - ad4m-executor binary built at ~/Desktop/ad4m/target/release/ad4m-executor
 * - kitsune2-bootstrap-srv on PATH (or use public bootstrap)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Ad4mClient, LinkQuery } from "@coasys/ad4m";
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Skip all tests if executor binary is missing
const EXECUTOR_EXISTS = checkExecutorExists();

describe.skipIf(!EXECUTOR_EXISTS)("Holons CRUD via AD4M Adapter", () => {
  const TEST_DIR = path.join(process.env.AD4M_TEST_DIR || "/tmp", "ad4m-test");
  const appDataPath = path.join(TEST_DIR, "agents", "holons-crud");
  const gqlPort = 16100;
  const hcAdminPort = 16101;
  const hcAppPort = 16102;

  let executorProcess: ChildProcess | null = null;
  let ad4mClient: Ad4mClient | null = null;
  let localServicesProcess: ChildProcess | null = null;
  let proxyUrl: string | null = null;
  let bootstrapUrl: string | null = null;

  // Perspective UUID for our test holon
  let holonPerspectiveUuid: string = "";

  beforeAll(async () => {
    // Create test directory
    if (!fs.existsSync(appDataPath)) {
      fs.mkdirSync(appDataPath, { recursive: true });
    }

    // Start local HC services
    let localServices: Awaited<ReturnType<typeof runHcLocalServices>>;
    try {
      localServices = await runHcLocalServices();
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

    // Create client and generate agent
    // @ts-ignore
    ad4mClient = new Ad4mClient(apolloClient(gqlPort), false);
    await ad4mClient.agent.generate("test-passphrase");

    // Create a perspective for our test holon
    const perspective = await ad4mClient.perspective.add("Test Holon");
    holonPerspectiveUuid = perspective.uuid;
    console.log("Created test holon perspective:", holonPerspectiveUuid);
  });

  afterAll(async () => {
    await killProcess(executorProcess, "executor");
    await killProcess(localServicesProcess, "local services");

    // Clean up test directory
    try {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    } catch {}
  });

  // =========================================================================
  // Subject Class Registration
  // =========================================================================

  describe("Subject Class Registration", () => {
    it("should register HolonSettings SDNA", async () => {
      const perspective = await ad4mClient!.perspective.byUUID(holonPerspectiveUuid);
      expect(perspective).not.toBeNull();

      // Import the model dynamically
      const { HolonSettings } = await import("../../src/lib/ad4m/models/index");
      await perspective!.ensureSDNASubjectClass(HolonSettings);
      console.log("✅ HolonSettings SDNA registered");
    });

    it("should register Quest SDNA", async () => {
      const perspective = await ad4mClient!.perspective.byUUID(holonPerspectiveUuid);
      const { Quest } = await import("../../src/lib/ad4m/models/index");
      await perspective!.ensureSDNASubjectClass(Quest);
      console.log("✅ Quest SDNA registered");
    });

    it("should register HolonMember SDNA", async () => {
      const perspective = await ad4mClient!.perspective.byUUID(holonPerspectiveUuid);
      const { HolonMember } = await import("../../src/lib/ad4m/models/index");
      await perspective!.ensureSDNASubjectClass(HolonMember);
      console.log("✅ HolonMember SDNA registered");
    });

    it("should register all remaining subject classes", async () => {
      const perspective = await ad4mClient!.perspective.byUUID(holonPerspectiveUuid);
      const { ALL_SUBJECT_CLASSES } = await import("../../src/lib/ad4m/models/index");

      for (const ModelClass of ALL_SUBJECT_CLASSES) {
        await perspective!.ensureSDNASubjectClass(ModelClass);
      }
      console.log(`✅ All ${ALL_SUBJECT_CLASSES.length} subject classes registered`);
    });
  });

  // =========================================================================
  // HolonSettings CRUD
  // =========================================================================

  describe("HolonSettings CRUD", () => {
    it("should create holon settings", async () => {
      const perspective = await ad4mClient!.perspective.byUUID(holonPerspectiveUuid);
      const { HolonSettings } = await import("../../src/lib/ad4m/models/index");

      const settings = new HolonSettings(perspective!);
      settings.name = "Test Community";
      settings.purpose = "Integration testing";
      settings.admin = "test-admin";
      settings.version = 1;
      await settings.save();

      console.log("Created settings with base:", settings.baseExpression);
      expect(settings.baseExpression).toBeTruthy();
    });

    it("should read back holon settings", async () => {
      const perspective = await ad4mClient!.perspective.byUUID(holonPerspectiveUuid);
      const { HolonSettings } = await import("../../src/lib/ad4m/models/index");

      const results = await HolonSettings.findAll(perspective!, {}, false);
      expect(results.length).toBeGreaterThanOrEqual(1);

      const settings = results[0];
      expect(settings.name).toBe("Test Community");
      expect(settings.purpose).toBe("Integration testing");
      expect(settings.admin).toBe("test-admin");
      console.log("✅ Settings read back correctly");
    });

    it("should update holon settings", async () => {
      const perspective = await ad4mClient!.perspective.byUUID(holonPerspectiveUuid);
      const { HolonSettings } = await import("../../src/lib/ad4m/models/index");

      const results = await HolonSettings.findAll(perspective!, {}, false);
      const settings = results[0];
      settings.name = "Updated Community";
      settings.description = "Now with a description";
      await settings.update();

      // Read back to verify
      const updated = await HolonSettings.findAll(perspective!, {}, false);
      expect(updated[0].name).toBe("Updated Community");
      expect(updated[0].description).toBe("Now with a description");
      console.log("✅ Settings updated correctly");
    });
  });

  // =========================================================================
  // Quest CRUD
  // =========================================================================

  describe("Quest CRUD", () => {
    let questBaseExpression: string;

    it("should create a quest", async () => {
      const perspective = await ad4mClient!.perspective.byUUID(holonPerspectiveUuid);
      const { Quest } = await import("../../src/lib/ad4m/models/index");

      const quest = new Quest(perspective!);
      quest.title = "Build the AD4M bridge";
      quest.status = "ongoing";
      quest.when = "2024-Q1";
      quest.initiator = "test-admin";
      await quest.save();

      questBaseExpression = quest.baseExpression;
      expect(questBaseExpression).toBeTruthy();
      console.log("Created quest:", questBaseExpression);
    });

    it("should create multiple quests", async () => {
      const perspective = await ad4mClient!.perspective.byUUID(holonPerspectiveUuid);
      const { Quest } = await import("../../src/lib/ad4m/models/index");

      const quest2 = new Quest(perspective!);
      quest2.title = "Write integration tests";
      quest2.status = "ongoing";
      quest2.when = "2024-Q1";
      await quest2.save();

      const quest3 = new Quest(perspective!);
      quest3.title = "Deploy to production";
      quest3.status = "pending";
      quest3.when = "2024-Q2";
      await quest3.save();

      console.log("✅ Multiple quests created");
    });

    it("should read all quests", async () => {
      const perspective = await ad4mClient!.perspective.byUUID(holonPerspectiveUuid);
      const { Quest } = await import("../../src/lib/ad4m/models/index");

      const quests = await Quest.findAll(perspective!, {}, false);
      expect(quests.length).toBe(3);

      const titles = quests.map((q: any) => q.title).sort();
      expect(titles).toContain("Build the AD4M bridge");
      expect(titles).toContain("Write integration tests");
      expect(titles).toContain("Deploy to production");
      console.log("✅ All 3 quests read back");
    });

    it("should update a quest", async () => {
      const perspective = await ad4mClient!.perspective.byUUID(holonPerspectiveUuid);
      const { Quest } = await import("../../src/lib/ad4m/models/index");

      const quests = await Quest.findAll(perspective!, {}, false);
      const quest = quests.find((q: any) => q.title === "Build the AD4M bridge");
      expect(quest).toBeTruthy();

      quest!.status = "completed";
      quest!.completed = new Date().toISOString();
      await quest!.update();

      // Read back
      const updated = await Quest.findAll(perspective!, {}, false);
      const completedQuest = updated.find((q: any) => q.title === "Build the AD4M bridge");
      expect(completedQuest!.status).toBe("completed");
      expect(completedQuest!.completed).toBeTruthy();
      console.log("✅ Quest updated to completed");
    });

    it("should delete a quest", async () => {
      const perspective = await ad4mClient!.perspective.byUUID(holonPerspectiveUuid);
      const { Quest } = await import("../../src/lib/ad4m/models/index");

      const quests = await Quest.findAll(perspective!, {}, false);
      const toDelete = quests.find((q: any) => q.title === "Deploy to production");
      expect(toDelete).toBeTruthy();

      await toDelete!.delete();

      // Verify deletion
      const remaining = await Quest.findAll(perspective!, {}, false);
      expect(remaining.length).toBe(2);
      expect(remaining.find((q: any) => q.title === "Deploy to production")).toBeUndefined();
      console.log("✅ Quest deleted");
    });
  });

  // =========================================================================
  // HolonMember CRUD
  // =========================================================================

  describe("HolonMember CRUD", () => {
    it("should create members", async () => {
      const perspective = await ad4mClient!.perspective.byUUID(holonPerspectiveUuid);
      const { HolonMember } = await import("../../src/lib/ad4m/models/index");

      const member1 = new HolonMember(perspective!);
      member1.username = "alice";
      member1.firstName = "Alice";
      member1.lastName = "Wonderland";
      await member1.save();

      const member2 = new HolonMember(perspective!);
      member2.username = "bob";
      member2.firstName = "Bob";
      member2.hours = 42;
      await member2.save();

      console.log("✅ Members created");
    });

    it("should read all members", async () => {
      const perspective = await ad4mClient!.perspective.byUUID(holonPerspectiveUuid);
      const { HolonMember } = await import("../../src/lib/ad4m/models/index");

      const members = await HolonMember.findAll(perspective!, {}, false);
      expect(members.length).toBe(2);

      const alice = members.find((m: any) => m.username === "alice");
      expect(alice).toBeTruthy();
      expect(alice!.firstName).toBe("Alice");
      expect(alice!.lastName).toBe("Wonderland");

      const bob = members.find((m: any) => m.username === "bob");
      expect(bob).toBeTruthy();
      expect(bob!.hours).toBe(42);
      console.log("✅ Members read back correctly");
    });
  });

  // =========================================================================
  // ShoppingItem CRUD
  // =========================================================================

  describe("ShoppingItem CRUD", () => {
    it("should create and read shopping items", async () => {
      const perspective = await ad4mClient!.perspective.byUUID(holonPerspectiveUuid);
      const { ShoppingItem } = await import("../../src/lib/ad4m/models/index");

      const item = new ShoppingItem(perspective!);
      item.name = "Apples";
      item.quantity = 5;
      item.done = false;
      item.addedBy = "alice";
      item.addedOn = new Date().toISOString();
      await item.save();

      const items = await ShoppingItem.findAll(perspective!, {}, false);
      expect(items.length).toBe(1);
      expect(items[0].name).toBe("Apples");
      expect(items[0].quantity).toBe(5);
      expect(items[0].done).toBe(false);
      console.log("✅ ShoppingItem CRUD works");
    });
  });

  // =========================================================================
  // Chromosome & DNASequence CRUD
  // =========================================================================

  describe("Chromosome & DNASequence CRUD", () => {
    let chromosomeBaseExpr: string;

    it("should create chromosomes", async () => {
      const perspective = await ad4mClient!.perspective.byUUID(holonPerspectiveUuid);
      const { Chromosome } = await import("../../src/lib/ad4m/models/index");

      const chrome = new Chromosome(perspective!);
      chrome.holonId = holonPerspectiveUuid;
      chrome.name = "Consent Decision-Making";
      chrome.chromosomeType = "practice";
      chrome.description = "Decisions via informed consent";
      await chrome.save();

      chromosomeBaseExpr = chrome.baseExpression;
      expect(chromosomeBaseExpr).toBeTruthy();
      console.log("✅ Chromosome created:", chromosomeBaseExpr);
    });

    it.skip("should create a DNA sequence referencing chromosomes", async () => {
      // SKIP: @Collection properties not supported by Prolog query path (useSurrealDB=false)
      // Re-enable when executor is upgraded to v0.11.x+ with SurrealDB support
      const perspective = await ad4mClient!.perspective.byUUID(holonPerspectiveUuid);
      const { DNASequence } = await import("../../src/lib/ad4m/models/index");

      const dna = new DNASequence(perspective!);
      dna.holonId = holonPerspectiveUuid;
      dna.version = 1;
      // Add chromosome reference to the ordered list
      dna.chromosomeIds = [chromosomeBaseExpr];
      await dna.save();

      // Read back
      const results = await DNASequence.findAll(perspective!, {}, false);
      expect(results.length).toBe(1);
      expect(results[0].holonId).toBe(holonPerspectiveUuid);
      expect(results[0].chromosomeIds).toContain(chromosomeBaseExpr);
      console.log("✅ DNASequence created with chromosome reference");
    });
  });

  // =========================================================================
  // Role CRUD
  // =========================================================================

  describe("Role CRUD", () => {
    it("should create and read roles", async () => {
      const perspective = await ad4mClient!.perspective.byUUID(holonPerspectiveUuid);
      const { Role } = await import("../../src/lib/ad4m/models/index");

      const role = new Role(perspective!);
      role.title = "Coordinator";
      role.description = "Coordinates activities";
      role.color = "#4488ff";
      await role.save();

      const roles = await Role.findAll(perspective!, {}, false);
      expect(roles.length).toBe(1);
      expect(roles[0].title).toBe("Coordinator");
      console.log("✅ Role CRUD works");
    });
  });

  // =========================================================================
  // CouncilAdvisor CRUD
  // =========================================================================

  describe("CouncilAdvisor CRUD", () => {
    it("should create and read council advisors", async () => {
      const perspective = await ad4mClient!.perspective.byUUID(holonPerspectiveUuid);
      const { CouncilAdvisor } = await import("../../src/lib/ad4m/models/index");

      const advisor = new CouncilAdvisor(perspective!);
      advisor.name = "Athena";
      advisor.advisorType = "mythic";
      advisor.lens = "governance";
      advisor.characterSpec = JSON.stringify({ wisdom: "high", domain: "strategy" });
      await advisor.save();

      const advisors = await CouncilAdvisor.findAll(perspective!, {}, false);
      expect(advisors.length).toBe(1);
      expect(advisors[0].name).toBe("Athena");
      expect(advisors[0].advisorType).toBe("mythic");
      expect(advisors[0].lens).toBe("governance");
      console.log("✅ CouncilAdvisor CRUD works");
    });
  });

  // =========================================================================
  // Badge CRUD
  // =========================================================================

  describe("Badge CRUD", () => {
    it("should create and read badges", async () => {
      const perspective = await ad4mClient!.perspective.byUUID(holonPerspectiveUuid);
      const { Badge } = await import("../../src/lib/ad4m/models/index");

      const badge = new Badge(perspective!);
      badge.title = "First Quest";
      badge.description = "Completed your first quest";
      badge.criteria = "Complete any quest";
      await badge.save();

      const badges = await Badge.findAll(perspective!, {}, false);
      expect(badges.length).toBe(1);
      expect(badges[0].title).toBe("First Quest");
      expect(badges[0].description).toBe("Completed your first quest");
      console.log("✅ Badge CRUD works");
    });
  });

  // =========================================================================
  // Invite CRUD
  // =========================================================================

  describe("Invite CRUD", () => {
    it("should create and read invites", async () => {
      const perspective = await ad4mClient!.perspective.byUUID(holonPerspectiveUuid);
      const { Invite } = await import("../../src/lib/ad4m/models/index");

      const invite = new Invite(perspective!);
      invite.title = "Join our community";
      invite.code = "ABC123";
      invite.maxUses = 10;
      invite.usedCount = 0;
      await invite.save();

      const invites = await Invite.findAll(perspective!, {}, false);
      expect(invites.length).toBe(1);
      expect(invites[0].title).toBe("Join our community");
      expect(invites[0].code).toBe("ABC123");
      expect(invites[0].maxUses).toBe(10);
      console.log("✅ Invite CRUD works");
    });
  });

  // =========================================================================
  // OfferWant CRUD
  // =========================================================================

  describe("OfferWant CRUD", () => {
    it("should create and read offers", async () => {
      const perspective = await ad4mClient!.perspective.byUUID(holonPerspectiveUuid);
      const { OfferWant } = await import("../../src/lib/ad4m/models/index");

      const offer = new OfferWant(perspective!);
      offer.title = "Fresh tomatoes";
      offer.description = "Homegrown organic tomatoes";
      offer.exchangeType = "offer";
      offer.itemType = "good";
      await offer.save();

      const offers = await OfferWant.findAll(perspective!, {}, false);
      expect(offers.length).toBe(1);
      expect(offers[0].title).toBe("Fresh tomatoes");
      expect(offers[0].exchangeType).toBe("offer");
      console.log("✅ OfferWant CRUD works");
    });
  });

  // =========================================================================
  // QuestTreeNode CRUD
  // =========================================================================

  describe("QuestTreeNode CRUD", () => {
    it("should create and read quest tree nodes", async () => {
      const perspective = await ad4mClient!.perspective.byUUID(holonPerspectiveUuid);
      const { QuestTreeNode } = await import("../../src/lib/ad4m/models/index");

      const root = new QuestTreeNode(perspective!);
      root.title = "Build sustainable community";
      root.description = "Top-level vision";
      root.generation = 0;
      root.status = "ongoing";
      root.impactCategory = "social";
      await root.save();

      expect(root.baseExpression).toBeTruthy();

      const nodes = await QuestTreeNode.findAll(perspective!, {}, false);
      expect(nodes.length).toBe(1);
      expect(nodes[0].title).toBe("Build sustainable community");
      expect(nodes[0].generation).toBe(0);
      expect(nodes[0].status).toBe("ongoing");
      console.log("✅ QuestTreeNode CRUD works");
    });
  });

  // =========================================================================
  // GenericData CRUD
  // =========================================================================

  describe("GenericData CRUD", () => {
    it("should create and read generic data entries", async () => {
      const perspective = await ad4mClient!.perspective.byUUID(holonPerspectiveUuid);
      const { GenericData } = await import("../../src/lib/ad4m/models/index");

      const entry = new GenericData(perspective!);
      entry.data = JSON.stringify({ ritual: "morning standup", frequency: "daily" });
      entry.key = "standup";
      entry.lens = "previous_rituals";
      await entry.save();

      const entries = await GenericData.findAll(perspective!, {}, false);
      expect(entries.length).toBeGreaterThanOrEqual(1);

      const standup = entries.find((e: any) => e.key === "standup");
      expect(standup).toBeTruthy();
      const parsed = JSON.parse(standup!.data);
      expect(parsed.ritual).toBe("morning standup");
      console.log("✅ GenericData CRUD works");
    });
  });

  // =========================================================================
  // Link Authorship Verification
  // =========================================================================

  describe("Link Authorship", () => {
    it("should have valid signatures on all links", async () => {
      const perspective = await ad4mClient!.perspective.byUUID(holonPerspectiveUuid);
      const links = await perspective!.get(new LinkQuery({}));

      expect(links.length).toBeGreaterThan(0);
      console.log(`Total links in perspective: ${links.length}`);

      // Check that all links have valid proofs
      const agentMe = await ad4mClient!.agent.me();
      let validCount = 0;

      for (const link of links) {
        expect(link.author).toBe(agentMe.did);
        expect(link.proof.valid).toBe(true);
        validCount++;
      }

      console.log(`✅ All ${validCount} links have correct author and valid signatures`);
    });
  });
});
