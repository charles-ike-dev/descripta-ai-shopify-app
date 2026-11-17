import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { generateCopy } from "./ai.server";
import {
  APPLY_CONCURRENCY,
  type ApplyResult,
  type CopyFields,
  copyChanged,
  copyToApply,
  mapLimit,
} from "./apply";
import type { GeneratedCopy } from "./copy";
import {
  type ProductDetail,
  getProduct,
  toProductInput,
  updateProductCopy,
} from "./products.server";
import { getVoice } from "./voice.server";

/** Writes new copy for a product in the shop's brand voice. */
export async function writeCopy(shop: string, product: ProductDetail) {
  const voice = await getVoice(shop);
  return generateCopy(toProductInput(product), voice);
}

/**
 * The draft row for new copy. The product's current copy is saved alongside
 * so it can be restored.
 */
export function draftRecord(
  shop: string,
  product: ProductDetail,
  copy: GeneratedCopy,
) {
  return {
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
  };
}

/** Writes new copy for a product and stores it as a draft. */
export async function createDraft(shop: string, product: ProductDetail) {
  const copy = await writeCopy(shop, product);
  const saved = await db.generation.create({
    data: draftRecord(shop, product, copy),
  });
  return { id: saved.id, ...copy };
}

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const failure = (id: string, error: unknown, stale = false): ApplyResult => ({
  id,
  ok: false,
  stale,
  error: message(error),
});

/**
 * Saves a draft to its product. Unless `force` is set, a product whose copy
 * changed since Descripta last saw it is left alone and reported as stale, so
 * a merchant's own edit is never overwritten without asking.
 */
export async function applyDraft(
  admin: AdminApiContext,
  shop: string,
  generationId: string,
  opts: {
    edits?: Partial<CopyFields>;
    batchId?: string;
    force?: boolean;
    productId?: string;
  } = {},
): Promise<ApplyResult> {
  try {
    const generation = await db.generation.findFirst({
      where: {
        id: generationId,
        shop,
        ...(opts.productId ? { productId: opts.productId } : {}),
      },
    });
    if (!generation) throw new Error("Draft not found");
    if (generation.status !== "draft") {
      throw new Error("This draft was already applied or discarded");
    }

    const product = await getProduct(admin, generation.productId);
    if (!product) throw new Error("Product no longer exists");
    if (!opts.force) {
      // Copy Descripta itself put on the product is not an edit, so a draft
      // written before another draft was applied can still go on safely.
      const lastApplied = await db.generation.findFirst({
        where: {
          shop,
          productId: generation.productId,
          status: "applied",
          appliedHtml: { not: null },
        },
        orderBy: { appliedAt: "desc" },
      });
      const known = [
        {
          descriptionHtml: generation.previousHtml,
          seoTitle: generation.previousSeoTitle,
          seoDescription: generation.previousSeoDesc,
        },
        ...(lastApplied?.appliedHtml
          ? [{ ...lastApplied, descriptionHtml: lastApplied.appliedHtml }]
          : []),
      ];
      if (known.every((copy) => copyChanged(product, copy))) {
        return failure(
          generationId,
          "The product was edited in Shopify after this draft was written",
          true,
        );
      }
    }

    const copy = copyToApply(generation, opts.edits);
    const saved = await updateProductCopy(admin, generation.productId, copy);

    let recorded: boolean;
    try {
      recorded = await db.$transaction(async (tx) => {
        // Conditional on still being a draft, so two windows applying the
        // same draft at once can't both record it.
        const { count } = await tx.generation.updateMany({
          where: { id: generation.id, status: "draft" },
          data: {
            ...saved,
            // Undo restores what this replaced, which may be newer than the
            // copy the draft was written against.
            previousHtml: product.descriptionHtml,
            previousSeoTitle: product.seoTitle,
            previousSeoDesc: product.seoDescription,
            appliedHtml: saved.descriptionHtml,
            status: "applied",
            appliedAt: new Date(),
            batchId: opts.batchId ?? null,
          },
        });
        if (count === 0) return false;
        // Only one draft per product is live at a time.
        await tx.generation.updateMany({
          where: {
            shop,
            productId: generation.productId,
            status: "applied",
            id: { not: generation.id },
          },
          data: { status: "replaced" },
        });
        return true;
      });
    } catch (error) {
      throw new Error(
        `Saved to Shopify, but the app could not record it, so it can't be undone here (${message(error)})`,
      );
    }
    if (!recorded) {
      throw new Error("This draft was applied from another window just now");
    }
    return { id: generationId, ok: true };
  } catch (error) {
    return failure(generationId, error);
  }
}

/**
 * Restores the copy a draft replaced. Unless `force` is set, a product that
 * was edited after the draft was applied is left alone and reported as stale.
 */
export async function revertDraft(
  admin: AdminApiContext,
  shop: string,
  generationId: string,
  opts: { force?: boolean; productId?: string } = {},
): Promise<ApplyResult> {
  try {
    const generation = await db.generation.findFirst({
      where: {
        id: generationId,
        shop,
        ...(opts.productId ? { productId: opts.productId } : {}),
      },
    });
    if (!generation) throw new Error("Draft not found");
    if (generation.status !== "applied") {
      throw new Error("This draft is not live on the product");
    }

    const product = await getProduct(admin, generation.productId);
    if (!product) throw new Error("Product no longer exists");
    // Drafts applied before appliedHtml existed have nothing to compare with.
    if (
      !opts.force &&
      generation.appliedHtml !== null &&
      copyChanged(product, {
        descriptionHtml: generation.appliedHtml,
        seoTitle: generation.seoTitle,
        seoDescription: generation.seoDescription,
      })
    ) {
      return failure(
        generationId,
        "The product was edited in Shopify after this draft was applied",
        true,
      );
    }

    const restored = await updateProductCopy(admin, generation.productId, {
      descriptionHtml: generation.previousHtml,
      seoTitle: generation.previousSeoTitle || "",
      seoDescription: generation.previousSeoDesc || "",
    });
    await db.$transaction(async (tx) => {
      await tx.generation.update({
        where: { id: generation.id },
        data: { status: "reverted" },
      });
      // If the restored copy is an earlier Descripta draft, that draft is
      // live again and can be undone in turn.
      const earlier = await tx.generation.findFirst({
        where: { shop, productId: generation.productId, status: "replaced" },
        orderBy: { appliedAt: "desc" },
      });
      if (
        earlier?.appliedHtml &&
        !copyChanged(restored, {
          ...earlier,
          descriptionHtml: earlier.appliedHtml,
        })
      ) {
        await tx.generation.update({
          where: { id: earlier.id },
          data: { status: "applied" },
        });
      }
    });
    return { id: generationId, ok: true };
  } catch (error) {
    return failure(generationId, error);
  }
}

/** Applies several drafts as one batch, a few at a time. */
export async function applyDrafts(
  admin: AdminApiContext,
  shop: string,
  generationIds: string[],
  opts: { force?: boolean; batchId: string },
) {
  return mapLimit(generationIds, APPLY_CONCURRENCY, (id) =>
    applyDraft(admin, shop, id, opts),
  );
}

/** Undoes every draft in a batch that is still live. */
export async function revertBatch(
  admin: AdminApiContext,
  shop: string,
  batchId: string,
  opts: { force?: boolean } = {},
) {
  const rows = await db.generation.findMany({
    where: { shop, batchId, status: "applied" },
    select: { id: true },
  });
  return mapLimit(rows, APPLY_CONCURRENCY, (row) =>
    revertDraft(admin, shop, row.id, opts),
  );
}

/** Marks drafts as discarded so they leave the review queue. */
export async function discardDrafts(shop: string, generationIds: string[]) {
  const { count } = await db.generation.updateMany({
    where: { shop, id: { in: generationIds }, status: "draft" },
    data: { status: "discarded" },
  });
  return count;
}

/**
 * Drafts waiting for review: for each product, its newest Descripta entry if
 * that entry is an unapplied draft. Older drafts for the same product are
 * superseded, so they never come back once the newest is applied or
 * discarded. Newest first.
 *
 * Reads only draft rows plus one grouped query, because this runs on every
 * page load for the badge in the app menu.
 */
export async function pendingDraftIds(shop: string) {
  const drafts = await db.generation.findMany({
    where: { shop, status: "draft" },
    orderBy: { createdAt: "desc" },
    distinct: ["productId"],
    select: { id: true, productId: true, createdAt: true },
  });
  if (drafts.length === 0) return [];
  const others = await db.generation.groupBy({
    by: ["productId"],
    where: {
      shop,
      status: { not: "draft" },
      productId: { in: drafts.map((d) => d.productId) },
    },
    _max: { createdAt: true },
  });
  const newestOther = new Map(
    others.map((o) => [o.productId, o._max.createdAt]),
  );
  return drafts
    .filter((d) => {
      const other = newestOther.get(d.productId);
      return !other || other < d.createdAt;
    })
    .map((d) => d.id);
}
