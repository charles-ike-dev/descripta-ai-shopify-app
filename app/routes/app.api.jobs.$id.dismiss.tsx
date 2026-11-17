import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { dismissJob } from "../lib/jobs.server";

/** Hides a run's progress banner, so it doesn't come back on the next visit. */
export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const ok = await dismissJob(session.shop, params.id || "");
  return Response.json({ ok });
};
