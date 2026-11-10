import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { createDraft } from "../lib/drafts.server";
import { getProduct, toGid } from "../lib/products.server";

/**
 * Writes one draft and answers with plain JSON. The bulk runner on the
 * products page calls this once per selected product.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const productId = String(form.get("productId") || "");

  try {
    if (!productId) throw new Error("Missing product");
    const product = await getProduct(admin, toGid(productId));
    if (!product) throw new Error("Product not found");
    const draft = await createDraft(session.shop, product);
    return Response.json({ ok: true, draftId: draft.id });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Something went wrong";
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
};
