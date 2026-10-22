// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Linking this screen's key to the person's Telegram account, from the
// screen's side: the key is here, so the proof is signed and published here
// (@holons/core/users owns the offer, the note and the payload); Telegram
// only has to tap the deep link, and the bot links the key to whoever
// tapped. Nothing secret leaves the device — the note carries a code.
import {
  buildKeyLinkOffer,
  keyLinkDeepLinkPayload,
  keyLinkProofTemplate,
  type KeyLinkOffer,
} from "@holons/core/users";
import { botChatUrl } from "./config";
import { getHolosphere } from "./holosphere";
import { sessionSigner } from "./hubmembers";

export type KeyLinkHandoff = { offer: KeyLinkOffer; url: string };

/** Publish the proof for the session key and return the Telegram link to tap. */
export async function offerKeyLink(): Promise<KeyLinkHandoff> {
  const signer = sessionSigner();
  if (!signer) throw new Error("No key is signed in on this device");
  const hs = await getHolosphere();
  const offer = buildKeyLinkOffer(signer.pubkey);
  hs.publishNostrEvents(signer.sign(keyLinkProofTemplate(offer)));
  return { offer, url: botChatUrl(keyLinkDeepLinkPayload(offer)) };
}
