export const ssr = false;
export const prerender = false;

import type { LayoutLoad } from "./$types";

export const load: LayoutLoad = async ({ url }) => {
  // Accept private key as URL parameter for direct access from safe environments
  const key = url.searchParams.get("key");

  return {
    urlPrivateKey: key,
  };
};
