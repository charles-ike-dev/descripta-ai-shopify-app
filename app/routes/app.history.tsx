import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { toNumericId } from "../lib/products.server";
import { DateTime, modelLabel, statusBadge } from "../lib/ui";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const rows = await db.generation.findMany({
    where: { shop: session.shop },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      productId: true,
      productTitle: true,
      seoTitle: true,
      status: true,
      model: true,
      createdAt: true,
      appliedAt: true,
    },
  });
  return {
    rows: rows.map((r) => ({
      ...r,
      numericId: toNumericId(r.productId),
      createdAt: r.createdAt.toISOString(),
      appliedAt: r.appliedAt?.toISOString() ?? null,
    })),
  };
};

export default function HistoryPage() {
  const { rows } = useLoaderData<typeof loader>();
  const applied = rows.filter((r) => r.status === "applied").length;

  return (
    <s-page heading="History">
      {rows.length === 0 ? (
        <s-section>
          <s-box padding="large-200">
            <s-stack direction="block" gap="base" alignItems="center">
              <s-icon type="clock" color="subdued" />
              <s-heading>No drafts yet</s-heading>
              <s-paragraph color="subdued">
                Every draft Descripta writes is listed here, so you can see what
                changed and roll it back.
              </s-paragraph>
              <s-button variant="primary" icon="wand" href="/app">
                Pick a product
              </s-button>
            </s-stack>
          </s-box>
        </s-section>
      ) : (
        <s-section padding="none" accessibilityLabel="Draft history">
          <s-box padding="base">
            <s-text color="subdued">
              Your last {rows.length} drafts, {applied} applied to products.
            </s-text>
          </s-box>
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Product</s-table-header>
              <s-table-header listSlot="secondary">SEO title</s-table-header>
              <s-table-header listSlot="inline">Status</s-table-header>
              <s-table-header>Written by</s-table-header>
              <s-table-header>Created</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {rows.map((r) => {
                const badge = statusBadge(r.status);
                return (
                  <s-table-row key={r.id}>
                    <s-table-cell>
                      <s-link href={`/app/products/${r.numericId}`}>
                        {r.productTitle}
                      </s-link>
                    </s-table-cell>
                    <s-table-cell>
                      <s-text color={r.seoTitle ? "base" : "subdued"}>
                        {r.seoTitle || "None"}
                      </s-text>
                    </s-table-cell>
                    <s-table-cell>
                      <s-badge tone={badge.tone}>{badge.label}</s-badge>
                    </s-table-cell>
                    <s-table-cell>{modelLabel(r.model)}</s-table-cell>
                    <s-table-cell>
                      <DateTime iso={r.createdAt} />
                    </s-table-cell>
                  </s-table-row>
                );
              })}
            </s-table-body>
          </s-table>
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
