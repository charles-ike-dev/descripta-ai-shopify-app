import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";
import { BulkDraftsProvider } from "../lib/bulk";
import { pendingDraftIds } from "../lib/drafts.server";
import { currentJobId } from "../lib/jobs.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const [pending, jobId] = await Promise.all([
    pendingDraftIds(session.shop),
    currentJobId(session.shop),
  ]);

  return {
    // eslint-disable-next-line no-undef
    apiKey: process.env.SHOPIFY_API_KEY || "",
    pending: pending.length,
    jobId,
  };
};

export default function App() {
  const { apiKey, pending, jobId } = useLoaderData<typeof loader>();

  return (
    <AppProvider apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Products</s-link>
        <s-link href="/app/review">
          {pending ? `Review (${pending})` : "Review"}
        </s-link>
        <s-link href="/app/voice">Brand voice</s-link>
        <s-link href="/app/history">History</s-link>
      </s-app-nav>
      <BulkDraftsProvider jobId={jobId}>
        <Outlet />
      </BulkDraftsProvider>
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
