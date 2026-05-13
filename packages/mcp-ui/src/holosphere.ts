// Both vars come from the monorepo root .env (loaded in src/index.ts).
// Default to dev namespace if unset.
const PEER = process.env.HOLONS_PEER || 'https://gun.holons.io/gun';
const APP = process.env.HOLONS_APP || 'HolonsDebug';

let hs: any;
export async function getHoloSphere(): Promise<any> {
  if (hs) return hs;
  const mod: any = await import('holosphere');
  const HoloSphere = mod.HoloSphere || mod.default;
  hs = new HoloSphere(APP, false, null, { peers: [PEER] });
  await new Promise((r) => setTimeout(r, 1500));
  return hs;
}

export function getApp(): string {
  return APP;
}
