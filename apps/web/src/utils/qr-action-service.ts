import type { HoloSphere } from "holosphere";
// @ts-ignore — registry is exported from holosphere ESM but missing from type declarations
import { registry } from "holosphere";
import { addParticipant as addTaskParticipant } from "@holons/core/tasks";
import { reflectMembership } from "./reflectMembership";
import {
  clearParticipants as clearRoleParticipants,
  setPermanent as setRoleHolder,
} from "@holons/core/roles";

export interface TelegramUser {
  id: number | string;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

export interface QRActionParams {
  action: string;
  title: string;
  desc?: string;
  holonID: string;
  deckId?: string;
  cardId?: string;
  /**
   * Storage key of an existing item to join. When present, the action adds the
   * scanner to that specific quest/role rather than creating a new one.
   */
  itemId?: string;
}

export interface QRActionResult {
  success: boolean;
  message: string;
  redirectUrl?: string;
  assignedRole?: string;
  error?: string;
}

/**
 * Processes QR code actions for role assignment, event creation, task assignment,
 * badge awarding, and invite processing within the Harvest ecosystem.
 *
 * This service handles the complete lifecycle of QR code-based actions including
 * user management, data persistence, and audit logging.
 *
 * @class QRActionService
 *
 * @example
 * ```typescript
 * import { QRActionService } from './qr-action-service';
 *
 * const service = new QRActionService(holosphere);
 *
 * const result = await service.processQRAction(
 *   { action: 'role', title: 'Facilitator', holonID: 'myHolon' },
 *   { id: 123, first_name: 'John', auth_date: Date.now(), hash: '...' }
 * );
 *
 * if (result.success) {
 *   console.log(result.message);
 *   window.location.href = result.redirectUrl;
 * }
 * ```
 */
export class QRActionService {
  private holosphere: HoloSphere;

  /**
   * Creates a new QRActionService instance.
   *
   * @param {HoloSphere} holosphere - The HoloSphere instance for data operations
   */
  constructor(holosphere: HoloSphere) {
    this.holosphere = holosphere;
  }

  /**
   * Writes data to holosphere on behalf of the scanning user. Same path the
   * rest of the dashboard uses to act on a holon's lens.
   */
  private async putItem(
    holonID: string,
    lens: string,
    data: any,
  ): Promise<void> {
    await this.holosphere.put(holonID, lens, data);
  }

  /**
   * Reads a single item from a (possibly other) holon. On a fresh scan the
   * item is a cold cross-holon read, so we wait for the network rather than
   * letting Gun's synchronous miss report it as not-found.
   */
  private async getItem(
    holonID: string,
    lens: string,
    key: string,
  ): Promise<any> {
    return (this.holosphere as any).get(holonID, lens, key, null, {
      awaitNetwork: true,
    });
  }

  /**
   * Stores an inbound read grant in the scanner's federation registry so that
   * holosphere.get() can find it via _getCapabilityForAuthor(). This grants the
   * scanning user read access to the holon they just acted on.
   */
  private async storeReadAccess(holonID: string): Promise<void> {
    if (!holonID) return;

    const hs = this.holosphere as any;
    const client = hs.client;
    const appName = hs.config?.appName;
    if (!client || !appName) return;

    try {
      await registry.storeInboundCapability(
        client,
        appName,
        holonID, // partner = the holon whose data we want to read
        {
          token: "qr_link",
          scope: { holonId: holonID, lensName: "*", dataId: "*" },
          permissions: ["read"],
          expires: null,
        },
      );
      console.log(
        `[QRActionService] Stored inbound read access for holon ${holonID.slice(0, 12)}...`,
      );
    } catch (err) {
      console.warn("[QRActionService] Failed to store read access:", err);
    }
  }

  /**
   * Builds a participant entry for the scanning user.
   */
  private participantFor(user: TelegramUser) {
    return {
      id: user.id.toString(),
      username: user.username || `user_${user.id}`,
      first_name: user.first_name,
      last_name: user.last_name || "",
      assigned_at: new Date().toISOString(),
      assigned_via: "qr_code",
    };
  }

  /**
   * Creates or refreshes the scanner's user record in the holon.
   */
  private async saveUserRecord(
    params: QRActionParams,
    user: TelegramUser,
  ): Promise<void> {
    const existingUser = await this.holosphere.get(
      params.holonID,
      "users",
      user.id.toString(),
    );
    const userData = existingUser || {
      id: user.id.toString(),
      username: user.username || `user_${user.id}`,
      first_name: user.first_name,
      last_name: user.last_name || "",
      joined_at: new Date().toISOString(),
      last_active: new Date().toISOString(),
    };
    userData.last_active = new Date().toISOString();
    await this.putItem(params.holonID, "users", userData);
  }

  /**
   * Processes a QR code action based on the provided parameters.
   * Routes to the appropriate handler based on action type.
   *
   * @async
   * @param {QRActionParams} params - The QR code action parameters
   * @param {TelegramUser} user - The Telegram user performing the action
   * @returns {Promise<QRActionResult>} The result of the action
   */
  async processQRAction(
    params: QRActionParams,
    user: TelegramUser,
  ): Promise<QRActionResult> {
    try {
      // Grant the scanner read access to the holon they're acting on so the
      // result (and redirect target) is readable afterwards.
      await this.storeReadAccess(params.holonID);

      const normalizedAction = params.action.toLowerCase();
      switch (normalizedAction) {
        case "role":
          return await this.assignRole(params, user);
        case "event":
          return await this.joinEvent(params, user);
        case "task":
        case "action": // Treat 'action' as an alias for 'task'
          return await this.assignTask(params, user);
        case "badge":
          return await this.awardBadge(params, user);
        case "invite":
          return await this.processInvite(params, user);
        case "resource":
          return await this.createResource(params, user);
        case "vibe":
          return await this.recordVibe(params, user);
        default:
          return {
            success: false,
            message: `Unknown action type: ${params.action}`,
            error: "INVALID_ACTION",
          };
      }
    } catch (error) {
      console.error("Error processing QR action:", error);
      return {
        success: false,
        message: "An error occurred while processing the action",
        error: error instanceof Error ? error.message : "UNKNOWN_ERROR",
      };
    }
  }

  /**
   * Assigns a role to the user, creating the role if it doesn't exist.
   * Clears existing participants if the role already exists.
   *
   * @private
   * @async
   * @param {QRActionParams} params - The action parameters
   * @param {TelegramUser} user - The user to assign the role to
   * @returns {Promise<QRActionResult>} The result of the role assignment
   */
  private async assignRole(
    params: QRActionParams,
    user: TelegramUser,
  ): Promise<QRActionResult> {
    try {
      console.log(
        `[QRActionService] Starting role assignment for user ${user.id} to role: ${params.title}`,
      );

      // If the card targets an existing role, add the scanner to its
      // participants without disturbing the others. Participant management is
      // delegated to @holons/core/roles (idempotent, normalized).
      if (params.itemId) {
        const existing = await this.getItem(
          params.holonID,
          "roles",
          params.itemId,
        );
        if (existing && existing.title) {
          await this.saveUserRecord(params, user);
          // A role is held by one person: taking it over via QR kicks out the
          // previous holder(s) and installs the scanner as the role's holder,
          // overriding any rotation schedule (reversible by releasing the role).
          const updated = setRoleHolder(
            clearRoleParticipants(existing),
            this.participantFor(user),
          );
          await this.putItem(params.holonID, "roles", updated);
          console.log(
            `[QRActionService] Assigned user ${user.id} as sole holder of role ${params.itemId}`,
          );
          return {
            success: true,
            message: `You now hold the role: ${existing.title}`,
            assignedRole: existing.title,
            redirectUrl: `/${params.holonID}/roles`,
          };
        }
        console.warn(
          `[QRActionService] Role ${params.itemId} not found — creating a new role instead`,
        );
      }

      // Get or create user record (roles are stored in roles collection only, not in user table)
      const existingUser = await this.holosphere.get(
        params.holonID,
        "users",
        user.id.toString(),
      );
      const userData = existingUser || {
        id: user.id.toString(),
        username: user.username || `user_${user.id}`,
        first_name: user.first_name,
        last_name: user.last_name || "",
        joined_at: new Date().toISOString(),
        last_active: new Date().toISOString(),
      };

      // Update last active timestamp
      userData.last_active = new Date().toISOString();

      // Save user data (without roles - roles are managed separately in roles collection)
      console.log(`[QRActionService] Saving user data for user ${user.id}`);
      await this.putItem(params.holonID, "users", userData);
      console.log(`[QRActionService] User data saved successfully`);

      // Check if role exists, create it if it doesn't exist
      const roleKey = params.title; // Use title as the consistent key
      console.log(
        `[QRActionService] Looking for existing role with key: ${roleKey}`,
      );
      console.log(
        `[QRActionService] HolonID: ${params.holonID}, Collection: roles, Key: ${roleKey}`,
      );
      let roleData = await this.holosphere.get(
        params.holonID,
        "roles",
        roleKey,
      );
      console.log(`[QRActionService] Retrieved role data:`, roleData);
      console.log(`[QRActionService] Role data type:`, typeof roleData);
      console.log(
        `[QRActionService] Role data keys:`,
        roleData ? Object.keys(roleData) : "null",
      );

      // Track whether this is a new role creation
      const isNewRole = !roleData;

      if (!roleData) {
        // Create new role with enhanced structure
        roleData = {
          id: params.title, // Use title as ID for consistency
          title: params.title,
          description: params.desc || `Role created via QR code`,
          created: new Date().toISOString(),
          created_by: user.id.toString(),
          created_via: "qr_code",
          participants: [],
          permissions: [],
          status: "active",
          holonID: params.holonID,
          deckId: params.deckId,
          cardId: params.cardId,
          metadata: {
            qr_generated: true,
            generation_timestamp: Date.now(),
            generation_source: "qr_code",
          },
        };
        console.log(
          `[QRActionService] Creating new role: ${params.title} with data:`,
          roleData,
        );
      } else {
        console.log(
          `[QRActionService] Role ${params.title} already exists, clearing participants and adding current user`,
        );

        // Clear existing participants and add only the current user
        roleData.participants = [];
        console.log(
          `[QRActionService] Cleared existing participants for role: ${params.title}`,
        );
      }

      // Add user to role participants (either as new participant or replacing cleared ones)
      if (!roleData.participants) roleData.participants = [];

      // Always add the current user (either as new or replacing cleared participants)
      const newParticipant = {
        id: user.id.toString(),
        username: user.username || `user_${user.id}`,
        first_name: user.first_name,
        last_name: user.last_name || "",
        assigned_at: new Date().toISOString(),
        assigned_via: "qr_code",
        assigned_by: "qr_code_system",
        status: "active",
      };

      roleData.participants.push(newParticipant);
      console.log(
        `[QRActionService] Added user ${user.id} to role participants:`,
        newParticipant,
      );
      console.log(
        `[QRActionService] Role participants after adding user:`,
        roleData.participants,
      );

      // Update role metadata
      roleData.last_modified = new Date().toISOString();
      roleData.last_modified_by = user.id.toString();

      // Save role data - Use the role's ID as the key for consistency
      console.log(`[QRActionService] About to save role data:`, roleData);
      console.log(
        `[QRActionService] Role participants before saving:`,
        roleData.participants,
      );
      console.log(
        `[QRActionService] Role participants length:`,
        roleData.participants?.length || 0,
      );
      console.log(
        `[QRActionService] Saving role data for role: ${roleData.title} with key: ${roleKey}`,
      );
      console.log(
        `[QRActionService] Put parameters - HolonID: ${params.holonID}, Collection: roles, Data:`,
        roleData,
      );
      await this.putItem(params.holonID, "roles", roleData);
      console.log(
        `[QRActionService] Role data saved successfully with key: ${roleKey}`,
      );

      // Verify the role was saved correctly by retrieving it
      console.log(
        `[QRActionService] Verification - retrieving saved role with HolonID: ${params.holonID}, Collection: roles, Key: ${roleKey}`,
      );
      const savedRole = await this.holosphere.get(
        params.holonID,
        "roles",
        roleKey,
      );
      console.log(
        `[QRActionService] Verification - retrieved saved role:`,
        savedRole,
      );
      if (savedRole) {
        console.log(
          `[QRActionService] Role saved successfully and can be retrieved`,
        );
        console.log(
          `[QRActionService] Saved role participants:`,
          savedRole.participants,
        );
        console.log(
          `[QRActionService] Participants count:`,
          savedRole.participants?.length || 0,
        );
        console.log(
          `[QRActionService] Saved role keys:`,
          Object.keys(savedRole),
        );
      } else {
        console.warn(
          `[QRActionService] Warning: Role was not saved correctly or cannot be retrieved`,
        );
      }

      // Try alternative keys to see if there's a storage key mismatch
      console.log(`[QRActionService] Trying alternative retrieval keys...`);
      const altKey1 = await this.holosphere.get(
        params.holonID,
        "roles",
        roleData.id,
      );
      console.log(
        `[QRActionService] Retrieved with roleData.id (${roleData.id}):`,
        !!altKey1,
      );

      const altKey2 = await this.holosphere.get(
        params.holonID,
        "roles",
        roleData.title,
      );
      console.log(
        `[QRActionService] Retrieved with roleData.title (${roleData.title}):`,
        !!altKey2,
      );

      // Try to get all roles to see what's actually stored
      try {
        const allRoles = await this.holosphere.getAll(params.holonID, "roles");
        console.log(
          `[QRActionService] All roles in collection:`,
          allRoles.length,
        );
        allRoles.forEach((role, index) => {
          console.log(`[QRActionService] Role ${index + 1}:`, {
            title: role.title,
            id: role.id,
            participants: role.participants?.length || 0,
          });
        });
      } catch (error) {
        console.warn(`[QRActionService] Could not retrieve all roles:`, error);
      }

      // Create audit log entry
      try {
        const auditLog = {
          id: `audit_${Date.now()}_${user.id}`,
          timestamp: new Date().toISOString(),
          action: isNewRole ? "role_assigned" : "role_participant_replaced",
          user_id: user.id.toString(),
          username: user.username || `user_${user.id}`,
          role_title: params.title,
          holonID: params.holonID,
          deckId: params.deckId,
          cardId: params.cardId,
          description: isNewRole
            ? `Role assigned via QR code`
            : `Role participant replaced via QR code - previous participants cleared`,
          source: "qr_code",
          metadata: {
            qr_params: params,
            user_agent:
              typeof navigator !== "undefined"
                ? navigator.userAgent
                : "unknown",
            operation_type: isNewRole
              ? "new_role_creation"
              : "participant_replacement",
            previous_participants_count: isNewRole
              ? 0
              : roleData.participants?.length || 0,
          },
        };

        await this.putItem(params.holonID, "audit_logs", auditLog);
        console.log(`[QRActionService] Audit log created for role assignment`);
      } catch (auditError) {
        console.warn(
          `[QRActionService] Failed to create audit log:`,
          auditError,
        );
        // Don't fail the main operation if audit logging fails
      }

      console.log(
        `[QRActionService] Role assignment completed successfully for user ${user.id} to role ${params.title}`,
      );

      return {
        success: true,
        message: isNewRole
          ? `Successfully assigned role: ${params.title}`
          : `Role participants updated for: ${params.title}`,
        assignedRole: params.title,
        redirectUrl: `/${params.holonID}/roles`,
      };
    } catch (error) {
      console.error(`[QRActionService] Error assigning role:`, error);
      return {
        success: false,
        message: "Failed to assign role. Please try again or contact support.",
        error: error instanceof Error ? error.message : "ROLE_ASSIGNMENT_ERROR",
      };
    }
  }

  /**
   * Joins an event by creating it as a scheduled Quest in the quests collection.
   * Events are scheduled for 12 hours from creation time.
   *
   * @private
   * @async
   * @param {QRActionParams} params - The action parameters
   * @param {TelegramUser} user - The user joining the event
   * @returns {Promise<QRActionResult>} The result of the event creation
   */
  private async joinEvent(
    params: QRActionParams,
    user: TelegramUser,
  ): Promise<QRActionResult> {
    try {
      console.log(
        `[QRActionService] Starting event creation for user ${user.id} to event: ${params.title}`,
      );

      // If the card targets an existing event, add the scanner to it (events are
      // stored as quests) rather than creating a new scheduled one.
      if (params.itemId) {
        const existing = await this.getItem(
          params.holonID,
          "quests",
          params.itemId,
        );
        if (existing && existing.title) {
          await this.saveUserRecord(params, user);
          const updated = addTaskParticipant(
            existing,
            this.participantFor(user),
          );
          await this.putItem(params.holonID, "quests", updated);
          // Mirror into the joiner's personal holon + send the linked DM.
          void reflectMembership({
            holosphere: this.holosphere,
            holonId: params.holonID,
            questId: String(updated.id ?? params.itemId),
            userId: user.id,
            joined: true,
          });
          console.log(
            `[QRActionService] Added user ${user.id} to existing event ${params.itemId}`,
          );
          return {
            success: true,
            message: `You're now attending: ${existing.title}`,
            redirectUrl: `/${params.holonID}/events`,
          };
        }
        console.warn(
          `[QRActionService] Event ${params.itemId} not found — creating a new event instead`,
        );
      }

      // Get or create user record
      const existingUser = await this.holosphere.get(
        params.holonID,
        "users",
        user.id.toString(),
      );

      const userData = existingUser || {
        id: user.id.toString(),
        username: user.username || `user_${user.id}`,
        first_name: user.first_name,
        last_name: user.last_name || "",
        joined_at: new Date().toISOString(),
        last_active: new Date().toISOString(),
      };

      // Update last active timestamp
      userData.last_active = new Date().toISOString();

      // Save user data
      await this.putItem(params.holonID, "users", userData);

      // Calculate event time - 12 hours from now
      const eventTime = new Date();
      eventTime.setHours(eventTime.getHours() + 12);

      // Generate a unique event ID
      const eventId = `event_${params.title.replace(/\s+/g, "_").toLowerCase()}_${Date.now()}`;

      // Create event as a scheduled Quest object in the quests collection
      const questData = {
        id: eventId,
        title: params.title,
        description: params.desc || `Event created via QR code`,
        status: "pending" as const,
        type: "event" as const,
        category: "QR Generated",
        when: eventTime.toISOString(), // Schedule for 12 hours from now
        participants: [
          {
            id: user.id.toString(),
            username: user.username || `user_${user.id}`,
            first_name: user.first_name,
            last_name: user.last_name || "",
            joined_at: new Date().toISOString(),
            joined_via: "qr_code",
          },
        ],
        appreciation: [],
        created: new Date().toISOString(),
        orderIndex: Date.now(), // Use timestamp for ordering
        initiator: {
          id: user.id.toString(),
          username: user.username || `user_${user.id}`,
          firstName: user.first_name,
          lastName: user.last_name || "",
        },
        _meta: {
          source: "qr_code",
          qr_params: params,
          created_via: "qr_action_service",
          scheduled_for: eventTime.toISOString(),
        },
      };

      console.log(
        `[QRActionService] Creating new scheduled Quest for event: ${params.title} at ${eventTime.toISOString()}`,
      );

      // Save quest data using the event ID as key
      await this.putItem(params.holonID, "quests", questData);

      // Mirror into the creator/participant's personal holon + send the DM.
      void reflectMembership({
        holosphere: this.holosphere,
        holonId: params.holonID,
        questId: String(questData.id),
        userId: user.id,
        joined: true,
      });

      console.log(
        `[QRActionService] Event Quest created successfully for user ${user.id} to event ${params.title}`,
      );

      // Format the scheduled time for the success message
      const formattedTime = eventTime.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });

      return {
        success: true,
        message: `Successfully created and scheduled event: ${params.title} for ${formattedTime}`,
        redirectUrl: `/${params.holonID}/events`,
      };
    } catch (error) {
      console.error(`[QRActionService] Error creating event:`, error);
      return {
        success: false,
        message: "Failed to create event. Please try again.",
        error: error instanceof Error ? error.message : "EVENT_CREATION_ERROR",
      };
    }
  }

  /**
   * Assigns a task by creating it as a Quest in the quests collection.
   *
   * @private
   * @async
   * @param {QRActionParams} params - The action parameters
   * @param {TelegramUser} user - The user to assign the task to
   * @returns {Promise<QRActionResult>} The result of the task assignment
   */
  private async assignTask(
    params: QRActionParams,
    user: TelegramUser,
  ): Promise<QRActionResult> {
    try {
      console.log(
        `[QRActionService] Starting task assignment for user ${user.id} to task: ${params.title}`,
      );

      // If the card targets an existing quest, add the scanner to it rather than
      // creating a new one. Participant management is delegated to @holons/core.
      if (params.itemId) {
        const existing = await this.getItem(
          params.holonID,
          "quests",
          params.itemId,
        );
        if (existing && existing.title) {
          await this.saveUserRecord(params, user);
          const updated = addTaskParticipant(
            existing,
            this.participantFor(user),
          );
          await this.putItem(params.holonID, "quests", updated);
          // Mirror into the joiner's personal holon + send the linked DM.
          void reflectMembership({
            holosphere: this.holosphere,
            holonId: params.holonID,
            questId: String(updated.id ?? params.itemId),
            userId: user.id,
            joined: true,
          });
          console.log(
            `[QRActionService] Added user ${user.id} to existing quest ${params.itemId}`,
          );
          return {
            success: true,
            message: `Added you to: ${existing.title}`,
            redirectUrl: `/${params.holonID}/tasks`,
          };
        }
        console.warn(
          `[QRActionService] Quest ${params.itemId} not found — creating a new task instead`,
        );
      }

      // Get or create user record
      const existingUser = await this.holosphere.get(
        params.holonID,
        "users",
        user.id.toString(),
      );

      const userData = existingUser || {
        id: user.id.toString(),
        username: user.username || `user_${user.id}`,
        first_name: user.first_name,
        last_name: user.last_name || "",
        joined_at: new Date().toISOString(),
        last_active: new Date().toISOString(),
      };

      // Update last active timestamp
      userData.last_active = new Date().toISOString();

      // Save user data
      await this.putItem(params.holonID, "users", userData);

      // Generate a unique task ID
      const taskId = `task_${params.title.replace(/\s+/g, "_").toLowerCase()}_${Date.now()}`;

      // Create task as a Quest object in the quests collection
      const questData = {
        id: taskId,
        title: params.title,
        description: params.desc || `Task created via QR code`,
        status: "pending" as const,
        type: "task" as const,
        category: "QR Generated",
        participants: [
          {
            id: user.id.toString(),
            username: user.username || `user_${user.id}`,
            first_name: user.first_name,
            last_name: user.last_name || "",
            assigned_at: new Date().toISOString(),
            assigned_via: "qr_code",
          },
        ],
        appreciation: [],
        created: new Date().toISOString(),
        orderIndex: Date.now(), // Use timestamp for ordering
        initiator: {
          id: user.id.toString(),
          username: user.username || `user_${user.id}`,
          firstName: user.first_name,
          lastName: user.last_name || "",
        },
        _meta: {
          source: "qr_code",
          qr_params: params,
          created_via: "qr_action_service",
        },
      };

      console.log(
        `[QRActionService] Creating new Quest for task: ${params.title} with data:`,
        questData,
      );

      // Save quest data using the task ID as key
      await this.putItem(params.holonID, "quests", questData);

      // Mirror into the assignee/participant's personal holon + send the DM.
      void reflectMembership({
        holosphere: this.holosphere,
        holonId: params.holonID,
        questId: String(questData.id),
        userId: user.id,
        joined: true,
      });

      console.log(
        `[QRActionService] Task Quest created successfully for user ${user.id} to task ${params.title}`,
      );

      return {
        success: true,
        message: `Successfully created and assigned task: ${params.title}`,
        redirectUrl: `/${params.holonID}/tasks`,
      };
    } catch (error) {
      console.error(`[QRActionService] Error assigning task:`, error);
      return {
        success: false,
        message: "Failed to assign task. Please try again.",
        error: error instanceof Error ? error.message : "TASK_ASSIGNMENT_ERROR",
      };
    }
  }

  /**
   * Awards a badge to a user, creating the badge if it doesn't exist.
   *
   * @private
   * @async
   * @param {QRActionParams} params - The action parameters
   * @param {TelegramUser} user - The user to award the badge to
   * @returns {Promise<QRActionResult>} The result of the badge award
   */
  private async awardBadge(
    params: QRActionParams,
    user: TelegramUser,
  ): Promise<QRActionResult> {
    try {
      console.log(
        `[QRActionService] Starting badge award for user ${user.id} to badge: ${params.title}`,
      );

      // Get or create user record
      const existingUser = await this.holosphere.get(
        params.holonID,
        "users",
        user.id.toString(),
      );

      const userData = existingUser || {
        id: user.id.toString(),
        username: user.username || `user_${user.id}`,
        first_name: user.first_name,
        last_name: user.last_name || "",
        joined_at: new Date().toISOString(),
        last_active: new Date().toISOString(),
      };

      // Update last active timestamp
      userData.last_active = new Date().toISOString();

      // Save user data
      await this.putItem(params.holonID, "users", userData);

      // Check if badge exists, create it if it doesn't
      const badgeKey = params.title; // Use title as consistent key
      let badgeData = await this.holosphere.get(
        params.holonID,
        "badges",
        badgeKey,
      );

      const isNewBadge = !badgeData;

      if (!badgeData) {
        // Create new badge
        badgeData = {
          id: params.title,
          title: params.title,
          description: params.desc || `Badge created via QR code`,
          created: new Date().toISOString(),
          created_by: user.id.toString(),
          created_via: "qr_code",
          awarded_to: [],
          icon: "🏆",
          rarity: "common",
          holonID: params.holonID,
          deckId: params.deckId,
          cardId: params.cardId,
          metadata: {
            qr_generated: true,
            generation_timestamp: Date.now(),
            generation_source: "qr_code",
          },
        };
        console.log(`[QRActionService] Creating new badge: ${params.title}`);
      }

      // Add user to badge recipients if not already there
      if (!badgeData.awarded_to) badgeData.awarded_to = [];
      if (!badgeData.awarded_to.some((p: any) => p.id === user.id.toString())) {
        badgeData.awarded_to.push({
          id: user.id.toString(),
          username: user.username || `user_${user.id}`,
          first_name: user.first_name,
          last_name: user.last_name || "",
          awarded_at: new Date().toISOString(),
          awarded_via: "qr_code",
        });
      }

      // Update badge metadata
      badgeData.last_modified = new Date().toISOString();
      badgeData.last_modified_by = user.id.toString();

      // Save badge data
      await this.putItem(params.holonID, "badges", badgeData);

      console.log(
        `[QRActionService] Badge award completed successfully for user ${user.id} to badge ${params.title}`,
      );

      return {
        success: true,
        message: isNewBadge
          ? `Successfully created and awarded badge: ${params.title}`
          : `Successfully awarded badge: ${params.title}`,
        redirectUrl: `/${params.holonID}/badges`,
      };
    } catch (error) {
      console.error(`[QRActionService] Error awarding badge:`, error);
      return {
        success: false,
        message: "Failed to award badge. Please try again.",
        error: error instanceof Error ? error.message : "BADGE_AWARD_ERROR",
      };
    }
  }

  /**
   * Processes an invite, creating it if it doesn't exist.
   *
   * @private
   * @async
   * @param {QRActionParams} params - The action parameters
   * @param {TelegramUser} user - The user accepting the invite
   * @returns {Promise<QRActionResult>} The result of the invite processing
   */
  private async processInvite(
    params: QRActionParams,
    user: TelegramUser,
  ): Promise<QRActionResult> {
    try {
      // Get or create user record
      const existingUser = await this.holosphere.get(
        params.holonID,
        "users",
        user.id.toString(),
      );

      const userData = existingUser || {
        id: user.id.toString(),
        username: user.username || `user_${user.id}`,
        first_name: user.first_name,
        last_name: user.last_name || "",
        invited_by: params.title,
        actions: [],
        joined_at: new Date().toISOString(),
      };

      // Add action record
      if (!userData.actions) userData.actions = [];
      userData.actions.push({
        type: "invite_accepted",
        action: params.title,
        timestamp: Date.now(),
        description: params.desc || `Invite accepted via QR code`,
      });

      // Save user data
      await this.putItem(params.holonID, "users", userData);

      // Check if invite exists, create it if it doesn't
      let inviteData = await this.holosphere.get(
        params.holonID,
        "invites",
        params.title,
      );
      if (!inviteData) {
        // Create new invite
        inviteData = {
          title: params.title,
          description: params.desc || `Invite created via QR code`,
          created: new Date().toISOString(),
          created_by: params.title,
          accepted_by: [],
          status: "active",
          expires_at: null,
        };
        console.log(`Creating new invite: ${params.title}`);
      }

      // Add user to invite acceptors if not already there
      if (!inviteData.accepted_by) inviteData.accepted_by = [];
      if (
        !inviteData.accepted_by.some((p: any) => p.id === user.id.toString())
      ) {
        inviteData.accepted_by.push({
          id: user.id.toString(),
          username: user.username || `user_${user.id}`,
          first_name: user.first_name,
          last_name: user.last_name || "",
          accepted_at: new Date().toISOString(),
          accepted_via: "qr_code",
        });
      }

      // Save invite data
      await this.putItem(params.holonID, "invites", inviteData);

      return {
        success: true,
        message: `Successfully accepted invite from: ${params.title}`,
        redirectUrl: `/${params.holonID}`,
      };
    } catch (error) {
      console.error("Error processing invite:", error);
      return {
        success: false,
        message: "Failed to process invite",
        error:
          error instanceof Error ? error.message : "INVITE_PROCESSING_ERROR",
      };
    }
  }

  /**
   * Creates a resource entry for sharing/tracking resources.
   *
   * @private
   * @async
   * @param {QRActionParams} params - The action parameters
   * @param {TelegramUser} user - The user creating/claiming the resource
   * @returns {Promise<QRActionResult>} The result of the resource creation
   */
  private async createResource(
    params: QRActionParams,
    user: TelegramUser,
  ): Promise<QRActionResult> {
    try {
      console.log(
        `[QRActionService] Starting resource creation for user ${user.id}: ${params.title}`,
      );

      // Get or create user record
      const existingUser = await this.holosphere.get(
        params.holonID,
        "users",
        user.id.toString(),
      );

      const userData = existingUser || {
        id: user.id.toString(),
        username: user.username || `user_${user.id}`,
        first_name: user.first_name,
        last_name: user.last_name || "",
        joined_at: new Date().toISOString(),
        last_active: new Date().toISOString(),
      };

      userData.last_active = new Date().toISOString();
      await this.putItem(params.holonID, "users", userData);

      // Generate a unique resource ID
      const resourceId = `resource_${params.title.replace(/\s+/g, "_").toLowerCase()}_${Date.now()}`;

      // Create resource entry
      const resourceData = {
        id: resourceId,
        title: params.title,
        description: params.desc || `Resource created via QR code`,
        status: "available" as const,
        type: "resource" as const,
        created: new Date().toISOString(),
        created_by: {
          id: user.id.toString(),
          username: user.username || `user_${user.id}`,
          first_name: user.first_name,
          last_name: user.last_name || "",
        },
        claimed_by: [],
        holonID: params.holonID,
        deckId: params.deckId,
        cardId: params.cardId,
        _meta: {
          source: "qr_code",
          qr_params: params,
          created_via: "qr_action_service",
        },
      };

      await this.putItem(params.holonID, "resources", resourceData);

      console.log(
        `[QRActionService] Resource created successfully: ${params.title}`,
      );

      return {
        success: true,
        message: `Successfully created resource: ${params.title}`,
        redirectUrl: `/${params.holonID}/resources`,
      };
    } catch (error) {
      console.error(`[QRActionService] Error creating resource:`, error);
      return {
        success: false,
        message: "Failed to create resource. Please try again.",
        error:
          error instanceof Error ? error.message : "RESOURCE_CREATION_ERROR",
      };
    }
  }

  /**
   * Records a vibe/mood/energy check-in for the user.
   *
   * @private
   * @async
   * @param {QRActionParams} params - The action parameters
   * @param {TelegramUser} user - The user recording the vibe
   * @returns {Promise<QRActionResult>} The result of the vibe recording
   */
  private async recordVibe(
    params: QRActionParams,
    user: TelegramUser,
  ): Promise<QRActionResult> {
    try {
      console.log(
        `[QRActionService] Recording vibe for user ${user.id}: ${params.title}`,
      );

      // Get or create user record
      const existingUser = await this.holosphere.get(
        params.holonID,
        "users",
        user.id.toString(),
      );

      const userData = existingUser || {
        id: user.id.toString(),
        username: user.username || `user_${user.id}`,
        first_name: user.first_name,
        last_name: user.last_name || "",
        joined_at: new Date().toISOString(),
        last_active: new Date().toISOString(),
      };

      userData.last_active = new Date().toISOString();
      await this.putItem(params.holonID, "users", userData);

      // Generate a unique vibe ID
      const vibeId = `vibe_${user.id}_${Date.now()}`;

      // Create vibe entry
      const vibeData = {
        id: vibeId,
        title: params.title,
        description: params.desc || "",
        type: "vibe" as const,
        recorded_at: new Date().toISOString(),
        recorded_by: {
          id: user.id.toString(),
          username: user.username || `user_${user.id}`,
          first_name: user.first_name,
          last_name: user.last_name || "",
        },
        holonID: params.holonID,
        deckId: params.deckId,
        cardId: params.cardId,
        _meta: {
          source: "qr_code",
          qr_params: params,
          created_via: "qr_action_service",
        },
      };

      await this.putItem(params.holonID, "vibes", vibeData);

      console.log(
        `[QRActionService] Vibe recorded successfully: ${params.title}`,
      );

      return {
        success: true,
        message: `Successfully recorded vibe: ${params.title}`,
        redirectUrl: `/${params.holonID}/vibes`,
      };
    } catch (error) {
      console.error(`[QRActionService] Error recording vibe:`, error);
      return {
        success: false,
        message: "Failed to record vibe. Please try again.",
        error: error instanceof Error ? error.message : "VIBE_RECORDING_ERROR",
      };
    }
  }

  /**
   * Gets available actions/roles for a user.
   *
   * @async
   * @param {string} holonID - The holon identifier
   * @param {TelegramUser} user - The Telegram user
   * @returns {Promise<string[]>} Array of available roles/actions
   */
  async getAvailableActions(
    holonID: string,
    user: TelegramUser,
  ): Promise<string[]> {
    try {
      const userData = await this.holosphere.get(
        holonID,
        "users",
        user.id.toString(),
      );
      return userData?.roles || [];
    } catch (error) {
      console.error("Error getting available actions:", error);
      return [];
    }
  }

  /**
   * Validates QR code parameters before processing.
   *
   * @param {QRActionParams} params - The QR code parameters to validate
   * @returns {{isValid: boolean, errors: string[]}} Validation result with any errors
   */
  validateQRParams(params: QRActionParams): {
    isValid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    if (!params.action) errors.push("Action is required");
    if (!params.title) errors.push("Title is required");
    if (!params.holonID) errors.push("Holon ID is required");

    // Validate action types (including 'action' as alias for 'task', and card-generator types)
    const validActions = [
      "role",
      "event",
      "task",
      "action",
      "badge",
      "invite",
      "resource",
      "vibe",
    ];
    if (params.action && !validActions.includes(params.action.toLowerCase())) {
      errors.push(
        `Invalid action type. Must be one of: ${validActions.join(", ")}`,
      );
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }
}
