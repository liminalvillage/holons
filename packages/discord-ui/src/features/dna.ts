/**
 * DNA feature. A holon's "DNA" is an ordered set of chromosomes (values, tools,
 * practices) that describe who the community is. `/dna` lets members view and
 * shape it: show the active sequence, browse the library, seed defaults, and
 * add/remove chromosomes.
 *
 * Persistence and validation live in `@holons/core/dna`; this module collects
 * Discord inputs and renders results. The dna helpers expect the concrete
 * HoloSphere instance, which `ctx.holosphere` is at runtime.
 */
import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import {
  addChromosome,
  getChromosomeLibrary,
  getDNASequence,
  saveDNASequence,
  seedChromosomeLibrary,
  validateDNASequence,
  type Chromosome,
  type ChromosomeType,
  type DNASequence,
} from '@holons/core/dna';
import type { Feature, InvocationContext } from '../types.js';
import { ACCENT } from '../ui/DiscordUI.js';

const FEATURE_ID = 'dna';
const TYPE_ICON: Record<ChromosomeType, string> = {
  value: '💎',
  tool: '🛠️',
  practice: '🔁',
};

/** dna helpers want the concrete HoloSphere instance. */
function hs(ctx: InvocationContext): any {
  return ctx.holosphere as unknown as any;
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

function chromosomeLine(c: Chromosome): string {
  return `${TYPE_ICON[c.type] ?? '•'} **${c.name}** — ${c.description}`;
}

/** Resolve a user-supplied name or id to a library chromosome. */
function resolve(
  library: Chromosome[],
  needle: string
): Chromosome | undefined {
  const lower = needle.toLowerCase();
  return library.find(c => c.id === needle || c.name.toLowerCase() === lower);
}

export const dnaFeature: Feature = {
  id: FEATURE_ID,
  commands: [
    new SlashCommandBuilder()
      .setName('dna')
      .setDescription(
        'View and shape this holon’s DNA (values, tools, practices)'
      )
      .addSubcommand(sub =>
        sub.setName('show').setDescription('Show the active DNA sequence')
      )
      .addSubcommand(sub =>
        sub
          .setName('library')
          .setDescription('Browse the chromosome library')
          .addStringOption(opt =>
            opt
              .setName('type')
              .setDescription('Filter by type')
              .setRequired(false)
              .addChoices(
                { name: 'value', value: 'value' },
                { name: 'tool', value: 'tool' },
                { name: 'practice', value: 'practice' }
              )
          )
      )
      .addSubcommand(sub =>
        sub
          .setName('seed')
          .setDescription('Seed the library with the default chromosomes')
      )
      .addSubcommand(sub =>
        sub
          .setName('add')
          .setDescription('Create a chromosome and add it to the DNA')
          .addStringOption(opt =>
            opt.setName('name').setDescription('Name').setRequired(true)
          )
          .addStringOption(opt =>
            opt
              .setName('type')
              .setDescription('Type')
              .setRequired(true)
              .addChoices(
                { name: 'value', value: 'value' },
                { name: 'tool', value: 'tool' },
                { name: 'practice', value: 'practice' }
              )
          )
          .addStringOption(opt =>
            opt
              .setName('description')
              .setDescription('Description (10–500 chars)')
              .setRequired(true)
          )
      )
      .addSubcommand(sub =>
        sub
          .setName('remove')
          .setDescription('Remove a chromosome from the active DNA')
          .addStringOption(opt =>
            opt
              .setName('chromosome')
              .setDescription('Chromosome name or id')
              .setRequired(true)
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
    const sub = interaction.options.getSubcommand();
    const library = await getChromosomeLibrary(hs(ctx), ctx.holonId);

    if (sub === 'show') {
      const dna = await getDNASequence(hs(ctx), ctx.holonId);
      const ids = dna?.chromosomeIds ?? [];
      const byId = new Map(library.map(c => [c.id, c]));
      const lines = ids
        .map(id => byId.get(id))
        .filter((c): c is Chromosome => Boolean(c))
        .map(chromosomeLine);
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(ACCENT)
            .setTitle('🧬 Holon DNA')
            .setDescription(
              lines.length
                ? lines.join('\n')
                : 'No chromosomes yet. Seed the library with `/dna seed`, then add some with `/dna add`.'
            )
            .setFooter({ text: `${ids.length}/20 chromosomes` }),
        ],
      });
      return;
    }

    if (sub === 'library') {
      const type = interaction.options.getString(
        'type'
      ) as ChromosomeType | null;
      const filtered = type ? library.filter(c => c.type === type) : library;
      if (filtered.length === 0) {
        await interaction.reply({
          content: 'The chromosome library is empty. Seed it with `/dna seed`.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const lines = filtered.slice(0, 30).map(chromosomeLine);
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(ACCENT)
            .setTitle('📖 Chromosome library')
            .setDescription(lines.join('\n')),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'seed') {
      await seedChromosomeLibrary(hs(ctx), ctx.holonId);
      await interaction.reply({
        content: '🌱 Seeded the chromosome library with the defaults.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'add') {
      const name = interaction.options.getString('name', true).trim();
      const type = interaction.options.getString(
        'type',
        true
      ) as ChromosomeType;
      const description = interaction.options
        .getString('description', true)
        .trim();
      let created: Chromosome;
      try {
        created = await addChromosome(hs(ctx), ctx.holonId, {
          holonId: ctx.holonId,
          name,
          type,
          description,
        });
      } catch (err) {
        await interaction.reply({
          content: `Could not add chromosome: ${err instanceof Error ? err.message : 'validation failed'}`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const dna = await getDNASequence(hs(ctx), ctx.holonId);
      const ids = [...(dna?.chromosomeIds ?? []), created.id];
      const candidate: DNASequence = {
        holonId: ctx.holonId,
        chromosomeIds: ids,
        created: dna?.created ?? new Date().toISOString(),
        updated: new Date().toISOString(),
        version: dna?.version ?? 0,
      };
      const check = validateDNASequence(candidate, [...library, created]);
      if (!check.isValid) {
        await interaction.reply({
          content: `Added **${name}** to the library, but not to the DNA: ${check.errors.join(', ')}`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await saveDNASequence(hs(ctx), ctx.holonId, ids, dna?.version);
      await interaction.reply({
        content: `🧬 Added **${name}** to the holon DNA (${ids.length}/20).`,
      });
      return;
    }

    // sub === 'remove'
    const needle = interaction.options.getString('chromosome', true).trim();
    const target = resolve(library, needle);
    const dna = await getDNASequence(hs(ctx), ctx.holonId);
    if (!target || !dna || !dna.chromosomeIds.includes(target.id)) {
      await interaction.reply({
        content: `**${needle}** is not in the active DNA.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const ids = dna.chromosomeIds.filter(id => id !== target.id);
    await saveDNASequence(hs(ctx), ctx.holonId, ids, dna.version);
    await interaction.reply({
      content: `🧬 Removed **${target.name}** from the holon DNA (${ids.length}/20).`,
    });
  },
};
