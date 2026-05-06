// Seed data for DNA Editor - Default chromosomes
// Feature: 001-holon-dna-editor

import type { Chromosome, ChromosomeType } from './types';

export interface SeedChromosome {
  name: string;
  type: ChromosomeType;
  description: string;
  icon?: string;
}

/**
 * Default chromosomes for Values category
 */
export const defaultValues: SeedChromosome[] = [
  {
    name: 'Everyone Contributes',
    type: 'value',
    description: 'We believe all voices matter and everyone has valuable insights to contribute to our collective intelligence.',
    icon: '🙌'
  },
  {
    name: 'Self-Organization',
    type: 'value',
    description: 'We trust in distributed decision-making and emergent solutions over top-down control.',
    icon: '🌊'
  },
  {
    name: 'Radical Inclusion',
    type: 'value',
    description: 'We actively create spaces where all people feel welcomed, valued, and able to fully participate.',
    icon: '🌈'
  },
  {
    name: 'Trust & Safety',
    type: 'value',
    description: 'We cultivate psychological safety where people can take risks, be vulnerable, and speak truth.',
    icon: '🛡️'
  },
  {
    name: 'Commons Stewardship',
    type: 'value',
    description: 'We share resources generously and care for what we create together as common wealth.',
    icon: '🌱'
  },
  {
    name: 'Continuous Learning',
    type: 'value',
    description: 'We embrace experimentation, learn from failure, and adapt based on what emerges.',
    icon: '📚'
  },
  {
    name: 'Power Sharing',
    type: 'value',
    description: 'We distribute authority, rotate leadership, and actively counter concentrations of power.',
    icon: '⚖️'
  },
  {
    name: 'Wholeness',
    type: 'value',
    description: 'We honor the full humanity of each person and integrate personal growth with collective purpose.',
    icon: '🦋'
  },
  {
    name: 'Gift Economy',
    type: 'value',
    description: 'We recognize abundance, practice reciprocity, and contribute based on capacity and passion.',
    icon: '🎁'
  },
  {
    name: 'Local Wisdom',
    type: 'value',
    description: 'We honor indigenous knowledge, place-based practices, and cultural diversity.',
    icon: '🌍'
  }
];

/**
 * Default chromosomes for Tools category - Liberating Structures
 */
export const defaultTools: SeedChromosome[] = [
  {
    name: '1-2-4-All',
    type: 'tool',
    description: 'Engage everyone simultaneously in generating questions, ideas, and suggestions through progressive rounds.',
    icon: '🔢'
  },
  {
    name: 'Troika Consulting',
    type: 'tool',
    description: 'Get practical and imaginative help from colleagues in small groups to solve challenges.',
    icon: '🤝'
  },
  {
    name: 'Wise Crowds',
    type: 'tool',
    description: 'Tap collective intelligence to generate innovative ideas and strategies efficiently.',
    icon: '🧠'
  },
  {
    name: 'Open Space Technology',
    type: 'tool',
    description: 'Liberate action and leadership in groups of any size through self-organizing.',
    icon: '🌐'
  },
  {
    name: 'Sociocracy (Consent)',
    type: 'tool',
    description: 'Make decisions using consent-based governance through circle structures.',
    icon: '🔄'
  },
  {
    name: 'TRIZ',
    type: 'tool',
    description: 'Stop counterproductive activities by making the impossible possible.',
    icon: '🚫'
  },
  {
    name: 'What, So What, Now What?',
    type: 'tool',
    description: 'Together look back on progress and decide on next steps.',
    icon: '🔍'
  },
  {
    name: 'Appreciative Inquiry',
    type: 'tool',
    description: 'Discover and amplify what works well by asking positive questions.',
    icon: '💎'
  },
  {
    name: 'Fishbowl',
    type: 'tool',
    description: 'Enable diverse participants to have a transparent conversation.',
    icon: '🐟'
  },
  {
    name: 'World Café',
    type: 'tool',
    description: 'Enable larger groups to have intimate conversations around questions that matter.',
    icon: '☕'
  },
  {
    name: 'Min Specs',
    type: 'tool',
    description: 'Specify only absolute must-dos and must-not-dos to unleash innovation.',
    icon: '📝'
  },
  {
    name: 'Heard, Seen, Respected',
    type: 'tool',
    description: 'Practice deeper listening and empathy with colleagues.',
    icon: '👂'
  }
];

/**
 * Default chromosomes for Practices category - Real community practices
 */
export const defaultPractices: SeedChromosome[] = [
  {
    name: 'Weekly Community Calls',
    type: 'practice',
    description: 'We gather weekly to share updates, align on priorities, and strengthen connections across the network.',
    icon: '📞'
  },
  {
    name: 'Monthly Retrospectives',
    type: 'practice',
    description: 'We reflect together on what worked, what didn\'t, and how we can improve using structured reflection tools.',
    icon: '🔍'
  },
  {
    name: 'Rotating Facilitation',
    type: 'practice',
    description: 'Leadership and facilitation roles rotate regularly to distribute power and build collective capacity.',
    icon: '🔁'
  },
  {
    name: 'Documentation First',
    type: 'practice',
    description: 'We document decisions, processes, and knowledge transparently for continuity and shared understanding.',
    icon: '📝'
  },
  {
    name: 'Open Source Everything',
    type: 'practice',
    description: 'We share our work openly and contribute to the commons whenever possible, building on collective intelligence.',
    icon: '🌍'
  },
  {
    name: 'Celebration Rituals',
    type: 'practice',
    description: 'We regularly celebrate achievements, milestones, and each other\'s contributions to cultivate appreciation.',
    icon: '🎉'
  },
  {
    name: 'Skill Sharing Sessions',
    type: 'practice',
    description: 'Members regularly teach and learn from each other to build collective capacity and cross-pollinate knowledge.',
    icon: '🎓'
  },
  {
    name: 'Regenerative Economics',
    type: 'practice',
    description: 'We practice economic models that regenerate rather than extract, using gift economy and solidarity principles.',
    icon: '♻️'
  },
  {
    name: 'Non-Violent Communication',
    type: 'practice',
    description: 'We communicate with empathy, honesty, and respect using NVC practices in all our interactions.',
    icon: '💚'
  },
  {
    name: 'Consensus Workshops',
    type: 'practice',
    description: 'We facilitate collaborative workshops to align on vision and strategy using consent-based decision making.',
    icon: '🧩'
  }
];

/**
 * Get all default chromosomes
 */
export function getAllDefaultChromosomes(): SeedChromosome[] {
  return [...defaultValues, ...defaultTools, ...defaultPractices];
}

/**
 * Get default chromosomes by type
 */
export function getDefaultChromosomesByType(type: ChromosomeType): SeedChromosome[] {
  switch (type) {
    case 'value':
      return defaultValues;
    case 'tool':
      return defaultTools;
    case 'practice':
      return defaultPractices;
    default:
      return [];
  }
}
