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
  // Deleting a shop's jobs stops the worker from running their items: an item
  // already running finds its row gone and saves nothing.
  await db.$transaction([
    db.jobItem.deleteMany({ where: { shop } }),
    db.job.deleteMany({ where: { shop } }),
    db.scheduledTask.deleteMany({ where: { shop } }),
    db.generation.deleteMany({ where: { shop } }),
    db.brandVoice.deleteMany({ where: { shop } }),
    db.session.deleteMany({ where: { shop } }),
  ]);
}
