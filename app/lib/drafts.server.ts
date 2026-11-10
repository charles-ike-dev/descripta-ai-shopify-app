import db from "../db.server";
import { generateCopy } from "./ai.server";
import { type ProductDetail, toProductInput } from "./products.server";
import { getVoice } from "./voice.server";

/**
 * Writes new copy for a product in the shop's brand voice and stores it as a
 * draft. The product's current copy is saved alongside so it can be restored.
 */
export async function createDraft(shop: string, product: ProductDetail) {
  const voice = await getVoice(shop);
  const copy = await generateCopy(toProductInput(product), voice);
  const saved = await db.generation.create({
    data: {
      shop,
      productId: product.id,
      productTitle: product.title,
      previousHtml: product.descriptionHtml,
      previousSeoTitle: product.seoTitle,
      previousSeoDesc: product.seoDescription,
      descriptionHtml: copy.descriptionHtml,
      seoTitle: copy.seoTitle,
      seoDescription: copy.seoDescription,
      highlights: JSON.stringify(copy.highlights),
      model: copy.model,
    },
  });
  return { id: saved.id, ...copy };
}
