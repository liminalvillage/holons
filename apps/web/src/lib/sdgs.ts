// Sustainable Development Goals metadata
// Titles per UN and official brand colors

export type SDG = {
  number: number;
  code: string; // e.g., sdg1
  title: string;
  color: string; // hex
  imageRemote?: string; // official icon URL
  imageLocal?: string; // path under /static or /public if added later
};

// Official brand colors (hex) from UN brand guidelines
// 1-17
export const sdgs: SDG[] = [
  { number: 1, code: 'sdg1', title: 'No Poverty', color: '#E5243B' },
  { number: 2, code: 'sdg2', title: 'Zero Hunger', color: '#DDA63A' },
  { number: 3, code: 'sdg3', title: 'Good Health and Well-Being', color: '#4C9F38' },
  { number: 4, code: 'sdg4', title: 'Quality Education', color: '#C5192D' },
  { number: 5, code: 'sdg5', title: 'Gender Equality', color: '#FF3A21' },
  { number: 6, code: 'sdg6', title: 'Clean Water and Sanitation', color: '#26BDE2' },
  { number: 7, code: 'sdg7', title: 'Affordable and Clean Energy', color: '#FCC30B' },
  { number: 8, code: 'sdg8', title: 'Decent Work and Economic Growth', color: '#A21942' },
  { number: 9, code: 'sdg9', title: 'Industry, Innovation and Infrastructure', color: '#FD6925' },
  { number: 10, code: 'sdg10', title: 'Reduced Inequalities', color: '#DD1367' },
  { number: 11, code: 'sdg11', title: 'Sustainable Cities and Communities', color: '#FD9D24' },
  { number: 12, code: 'sdg12', title: 'Responsible Consumption and Production', color: '#BF8B2E' },
  { number: 13, code: 'sdg13', title: 'Climate Action', color: '#3F7E44' },
  { number: 14, code: 'sdg14', title: 'Life Below Water', color: '#0A97D9' },
  { number: 15, code: 'sdg15', title: 'Life on Land', color: '#56C02B' },
  { number: 16, code: 'sdg16', title: 'Peace, Justice and Strong Institutions', color: '#00689D' },
  { number: 17, code: 'sdg17', title: 'Partnerships for the Goals', color: '#19486A' }
].map((g) => ({
  ...g,
  // Local path you can populate later with actual files (optional)
  imageLocal: `/assets/images/sdgs/${String(g.number).padStart(2, '0')}.jpg`,
  // Remote fallback (patterned URL; replace if you add local files)
  imageRemote: `https://sdgs.un.org/sites/default/files/goals/E_SDG_Icons-${String(g.number).padStart(2, '0')}.jpg`
}));

export function getSdgByCode(code: string): SDG | undefined {
  return sdgs.find((g) => g.code === code);
}

export function getSdgByNumber(n: number): SDG | undefined {
  return sdgs.find((g) => g.number === n);
}

export function getSdgHolonId(g: SDG): string {
  // Holon ID format for SDGs
  return `SDG-${String(g.number).padStart(2, '0')}`;
}


