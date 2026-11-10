import { useEffect, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { data, useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { isDemoMode } from "../lib/ai.server";
import { createDraft } from "../lib/drafts.server";
import { getProduct, toGid, updateProductCopy } from "../lib/products.server";
import { sanitizeHtml } from "../lib/copy";
import {
  DateTime,
  capitalize,
  fieldValue,
  modelLabel,
  statusBadge,
} from "../lib/ui";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const gid = toGid(params.id || "");
  const product = await getProduct(admin, gid);
  if (!product) throw new Response("Product not found", { status: 404 });

  const history = await db.generation.findMany({
    where: { shop: session.shop, productId: gid },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  return {
    product,
    shop: session.shop,
    demoMode: isDemoMode(),
    history: history.map((g) => ({
      id: g.id,
      status: g.status,
      model: g.model,
      createdAt: g.createdAt.toISOString(),
      descriptionHtml: g.descriptionHtml,
      seoTitle: g.seoTitle,
      seoDescription: g.seoDescription,
      highlights: JSON.parse(g.highlights) as string[],
    })),
  };
};

type ActionResult =
  | { ok: true; intent: "generate"; draft: Draft }
  | { ok: true; intent: "apply" | "revert" }
  | { ok: false; error: string };

interface Draft {
  id: string;
  descriptionHtml: string;
  seoTitle: string;
  seoDescription: string;
  highlights: string[];
  model: string;
}

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const gid = toGid(params.id || "");
  const form = await request.formData();
  const intent = String(form.get("intent"));

  try {
    const product = await getProduct(admin, gid);
    if (!product) throw new Error("Product not found");

    if (intent === "generate") {
      const draft = await createDraft(session.shop, product);
      return { ok: true, intent, draft } satisfies ActionResult;
    }

    const generation = await db.generation.findFirst({
      where: {
        id: String(form.get("generationId")),
        shop: session.shop,
        productId: gid,
      },
    });
    if (!generation) throw new Error("Draft not found");

    if (intent === "apply") {
      // The merchant may have edited the draft before applying it.
      const copy = {
        descriptionHtml: sanitizeHtml(
          String(form.get("descriptionHtml") ?? generation.descriptionHtml),
        ),
        seoTitle: String(form.get("seoTitle") ?? generation.seoTitle).slice(
          0,
          70,
        ),
        seoDescription: String(
          form.get("seoDescription") ?? generation.seoDescription,
        ).slice(0, 320),
      };
      await updateProductCopy(admin, gid, copy);
      await db.generation.update({
        where: { id: generation.id },
        data: { ...copy, status: "applied", appliedAt: new Date() },
      });
      return { ok: true, intent } satisfies ActionResult;
    }

    if (intent === "revert") {
      await updateProductCopy(admin, gid, {
        descriptionHtml: generation.previousHtml,
        seoTitle: generation.previousSeoTitle || "",
        seoDescription: generation.previousSeoDesc || "",
      });
      await db.generation.update({
        where: { id: generation.id },
        data: { status: "reverted" },
      });
      return { ok: true, intent } satisfies ActionResult;
    }

    throw new Error("Unknown action");
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Something went wrong";
    return data({ ok: false, error: message } satisfies ActionResult, {
      status: 400,
    });
  }
};

const SEO_TITLE_LIMIT = 60;
const SEO_DESCRIPTION_LIMIT = 155;

export default function ProductCopyPage() {
  const { product, history, shop, demoMode } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  // The draft on screen is derived from loader data, so it updates on its own
  // after each action revalidates: the newest unapplied draft, or one the
  // merchant opened from version history. Local edits are kept per draft.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, Partial<Draft>>>({});
  const [view, setView] = useState<"preview" | "html">("preview");

  const baseDraft =
    history.find((h) => h.id === selectedId && h.status === "draft") ??
    (history[0]?.status === "draft" ? history[0] : null);
  const draft = baseDraft ? { ...baseDraft, ...edits[baseDraft.id] } : null;
  const edited = Boolean(baseDraft && edits[baseDraft.id]);
  const setDraft = (patch: Partial<Draft>) =>
    baseDraft &&
    setEdits((e) => ({
      ...e,
      [baseDraft.id]: { ...e[baseDraft.id], ...patch },
    }));

  const busyIntent =
    fetcher.state !== "idle" ? String(fetcher.formData?.get("intent")) : null;
  const generating = busyIntent === "generate";
  const result = fetcher.data;

  useEffect(() => {
    if (fetcher.state !== "idle" || !result) return;
    if (!result.ok) shopify.toast.show(result.error, { isError: true });
    else if (result.intent === "generate")
      shopify.toast.show("New draft ready");
    else if (result.intent === "apply") shopify.toast.show("Saved to Shopify");
    else shopify.toast.show("Previous copy restored");
  }, [fetcher.state, result, shopify]);

  const generate = () => {
    setSelectedId(null);
    setView("preview");
    fetcher.submit({ intent: "generate" }, { method: "POST" });
  };
  const apply = () =>
    draft &&
    fetcher.submit(
      {
        intent: "apply",
        generationId: draft.id,
        descriptionHtml: draft.descriptionHtml,
        seoTitle: draft.seoTitle,
        seoDescription: draft.seoDescription,
      },
      { method: "POST" },
    );
  const revert = (generationId: string) =>
    fetcher.submit({ intent: "revert", generationId }, { method: "POST" });

  const lastApplied = history.find((h) => h.status === "applied");
  // Polaris treats any value of a boolean attribute as true, so these are
  // spread in only when they apply.
  const loadingIf = (intent: string) =>
    busyIntent === intent ? { loading: true } : {};
  const disabledIf = (condition: boolean) =>
    condition ? { disabled: true } : {};

  return (
    <s-page heading={product.title} inlineSize="large">
      <s-link slot="breadcrumb-actions" href="/app">
        Products
      </s-link>
      <s-button
        slot="primary-action"
        variant="primary"
        icon="wand"
        onClick={generate}
        {...loadingIf("generate")}
        {...disabledIf(busyIntent !== null && !generating)}
      >
        {draft ? "Write another version" : "Write with AI"}
      </s-button>
      <s-button
        slot="secondary-actions"
        href={`shopify://admin/products/${product.numericId}`}
      >
        Edit in Shopify
      </s-button>

      {demoMode && (
        <s-banner tone="info">
          Demo mode: drafts come from a template until ANTHROPIC_API_KEY is set.
        </s-banner>
      )}

      <s-section heading="AI draft">
        {generating ? (
          <s-box padding="large-200">
            <s-stack direction="block" gap="base" alignItems="center">
              <s-spinner accessibilityLabel="Writing a draft" size="large" />
              <s-heading>Writing your draft</s-heading>
              <s-paragraph color="subdued">
                Claude is reading the product and your brand voice. This usually
                takes 10 to 30 seconds.
              </s-paragraph>
            </s-stack>
          </s-box>
        ) : !draft ? (
          <s-box padding="large-200">
            <s-stack direction="block" gap="base" alignItems="center">
              <s-icon type="wand" color="subdued" />
              <s-heading>No draft yet</s-heading>
              <s-paragraph color="subdued">
                Descripta reads this product&apos;s title, type, options, tags
                and current description, then writes a new description and SEO
                listing in your brand voice. Nothing changes in your store until
                you apply it.
              </s-paragraph>
              <s-button variant="primary" icon="wand" onClick={generate}>
                Write with AI
              </s-button>
            </s-stack>
          </s-box>
        ) : (
          <s-stack direction="block" gap="large">
            <s-stack
              direction="inline"
              gap="small"
              alignItems="center"
              justifyContent="space-between"
            >
              <s-stack direction="inline" gap="small-200" alignItems="center">
                <s-badge tone="info">Not published</s-badge>
                {edited && <s-badge tone="caution">Edited</s-badge>}
                <s-text color="subdued">
                  {modelLabel(draft.model)} · <DateTime iso={draft.createdAt} />
                </s-text>
              </s-stack>
              <s-button-group gap="none" accessibilityLabel="Draft view">
                <s-button
                  slot="secondary-actions"
                  icon="view"
                  {...(view === "preview" ? { variant: "primary" } : {})}
                  onClick={() => setView("preview")}
                >
                  Preview
                </s-button>
                <s-button
                  slot="secondary-actions"
                  icon="code"
                  {...(view === "html" ? { variant: "primary" } : {})}
                  onClick={() => setView("html")}
                >
                  Edit HTML
                </s-button>
              </s-button-group>
            </s-stack>

            {view === "preview" ? (
              <HtmlPreview html={draft.descriptionHtml} />
            ) : (
              <s-text-area
                label="Description HTML"
                labelAccessibilityVisibility="exclusive"
                rows={14}
                value={draft.descriptionHtml}
                onInput={(e) => setDraft({ descriptionHtml: fieldValue(e) })}
              />
            )}

            {draft.highlights.length > 0 && (
              <s-stack direction="block" gap="small-200">
                <s-text type="strong">Selling points Claude focused on</s-text>
                <s-stack direction="inline" gap="small-200">
                  {draft.highlights.map((h) => (
                    <s-badge key={h}>{h}</s-badge>
                  ))}
                </s-stack>
              </s-stack>
            )}

            <s-divider />

            <s-stack direction="block" gap="base">
              <s-heading>Search engine listing</s-heading>
              <s-text-field
                label="Page title"
                value={draft.seoTitle}
                details={limitDetails(draft.seoTitle, SEO_TITLE_LIMIT)}
                onInput={(e) => setDraft({ seoTitle: fieldValue(e) })}
              />
              <s-text-area
                label="Meta description"
                rows={3}
                value={draft.seoDescription}
                details={limitDetails(
                  draft.seoDescription,
                  SEO_DESCRIPTION_LIMIT,
                )}
                onInput={(e) => setDraft({ seoDescription: fieldValue(e) })}
              />
              <SerpPreview
                shop={shop}
                handle={product.handle}
                title={draft.seoTitle}
                description={draft.seoDescription}
              />
            </s-stack>

            <s-divider />

            <s-stack
              direction="inline"
              gap="base"
              alignItems="center"
              justifyContent="space-between"
            >
              <s-text color="subdued">
                Your current copy is kept, so you can undo this later.
              </s-text>
              <s-button
                variant="primary"
                icon="check"
                onClick={apply}
                {...loadingIf("apply")}
                {...disabledIf(busyIntent !== null && busyIntent !== "apply")}
              >
                Apply to product
              </s-button>
            </s-stack>
          </s-stack>
        )}
      </s-section>

      <s-section heading="Live on your store">
        <s-stack direction="block" gap="large">
          <HtmlPreview
            html={product.descriptionHtml}
            empty="This product has no description yet."
          />
          <s-stack direction="block" gap="small">
            <s-text type="strong">Search engine listing</s-text>
            <SerpPreview
              shop={shop}
              handle={product.handle}
              title={product.seoTitle || product.title}
              description={product.seoDescription || ""}
            />
          </s-stack>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Product details">
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="base" alignItems="center">
            <s-thumbnail
              size="base"
              src={product.imageUrl || undefined}
              alt={product.imageAlt || product.title}
            />
            <s-stack direction="block" gap="small-300">
              <s-text type="strong">{product.title}</s-text>
              <s-text color="subdued">
                {capitalize(product.status)} · {product.descriptionWords} words
              </s-text>
            </s-stack>
          </s-stack>
          <s-divider />
          <s-stack direction="block" gap="small">
            <Fact label="Type" value={product.productType} />
            <Fact label="Vendor" value={product.vendor} />
            <Fact label="Tags" value={product.tags.join(", ")} />
            <Fact
              label="Options"
              value={product.options
                .filter((o) => o.name !== "Title")
                .map((o) => `${o.name}: ${o.values.join(", ")}`)
                .join(" · ")}
            />
            <Fact
              label="Price from"
              value={
                product.price ? `${product.price} ${product.currencyCode}` : ""
              }
            />
          </s-stack>
          <s-paragraph color="subdued">
            Claude uses these facts and your{" "}
            <s-link href="/app/voice">brand voice</s-link>.
          </s-paragraph>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Version history">
        {history.length === 0 ? (
          <s-paragraph color="subdued">
            Drafts you write for this product will appear here.
          </s-paragraph>
        ) : (
          <s-stack direction="block" gap="small">
            {history.map((h, i) => {
              const badge = statusBadge(h.status);
              const current = draft?.id === h.id;
              return (
                <s-stack key={h.id} direction="block" gap="small">
                  {i > 0 && <s-divider />}
                  <s-stack
                    direction="inline"
                    gap="small"
                    alignItems="center"
                    justifyContent="space-between"
                  >
                    <s-stack direction="block" gap="small-300">
                      <s-stack
                        direction="inline"
                        gap="small-200"
                        alignItems="center"
                      >
                        <s-badge tone={badge.tone}>{badge.label}</s-badge>
                        {current && <s-text color="subdued">Viewing</s-text>}
                      </s-stack>
                      <s-text color="subdued">
                        <DateTime iso={h.createdAt} />
                      </s-text>
                    </s-stack>
                    {h.status === "draft" && !current && (
                      <s-button
                        variant="tertiary"
                        onClick={() => {
                          setSelectedId(h.id);
                          setView("preview");
                        }}
                      >
                        Open
                      </s-button>
                    )}
                    {h.id === lastApplied?.id && (
                      <s-button
                        variant="tertiary"
                        tone="critical"
                        icon="undo"
                        onClick={() => revert(h.id)}
                        {...loadingIf("revert")}
                      >
                        Undo
                      </s-button>
                    )}
                  </s-stack>
                </s-stack>
              );
            })}
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}

function limitDetails(value: string, limit: number) {
  const length = value.length;
  return length > limit
    ? `${length} of ${limit} characters. Search engines may cut off the rest.`
    : `${length} of ${limit} characters`;
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <s-stack direction="block" gap="none">
      <s-text color="subdued">{label}</s-text>
      <s-text>{value || "Not set"}</s-text>
    </s-stack>
  );
}

function HtmlPreview({ html, empty }: { html: string; empty?: string }) {
  if (!html.trim()) {
    return (
      <s-box padding="base" borderWidth="base" borderRadius="base">
        <s-text color="subdued">{empty}</s-text>
      </s-box>
    );
  }
  return (
    <s-box padding="large-100" borderWidth="base" borderRadius="base">
      {/* Rendered through an allowlist sanitiser, so only simple formatting tags survive. */}
      <div
        className="descripta-preview"
        dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }}
      />
    </s-box>
  );
}

const truncate = (text: string, limit: number) =>
  text.length > limit ? `${text.slice(0, limit).trimEnd()} ...` : text;

function SerpPreview({
  shop,
  handle,
  title,
  description,
}: {
  shop: string;
  handle: string;
  title: string;
  description: string;
}) {
  return (
    <s-box
      padding="base"
      borderWidth="base"
      borderRadius="base"
      background="subdued"
    >
      <div className="descripta-serp">
        <div className="descripta-serp__url">
          {shop.replace(".myshopify.com", "")} › products › {handle}
        </div>
        <div className="descripta-serp__title">
          {truncate(title || "Untitled", SEO_TITLE_LIMIT)}
        </div>
        <div
          className={`descripta-serp__description${description ? "" : " descripta-serp__empty"}`}
        >
          {description
            ? truncate(description, SEO_DESCRIPTION_LIMIT)
            : "No meta description. Search engines will pick text from the page."}
        </div>
      </div>
    </s-box>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
