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
import {
  type ApplyResult,
  MAX_APPLY,
  copyChanged,
  plural,
  summarize,
} from "../lib/apply";
import { wordCount } from "../lib/copy";
import {
  applyDrafts,
  discardDrafts,
  pendingDraftIds,
  revertBatch,
} from "../lib/drafts.server";
import { getProductsByIds, toNumericId } from "../lib/products.server";
import {
  DateTime,
  HtmlPreview,
  SelectBox,
  modelLabel,
  useElementEvents,
} from "../lib/ui";

/** Drafts shown at once. Each row carries two descriptions, so keep it modest. */
const QUEUE_LIMIT = 100;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const pending = await pendingDraftIds(session.shop);
  const drafts = await db.generation.findMany({
    where: { shop: session.shop, id: { in: pending.slice(0, QUEUE_LIMIT) } },
    orderBy: { createdAt: "desc" },
  });
  const products = await getProductsByIds(
    admin,
    drafts.map((d) => d.productId),
  );
  const byId = new Map(products.map((p) => [p.id, p]));

  return {
    total: pending.length,
    rows: drafts.map((d) => {
      const product = byId.get(d.productId);
      const current = product ?? {
        descriptionHtml: d.previousHtml,
        seoTitle: d.previousSeoTitle,
        seoDescription: d.previousSeoDesc,
      };
      return {
        id: d.id,
        numericId: toNumericId(d.productId),
        title: product?.title ?? d.productTitle,
        imageUrl: product?.imageUrl ?? null,
        imageAlt: product?.imageAlt ?? null,
        missing: !product,
        // Edited in Shopify since the draft was written: applying would
        // replace those edits, so the merchant is asked first.
        stale: product
          ? copyChanged(product, {
              descriptionHtml: d.previousHtml,
              seoTitle: d.previousSeoTitle,
              seoDescription: d.previousSeoDesc,
            })
          : false,
        current: {
          descriptionHtml: current.descriptionHtml,
          seoTitle: current.seoTitle ?? "",
          seoDescription: current.seoDescription ?? "",
          words: wordCount(current.descriptionHtml),
        },
        draft: {
          descriptionHtml: d.descriptionHtml,
          seoTitle: d.seoTitle,
          seoDescription: d.seoDescription,
          words: wordCount(d.descriptionHtml),
        },
        model: d.model,
        createdAt: d.createdAt.toISOString(),
      };
    }),
  };
};

type ActionResult =
  | {
      ok: true;
      intent: "apply" | "undoBatch";
      batchId: string;
      results: ApplyResult[];
    }
  | { ok: true; intent: "discard"; count: number }
  | { ok: false; error: string };

interface ActionBody {
  intent?: string;
  ids?: unknown;
  batchId?: unknown;
  force?: unknown;
}

/**
 * Applies, discards or undoes drafts in bulk. Also used by the History page
 * to undo a batch. Takes JSON: { intent, ids?, batchId?, force? }.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const body = ((await request.json().catch(() => null)) ?? {}) as ActionBody;
  const ids = Array.isArray(body.ids) ? [...new Set(body.ids.map(String))] : [];
  const force = body.force === true;
  const fail = (error: string) =>
    data({ ok: false, error } satisfies ActionResult, { status: 400 });

  try {
    if (body.intent === "apply") {
      if (ids.length === 0) return fail("Select at least one draft");
      if (ids.length > MAX_APPLY) {
        return fail(`Apply up to ${MAX_APPLY} drafts at a time`);
      }
      // Each request is its own batch, so "Undo" on the result banner undoes
      // exactly what that request applied.
      const batchId = crypto.randomUUID();
      const results = await applyDrafts(admin, session.shop, ids, {
        batchId,
        force,
      });
      return {
        ok: true,
        intent: "apply",
        batchId,
        results,
      } satisfies ActionResult;
    }

    if (body.intent === "discard") {
      if (ids.length === 0) return fail("Select at least one draft");
      const count = await discardDrafts(session.shop, ids);
      return { ok: true, intent: "discard", count } satisfies ActionResult;
    }

    if (body.intent === "undoBatch") {
      if (typeof body.batchId !== "string" || !body.batchId) {
        return fail("Missing batch");
      }
      const results = await revertBatch(admin, session.shop, body.batchId, {
        force,
      });
      return {
        ok: true,
        intent: "undoBatch",
        batchId: body.batchId,
        results,
      } satisfies ActionResult;
    }

    return fail("Unknown action");
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Something went wrong",
    );
  }
};

type Row = ReturnType<typeof useLoaderData<typeof loader>>["rows"][number];

/** What the last apply or undo did, shown until the merchant dismisses it. */
interface Outcome {
  intent: "apply" | "undoBatch";
  batchId: string;
  done: number;
  stale: string[];
  failed: { id: string; error: string }[];
}

function toOutcome(result: ActionResult | undefined): Outcome | null {
  if (!result?.ok || result.intent === "discard") return null;
  const s = summarize(result.results);
  return {
    intent: result.intent,
    batchId: result.batchId,
    done: s.done,
    stale: s.stale,
    failed: result.results.flatMap((r) =>
      !r.ok && !r.stale ? [{ id: r.id, error: r.error }] : [],
    ),
  };
}

type Body = {
  intent: "apply" | "discard" | "undoBatch";
  ids?: string[];
  batchId?: string;
  force?: boolean;
};

export default function ReviewPage() {
  const { rows, total } = useLoaderData<typeof loader>();
  // Apply and undo share one fetcher, so the banner always describes the
  // latest of them. Discard has its own so it doesn't clear that banner.
  const fetcher = useFetcher<typeof action>();
  const discarder = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<ActionResult | null>(null);
  // Titles of everything sent to apply, so the banner can name products that
  // have since left the queue.
  const [titles, setTitles] = useState<Record<string, string>>({});

  const applying = fetcher.state !== "idle";
  const discarding = discarder.state !== "idle";
  const busy = applying || discarding;
  const outcome =
    !applying && fetcher.data !== dismissed ? toOutcome(fetcher.data) : null;
  // Applied and discarded drafts leave `rows`, so the selection only ever
  // counts drafts still in the queue.
  const visible = rows.filter((r) => selected.has(r.id)).map((r) => r.id);
  const errors = new Map(outcome?.failed.map((f) => [f.id, f.error]));
  const preview = rows.find((r) => r.id === previewId) ?? null;

  const options = {
    method: "POST",
    action: "/app/review",
    encType: "application/json",
  } as const;
  const submit = (body: Body) => fetcher.submit(body, options);
  const discard = (ids: string[]) =>
    discarder.submit({ intent: "discard", ids } satisfies Body, options);

  const apply = (ids: string[], opts: { force?: boolean } = {}) => {
    setTitles((t) => ({
      ...t,
      ...Object.fromEntries(
        rows.filter((r) => ids.includes(r.id)).map((r) => [r.id, r.title]),
      ),
    }));
    submit({ intent: "apply", ids, ...opts });
  };

  const result = fetcher.data;
  useEffect(() => {
    if (fetcher.state !== "idle" || !result) return;
    if (!result.ok) {
      shopify.toast.show(result.error, { isError: true });
      return;
    }
    const s = toOutcome(result);
    if (!s?.done) return;
    shopify.toast.show(
      s.intent === "apply"
        ? `${plural(s.done, "draft")} applied`
        : `Previous copy restored for ${plural(s.done, "product")}`,
    );
  }, [fetcher.state, result, shopify]);

  const discarded = discarder.data;
  useEffect(() => {
    if (discarder.state !== "idle" || !discarded) return;
    if (!discarded.ok) shopify.toast.show(discarded.error, { isError: true });
    else if (discarded.intent === "discard") {
      shopify.toast.show(`${plural(discarded.count, "draft")} discarded`);
    }
  }, [discarder.state, discarded, shopify]);

  const toggle = (ids: string[], on: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
      return next;
    });
  const allIds = rows.map((r) => r.id);
  const overLimit = visible.length > MAX_APPLY;

  return (
    <s-page heading="Review drafts" inlineSize="large">
      <s-link slot="breadcrumb-actions" href="/app">
        Products
      </s-link>

      {outcome && (
        <OutcomeBanner
          outcome={outcome}
          titles={titles}
          busy={busy}
          onUndo={() =>
            submit({ intent: "undoBatch", batchId: outcome.batchId })
          }
          onForce={() =>
            outcome.intent === "apply"
              ? apply(outcome.stale, { force: true })
              : submit({
                  intent: "undoBatch",
                  batchId: outcome.batchId,
                  force: true,
                })
          }
          onDismiss={() => setDismissed(fetcher.data ?? null)}
        />
      )}

      <ApplyConfirm
        count={visible.length}
        staleCount={rows.filter((r) => r.stale && selected.has(r.id)).length}
        onConfirm={() => apply(visible)}
      />
      <DraftPreview row={preview} onApply={(id) => apply([id])} busy={busy} />

      {rows.length === 0 ? (
        <s-section>
          <s-box padding="large-200">
            <s-stack direction="block" gap="base" alignItems="center">
              <s-icon type="check-circle" color="subdued" />
              <s-heading>No drafts waiting for review</s-heading>
              <s-paragraph color="subdued">
                Drafts you write, one at a time or in bulk, wait here until you
                apply or discard them. Nothing changes in your store before
                that.
              </s-paragraph>
              <s-button variant="primary" icon="wand" href="/app">
                Pick products
              </s-button>
            </s-stack>
          </s-box>
        </s-section>
      ) : (
        <s-section padding="none" accessibilityLabel="Drafts to review">
          <s-box padding="base">
            <s-stack
              direction="inline"
              gap="small"
              alignItems="center"
              justifyContent="space-between"
            >
              <s-text color="subdued">
                {total > rows.length
                  ? `Showing the ${rows.length} newest of ${total} drafts.`
                  : `${plural(total, "draft")} waiting for review.`}{" "}
                Applied drafts can be undone together from History.
              </s-text>
              {visible.length > 0 && (
                <s-stack direction="inline" gap="small" alignItems="center">
                  <s-text>{visible.length} selected</s-text>
                  <s-button
                    variant="tertiary"
                    onClick={() => setSelected(new Set())}
                  >
                    Clear
                  </s-button>
                  <s-button
                    tone="critical"
                    icon="delete"
                    onClick={() => discard(visible)}
                    {...(discarding ? { loading: true } : {})}
                    {...(applying ? { disabled: true } : {})}
                  >
                    Discard
                  </s-button>
                  <s-button
                    variant="primary"
                    icon="check"
                    commandFor="apply-confirm"
                    command="--show"
                    {...(applying ? { loading: true } : {})}
                    {...(discarding || overLimit ? { disabled: true } : {})}
                  >
                    Apply {visible.length === 1 ? "draft" : "drafts"}
                  </s-button>
                </s-stack>
              )}
            </s-stack>
            {overLimit && (
              <s-box paddingBlockStart="small">
                <s-text tone="caution">
                  Up to {MAX_APPLY} drafts can be applied at once. Clear a few
                  to continue.
                </s-text>
              </s-box>
            )}
          </s-box>

          <s-table>
            <s-table-header-row>
              <s-table-header>
                <SelectBox
                  label="Select all drafts"
                  checked={visible.length > 0 && visible.length === rows.length}
                  indeterminate={
                    visible.length > 0 && visible.length < rows.length
                  }
                  onToggle={(on) => toggle(allIds, on)}
                />
              </s-table-header>
              <s-table-header listSlot="primary">Product</s-table-header>
              <s-table-header listSlot="secondary">
                New SEO title
              </s-table-header>
              <s-table-header format="numeric">Words</s-table-header>
              <s-table-header listSlot="labeled">Written</s-table-header>
              <s-table-header>
                <s-text accessibilityVisibility="exclusive">Actions</s-text>
              </s-table-header>
            </s-table-header-row>
            <s-table-body>
              {rows.map((r) => (
                <ReviewRow
                  key={r.id}
                  row={r}
                  checked={selected.has(r.id)}
                  error={errors.get(r.id)}
                  onToggle={(on) => toggle([r.id], on)}
                  onPreview={() => setPreviewId(r.id)}
                />
              ))}
            </s-table-body>
          </s-table>
        </s-section>
      )}
    </s-page>
  );
}

function ReviewRow({
  row,
  checked,
  error,
  onToggle,
  onPreview,
}: {
  row: Row;
  checked: boolean;
  error?: string;
  onToggle: (on: boolean) => void;
  onPreview: () => void;
}) {
  const change = row.draft.words - row.current.words;
  return (
    <s-table-row>
      <s-table-cell>
        <SelectBox
          label={`Select the draft for ${row.title}`}
          checked={checked}
          onToggle={onToggle}
        />
      </s-table-cell>
      <s-table-cell>
        <s-grid
          gridTemplateColumns="auto minmax(0, 1fr)"
          gap="base"
          alignItems="center"
        >
          <s-thumbnail
            size="small"
            src={row.imageUrl || undefined}
            alt={row.imageAlt || row.title}
          />
          <s-stack direction="block" gap="small-300" minInlineSize="0">
            <s-link href={`/app/products/${row.numericId}`}>{row.title}</s-link>
            {row.missing ? (
              <s-text tone="critical">This product no longer exists</s-text>
            ) : row.stale ? (
              <s-stack direction="inline" gap="small-200">
                <s-badge tone="caution">Edited in Shopify</s-badge>
              </s-stack>
            ) : null}
            {error && <s-text tone="critical">{error}</s-text>}
          </s-stack>
        </s-grid>
      </s-table-cell>
      <s-table-cell>
        <s-paragraph lineClamp={2}>{row.draft.seoTitle || "None"}</s-paragraph>
      </s-table-cell>
      <s-table-cell>
        <s-text>
          {row.current.words} → {row.draft.words}
        </s-text>
        {change !== 0 && (
          <s-text color="subdued">
            {" "}
            ({change > 0 ? "+" : ""}
            {change})
          </s-text>
        )}
      </s-table-cell>
      <s-table-cell>
        <s-stack direction="block" gap="none">
          <DateTime iso={row.createdAt} />
          <s-text color="subdued">{modelLabel(row.model)}</s-text>
        </s-stack>
      </s-table-cell>
      <s-table-cell>
        <s-button
          variant="tertiary"
          icon="view"
          commandFor="draft-preview"
          command="--show"
          onClick={onPreview}
        >
          Compare
        </s-button>
      </s-table-cell>
    </s-table-row>
  );
}

function OutcomeBanner({
  outcome,
  titles,
  busy,
  onUndo,
  onForce,
  onDismiss,
}: {
  outcome: Outcome;
  titles: Record<string, string>;
  busy: boolean;
  onUndo: () => void;
  onForce: () => void;
  onDismiss: () => void;
}) {
  const applying = outcome.intent === "apply";
  const { done, stale, failed } = outcome;
  const name = (id: string) => titles[id] ?? "A product";
  const tone = failed.length
    ? "critical"
    : stale.length
      ? "warning"
      : "success";
  const heading = applying
    ? done
      ? `${plural(done, "draft")} applied`
      : "No drafts were applied"
    : done
      ? `Previous copy restored for ${plural(done, "product")}`
      : "Nothing was undone";
  const disabled = busy ? { disabled: true } : {};
  const ref = useElementEvents({ dismiss: onDismiss });

  return (
    <s-banner ref={ref} tone={tone} heading={heading} dismissible>
      <s-stack direction="block" gap="small">
        {stale.length > 0 && (
          <s-paragraph>
            {plural(stale.length, "product was", "products were")} edited in
            Shopify{" "}
            {applying
              ? "after the draft was written"
              : "after the draft was applied"}
            , so {stale.length === 1 ? "it was" : "they were"} skipped to keep
            those edits.
          </s-paragraph>
        )}
        {failed.length > 0 && (
          <s-unordered-list>
            {failed.map((f) => (
              <s-list-item key={f.id}>
                {name(f.id)}: {f.error}
              </s-list-item>
            ))}
          </s-unordered-list>
        )}
      </s-stack>
      {applying && done > 0 && (
        <s-button
          slot="secondary-actions"
          icon="undo"
          onClick={onUndo}
          {...disabled}
        >
          Undo {done === 1 ? "it" : `all ${done}`}
        </s-button>
      )}
      {stale.length > 0 && (
        <s-button slot="secondary-actions" onClick={onForce} {...disabled}>
          {applying ? "Apply anyway" : "Undo anyway"}
        </s-button>
      )}
    </s-banner>
  );
}

function ApplyConfirm({
  count,
  staleCount,
  onConfirm,
}: {
  count: number;
  staleCount: number;
  onConfirm: () => void;
}) {
  const drafts = plural(count, "draft");
  return (
    <s-modal id="apply-confirm" heading={`Apply ${drafts}?`}>
      <s-stack direction="block" gap="base">
        <s-paragraph>
          The new descriptions and SEO listings go live on{" "}
          {count === 1 ? "this product" : `these ${count} products`} straight
          away. The copy they replace is kept, so you can undo the whole batch
          from the banner here or from History.
        </s-paragraph>
        {staleCount > 0 && (
          <s-banner tone="warning">
            {plural(staleCount, "product has", "products have")} been edited in
            Shopify since the draft was written.{" "}
            {staleCount === 1 ? "It is" : "They are"} skipped unless you choose
            to apply anyway afterwards.
          </s-banner>
        )}
      </s-stack>
      <s-button
        slot="primary-action"
        variant="primary"
        commandFor="apply-confirm"
        command="--hide"
        onClick={onConfirm}
      >
        Apply {drafts}
      </s-button>
      <s-button
        slot="secondary-actions"
        commandFor="apply-confirm"
        command="--hide"
      >
        Cancel
      </s-button>
    </s-modal>
  );
}

function DraftPreview({
  row,
  busy,
  onApply,
}: {
  row: Row | null;
  busy: boolean;
  onApply: (id: string) => void;
}) {
  return (
    <s-modal id="draft-preview" heading={row?.title ?? "Draft"} size="large">
      {row && (
        <s-stack direction="block" gap="base">
          {row.stale && (
            <s-banner tone="warning">
              This product was edited in Shopify after the draft was written.
              &quot;Current&quot; shows the copy that is live now.
            </s-banner>
          )}
          <s-query-container>
            <s-grid
              gridTemplateColumns="@container (inline-size > 640px) 1fr 1fr, 1fr"
              gap="base"
            >
              <CopyColumn heading="Current" copy={row.current} />
              <CopyColumn heading="Draft" copy={row.draft} />
            </s-grid>
          </s-query-container>
        </s-stack>
      )}
      {row && (
        <s-button
          slot="primary-action"
          variant="primary"
          commandFor="draft-preview"
          command="--hide"
          onClick={() => onApply(row.id)}
          {...(busy || row.missing ? { disabled: true } : {})}
        >
          Apply this draft
        </s-button>
      )}
      {row && (
        <s-button
          slot="secondary-actions"
          href={`/app/products/${row.numericId}`}
        >
          Edit on product page
        </s-button>
      )}
    </s-modal>
  );
}

function CopyColumn({
  heading,
  copy,
}: {
  heading: string;
  copy: Row["draft"];
}) {
  return (
    <s-stack direction="block" gap="small">
      <s-heading>
        {heading} · {plural(copy.words, "word")}
      </s-heading>
      <HtmlPreview html={copy.descriptionHtml} empty="No description." />
      <s-stack direction="block" gap="none">
        <s-text color="subdued">SEO title</s-text>
        <s-text>{copy.seoTitle || "None"}</s-text>
      </s-stack>
      <s-stack direction="block" gap="none">
        <s-text color="subdued">Meta description</s-text>
        <s-text>{copy.seoDescription || "None"}</s-text>
      </s-stack>
    </s-stack>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
