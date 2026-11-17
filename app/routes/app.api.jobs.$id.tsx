import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getBulkJob } from "../lib/jobs.server";

/** A job's progress and the status of each item, for polling. */
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const job = await getBulkJob(session.shop, params.id || "");
  if (!job) return Response.json({ error: "Job not found" }, { status: 404 });
  return Response.json(job);
};
