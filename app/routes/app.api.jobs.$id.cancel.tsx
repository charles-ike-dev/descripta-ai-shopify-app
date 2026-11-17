import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { cancelJob } from "../lib/jobs.server";

/** Cancels the items that haven't started. Items already running finish. */
export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const ok = await cancelJob(session.shop, params.id || "");
  return Response.json({ ok }, { status: ok ? 200 : 404 });
};
