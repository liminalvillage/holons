/**
 * Roles feature. `/roles` lists the holon's roles with Join/Leave buttons;
 * `/role add|remove|info|edit` manages them. All role logic — participant
 * toggling, legacy migration, checklist-cascade deletion, completion tallies —
 * lives in `@holons/core/roles`; this module only renders and wires buttons.
 *
 * Role ids mirror their (possibly colon-containing) title, so we base64url-
 * encode the id into button customIds and decode on the way back.
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type MessageComponentInteraction,
} from 'discord.js';
import {
  clearAllRoles,
  createRole,
  deleteRoleWithChecklist,
  getRole,
  getRoleByTitle,
  listRoles,
  saveRole,
  toggleParticipant,
  type Role,
  type RoleParticipant,
  type RolesDB,
} from '@holons/core/roles';
import type { Feature, InvocationContext } from '../types.js';
import { encodeCustomId, type ParsedCustomId } from '../ui/customId.js';
import { ACCENT } from '../ui/DiscordUI.js';

const FEATURE_ID = 'roles';
/** Max Join buttons to show (Discord allows 5 per action row). */
const MAX_JOIN_BUTTONS = 5;

function db(ctx: InvocationContext): RolesDB {
  return ctx.holosphere as unknown as RolesDB;
}

/** Role id ↔ button-safe token (titles may contain the ':' separator). */
const encId = (id: string): string =>
  Buffer.from(id, 'utf8').toString('base64url');
const decId = (token: string): string =>
  Buffer.from(token, 'base64url').toString('utf8');

function participantFrom(interaction: {
  user: { id: string; username: string; globalName?: string | null };
}): RoleParticipant {
  return {
    id: interaction.user.id,
    username: interaction.user.username,
    first_name: interaction.user.globalName ?? interaction.user.username,
    last_name: null,
  };
}

function isManager(
  interaction: ChatInputCommandInteraction | MessageComponentInteraction
): boolean {
  return Boolean(
    interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
  );
}

async function needHolon(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  await interaction.reply({
    content:
      'This server is not bound to a holon yet. Ask an admin to run `/holon bind`.',
    flags: MessageFlags.Ephemeral,
  });
}

function memberLabel(p: RoleParticipant): string {
  return p.username ?? p.first_name ?? String(p.id ?? 'someone');
}

function rolesEmbed(roles: Role[]): EmbedBuilder {
  const lines = roles.map(r => {
    const members =
      r.participants.length > 0
        ? r.participants.map(memberLabel).join(', ')
        : '_open_';
    return `**${r.title}** (${r.participants.length})\n${members}${
      r.description ? `\n_${r.description}_` : ''
    }`;
  });
  return new EmbedBuilder()
    .setColor(ACCENT)
    .setTitle('🎭 Roles')
    .setDescription(lines.join('\n\n'));
}

function rolesComponents(roles: Role[]): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  const joinable = roles.slice(0, MAX_JOIN_BUTTONS);
  if (joinable.length > 0) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const r of joinable) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(encodeCustomId(FEATURE_ID, 'join', encId(r.id)))
          .setLabel(r.title.slice(0, 70))
          .setStyle(ButtonStyle.Primary)
      );
    }
    rows.push(row);
  }
  rows.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(encodeCustomId(FEATURE_ID, 'clear'))
        .setLabel('Clear all')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🧹')
    )
  );
  return rows;
}

async function renderRoleList(ctx: InvocationContext): Promise<{
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
}> {
  const roles = await listRoles(db(ctx), ctx.holonId as string);
  return {
    embeds: [rolesEmbed(roles)],
    components: roles.length ? rolesComponents(roles) : [],
  };
}

export const rolesFeature: Feature = {
  id: FEATURE_ID,
  commands: [
    new SlashCommandBuilder()
      .setName('roles')
      .setDescription('List holon roles and join them'),
    new SlashCommandBuilder()
      .setName('role')
      .setDescription('Manage holon roles')
      .addSubcommand(sub =>
        sub
          .setName('add')
          .setDescription('Create a role (admins)')
          .addStringOption(opt =>
            opt.setName('title').setDescription('Role title').setRequired(true)
          )
          .addStringOption(opt =>
            opt
              .setName('description')
              .setDescription('What the role does')
              .setRequired(false)
          )
      )
      .addSubcommand(sub =>
        sub
          .setName('remove')
          .setDescription('Delete a role (admins)')
          .addStringOption(opt =>
            opt.setName('title').setDescription('Role title').setRequired(true)
          )
      )
      .addSubcommand(sub =>
        sub
          .setName('edit')
          .setDescription('Update a role description (admins)')
          .addStringOption(opt =>
            opt.setName('title').setDescription('Role title').setRequired(true)
          )
          .addStringOption(opt =>
            opt
              .setName('description')
              .setDescription('New description')
              .setRequired(true)
          )
      )
      .addSubcommand(sub =>
        sub
          .setName('info')
          .setDescription('Show a role')
          .addStringOption(opt =>
            opt.setName('title').setDescription('Role title').setRequired(true)
          )
      ),
  ],

  async handleCommand(
    interaction: ChatInputCommandInteraction,
    ctx: InvocationContext
  ): Promise<void> {
    if (!ctx.holonId) {
      await needHolon(interaction);
      return;
    }

    if (interaction.commandName === 'roles') {
      const roles = await listRoles(db(ctx), ctx.holonId);
      if (roles.length === 0) {
        await interaction.reply({
          content: 'No roles yet. Admins can create one with `/role add`.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await interaction.reply(await renderRoleList(ctx));
      return;
    }

    // /role ...
    const sub = interaction.options.getSubcommand();
    const title = interaction.options.getString('title', true).trim();

    if (sub === 'info') {
      const role = await getRoleByTitle(db(ctx), ctx.holonId, title);
      if (!role) {
        await interaction.reply({
          content: `Role "${title}" not found.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await interaction.reply({ embeds: [rolesEmbed([role])] });
      return;
    }

    if (!isManager(interaction)) {
      await interaction.reply({
        content: 'Only members with **Manage Server** can change roles.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'add') {
      const existing = await getRoleByTitle(db(ctx), ctx.holonId, title);
      if (existing) {
        await interaction.reply({
          content: `Role "${title}" already exists.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const role = createRole(
        title,
        interaction.options.getString('description') ?? ''
      );
      await saveRole(db(ctx), ctx.holonId, role);
      await interaction.reply({ embeds: [rolesEmbed([role])] });
      return;
    }

    if (sub === 'edit') {
      const role = await getRoleByTitle(db(ctx), ctx.holonId, title);
      if (!role) {
        await interaction.reply({
          content: `Role "${title}" not found.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      role.description = interaction.options
        .getString('description', true)
        .trim();
      await saveRole(db(ctx), ctx.holonId, role);
      await interaction.reply({ embeds: [rolesEmbed([role])] });
      return;
    }

    // sub === 'remove'
    const role = await getRoleByTitle(db(ctx), ctx.holonId, title);
    if (!role) {
      await interaction.reply({
        content: `Role "${title}" not found.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await deleteRoleWithChecklist(db(ctx), ctx.holonId, role);
    await interaction.reply({
      content: `🗑️ Role "${title}" removed.`,
      flags: MessageFlags.Ephemeral,
    });
  },

  async handleComponent(
    interaction: MessageComponentInteraction,
    parsed: ParsedCustomId,
    ctx: InvocationContext
  ): Promise<void> {
    if (!ctx.holonId) {
      await interaction.reply({
        content: 'This server is no longer bound to a holon.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (parsed.action === 'join') {
      const roleId = decId(parsed.args[0]);
      const role = await getRole(db(ctx), ctx.holonId, roleId);
      if (!role) {
        await interaction.reply({
          content: 'That role no longer exists.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const { role: updated } = toggleParticipant(
        role,
        participantFrom(interaction)
      );
      await saveRole(db(ctx), ctx.holonId, updated);
      await interaction.update(await renderRoleList(ctx));
      return;
    }

    if (parsed.action === 'clear') {
      if (!isManager(interaction)) {
        await interaction.reply({
          content: 'Only members with **Manage Server** can clear roles.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await clearAllRoles(db(ctx), ctx.holonId);
      await interaction.update(await renderRoleList(ctx));
    }
  },
};
