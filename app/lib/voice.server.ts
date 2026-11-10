import db from "../db.server";
import { DEFAULT_VOICE, type VoiceInput } from "./copy";

export async function getVoice(shop: string): Promise<VoiceInput> {
  const voice = await db.brandVoice.findUnique({ where: { shop } });
  if (!voice) return DEFAULT_VOICE;
  return {
    brandName: voice.brandName,
    tone: voice.tone,
    audience: voice.audience,
    length: voice.length,
    language: voice.language,
    keywords: voice.keywords,
    avoidWords: voice.avoidWords,
  };
}

/** Deletes everything the app stores for a shop (uninstall and GDPR shop/redact). */
export async function deleteShopData(shop: string) {
  await db.$transaction([
    db.generation.deleteMany({ where: { shop } }),
    db.brandVoice.deleteMany({ where: { shop } }),
    db.session.deleteMany({ where: { shop } }),
  ]);
}
