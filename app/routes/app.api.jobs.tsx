import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { authenticate } from "../shopify.server";
import { createJob, unfinishedJobId } from "../lib/jobs.server";
import { MAX_BULK } from "../lib/jobs";
import { toGid } from "../lib/products.server";

const Body = z.object({
  products: z
    .array(z.object({ id: z.string().min(1), title: z.string() }))
    .min(1)
    .max(MAX_BULK),
});

/**
 * Starts a bulk draft run on the server and answers with its id. The worker
 * writes the drafts, and the products page polls for progress.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return Response.json(
      { ok: false, error: `Choose between 1 and ${MAX_BULK} products` },
      { status: 400 },
    );
  }

  // One run at a time, so a second tab can't double the cost or start a run
  // the products page never shows. The page switches to the running one.
  const running = await unfinishedJobId(session.shop, "draft");
  if (running) {
    return Response.json(
      { ok: false, error: "A bulk run is already going", jobId: running },
      { status: 409 },
    );
  }

  // The same product twice would just write two drafts for it.
  const products = [
    ...new Map(body.data.products.map((p) => [toGid(p.id), p.title])),
  ].map(([id, title]) => ({ id, title: title.slice(0, 255) }));
  const job = await createJob(session.shop, "draft", products);
  return Response.json({ ok: true, jobId: job.id });
};
