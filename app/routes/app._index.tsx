import { useCallback, useEffect, useRef, useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import {
  useLoaderData,
  useNavigate,
  useNavigation,
  useSearchParams,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { SCAN_LIMIT, scanProducts } from "../lib/products.server";
import { isDemoMode } from "../lib/ai.server";
import { GOOD_SCORE, scoreCopy, targetWords } from "../lib/health";
import {
  type BulkJob,
  type BulkProduct,
  MAX_BULK,
  bulkSummary,
  useBulkDrafts,
} from "../lib/bulk";
import {
  DateTime,
  capitalize,
  fieldValue,
  statusBadge,
  useElementEvents,
} from "../lib/ui";

const PAGE_SIZE = 25;

const VIEWS = [
  { id: "all", label: "All" },
  { id: "attention", label: "Needs attention" },
  { id: "no-description", label: "No description" },
  { id: "missing-seo", label: "Missing SEO" },
  { id: "draft", label: "Drafts to review" },
  { id: "good", label: "Looks good" },
] as const;
type ViewId = (typeof VIEWS)[number]["id"];

const SORTS = [
  { id: "attention", label: "Needs attention first" },
  { id: "updated", label: "Recently updated" },
  { id: "title", label: "Title A to Z" },
  { id: "words", label: "Fewest words" },
] as const;
type SortId = (typeof SORTS)[number]["id"];

const pick = <T extends string>(
  value: string | null,
  options: readonly { id: T }[],
): T => options.find((o) => o.id === value)?.id ?? options[0].id;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const params = new URL(request.url).searchParams;
  const q = params.get("q") || "";
  const status = params.get("status") || "";
  const view = pick(params.get("view"), VIEWS);
  const sort = pick(params.get("sort"), SORTS);

  const [scan, voice, appliedCount] = await Promise.all([
    scanProducts(admin, { search: q, status }),
    db.brandVoice.findUnique({
      where: { shop: session.shop },
      select: { length: true },
    }),
    db.generation.count({ where: { shop: session.shop, status: "applied" } }),
  ]);

  // The latest Descripta activity for each listed product.
  const latest = await db.generation.findMany({
    where: {
      shop: session.shop,
      productId: { in: scan.products.map((p) => p.id) },
    },
    orderBy: { createdAt: "desc" },
    distinct: ["productId"],
    select: { productId: true, status: true, createdAt: true },
  });
  const activity = new Map(latest.map((g) => [g.productId, g]));

  const voiceLength = voice?.length ?? "medium";
  const rows = scan.products.map((p) => {
    const health = scoreCopy(p, voiceLength);
    const last = activity.get(p.id);
    return {
      id: p.id,
      numericId: p.numericId,
      title: p.title,
      status: p.status,
      imageUrl: p.imageUrl,
      imageAlt: p.imageAlt,
      snippet: p.snippet,
      words: p.descriptionWords,
      updatedAt: p.updatedAt,
      health,
      missingSeo: !p.seoTitle?.trim() || !p.seoDescription?.trim(),
      ai: last
        ? { status: last.status, at: last.createdAt.toISOString() }
        : null,
    };
  });
  type Row = (typeof rows)[number];

  const matches: Record<ViewId, (r: Row) => boolean> = {
    all: () => true,
    attention: (r) => r.health.score < GOOD_SCORE && r.ai?.status !== "draft",
    "no-description": (r) => r.words === 0,
    "missing-seo": (r) => r.missingSeo,
    draft: (r) => r.ai?.status === "draft",
    good: (r) => r.health.score >= GOOD_SCORE,
  };
  const counts = Object.fromEntries(
    VIEWS.map((v) => [v.id, rows.filter(matches[v.id]).length]),
  ) as Record<ViewId, number>;

  const compare: Record<SortId, (a: Row, b: Row) => number> = {
    // Pending drafts first (they only need a review), then lowest score.
    attention: (a, b) =>
      Number(b.ai?.status === "draft") - Number(a.ai?.status === "draft") ||
      a.health.score - b.health.score,
    updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
    title: (a, b) => a.title.localeCompare(b.title),
    words: (a, b) => a.words - b.words,
  };
  const filtered = rows.filter(matches[view]).sort(compare[sort]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Math.min(
    pageCount,
    Math.max(1, Number(params.get("page")) || 1),
  );

  const averageScore = rows.length
    ? Math.round(rows.reduce((sum, r) => sum + r.health.score, 0) / rows.length)
    : 0;

  return {
    rows: filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    // Every match across pages, for "write drafts for all".
    matching: filtered.map((r) => ({ id: r.numericId, title: r.title })),
    page,
    pageCount,
    resultCount: filtered.length,
    scanned: rows.length,
    totalCount: scan.totalCount,
    scanLimit: SCAN_LIMIT,
    counts,
    averageScore,
    appliedCount,
    targetWords: targetWords(voiceLength),
    filters: { q, status, view, sort },
    hasVoice: Boolean(voice),
    demoMode: isDemoMode(),
  };
};

export default function ProductsPage() {
  const data = useLoaderData<typeof loader>();
  const { rows, filters, counts } = data;
  const navigate = useNavigate();
  const navigation = useNavigation();
  const [, setParams] = useSearchParams();
  const loading =
    navigation.state === "loading" && navigation.location.pathname === "/app";

  /** Changes one or more filters and goes back to page 1. */
  const setFilters = (next: Record<string, string>) =>
    setParams(
      (p) => {
        Object.entries(next).forEach(([k, v]) =>
          v ? p.set(k, v) : p.delete(k),
        );
        if (!("page" in next)) p.delete("page");
        return p;
      },
      { replace: !("page" in next) },
    );

  // Search as the merchant types, without a request per keystroke.
  const [search, setSearch] = useState(filters.q);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(searchTimer.current), []);
  const runSearch = (value: string) => {
    setSearch(value);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(
      () => setFilters({ q: value.trim() }),
      300,
    );
  };

  const tableRef = useElementEvents({
    nextpage: () => setFilters({ page: String(data.page + 1) }),
    previouspage: () => setFilters({ page: String(data.page - 1) }),
  });
  const statusRef = useElementEvents({
    change: (e) => setFilters({ status: fieldValue(e) }),
  });
  const sortRef = useElementEvents({
    change: (e) =>
      setFilters({ sort: fieldValue(e) === "attention" ? "" : fieldValue(e) }),
  });

  const setView = (view: ViewId) =>
    setFilters({ view: view === "all" ? "" : view });
  const filtered = filters.q || filters.status || filters.view !== "all";

  // Bulk drafts: products the merchant ticked, and the list waiting for the
  // confirmation dialog.
  const bulk = useBulkDrafts();
  const busy = Boolean(bulk.job?.running);
  const [selected, setSelected] = useState<Map<string, string>>(new Map());
  const [pending, setPending] = useState<BulkProduct[]>([]);
  const toggle = (items: BulkProduct[], on: boolean) =>
    setSelected((s) => {
      const next = new Map(s);
      items.forEach((i) => (on ? next.set(i.id, i.title) : next.delete(i.id)));
      return next;
    });
  const pageItems = rows.map((r) => ({ id: r.numericId, title: r.title }));
  const pageSelected = pageItems.filter((i) => selected.has(i.id)).length;
  const jobStatus = new Map(bulk.job?.items.map((i) => [i.id, i.status]));

  // Views where "write drafts for all of these" is a sensible shortcut.
  const bulkView =
    filters.view === "attention" ||
    filters.view === "no-description" ||
    filters.view === "missing-seo";

  const confirmBulk = () => {
    bulk.start(pending);
    setSelected(new Map());
  };

  return (
    <s-page heading="Products">
      <s-button slot="secondary-actions" href="/app/voice">
        Brand voice
      </s-button>

      {data.demoMode && (
        <s-banner tone="info" dismissible>
          Demo mode: drafts come from a template until ANTHROPIC_API_KEY is set.
        </s-banner>
      )}

      {!data.hasVoice && (
        <s-banner tone="warning" heading="Set up your brand voice first">
          <s-paragraph>
            Tell Descripta how your store sounds, who you sell to and which
            claims to avoid. Every description it writes will follow it.
          </s-paragraph>
          <s-button slot="secondary-actions" href="/app/voice">
            Set brand voice
          </s-button>
        </s-banner>
      )}

      {bulk.job && (
        <BulkProgress
          job={bulk.job}
          onCancel={bulk.cancel}
          onRetry={bulk.retryFailed}
          onDismiss={bulk.dismiss}
          onReview={() => {
            bulk.dismiss();
            setView("draft");
          }}
        />
      )}

      <BulkConfirm
        products={pending}
        demoMode={data.demoMode}
        onConfirm={confirmBulk}
      />

      <s-section padding="none" accessibilityLabel="Products">
        <s-box padding="small" borderWidth="none none base none">
          <s-query-container>
            <s-grid
              gridTemplateColumns="@container (inline-size > 560px) 1fr 1fr 1fr 1fr, 1fr 1fr"
              gap="small-200"
            >
              <Metric
                label="Average copy score"
                value={`${data.averageScore}`}
                suffix="/ 100"
                tone={
                  data.averageScore >= GOOD_SCORE
                    ? "success"
                    : data.averageScore >= 60
                      ? "caution"
                      : "critical"
                }
              />
              <Metric
                label="Need attention"
                value={counts.attention.toLocaleString()}
                onClick={() => setView("attention")}
                selected={filters.view === "attention"}
              />
              <Metric
                label="Drafts to review"
                value={counts.draft.toLocaleString()}
                onClick={() => setView("draft")}
                selected={filters.view === "draft"}
              />
              <Metric
                label="Descriptions applied"
                value={data.appliedCount.toLocaleString()}
                href="/app/history"
              />
            </s-grid>
          </s-query-container>
        </s-box>

        <s-box padding="base" paddingBlockEnd="none">
          <s-stack
            direction="inline"
            gap="small"
            alignItems="center"
            justifyContent="space-between"
          >
            <s-stack direction="inline" gap="small-200">
              {VIEWS.map((v) => (
                <s-clickable-chip
                  key={v.id}
                  color={filters.view === v.id ? "strong" : "base"}
                  accessibilityLabel={`${v.label}, ${counts[v.id]} products`}
                  onClick={() => setView(v.id)}
                >
                  {v.label} {counts[v.id]}
                </s-clickable-chip>
              ))}
            </s-stack>

            {selected.size > 0 ? (
              <s-stack direction="inline" gap="small" alignItems="center">
                <s-text>{selected.size} selected</s-text>
                <s-button
                  variant="tertiary"
                  onClick={() => setSelected(new Map())}
                >
                  Clear
                </s-button>
                <s-button
                  variant="primary"
                  icon="wand"
                  commandFor="bulk-confirm"
                  command="--show"
                  onClick={() =>
                    setPending(
                      [...selected].map(([id, title]) => ({ id, title })),
                    )
                  }
                  {...(busy ? { disabled: true } : {})}
                >
                  Write {selected.size === 1 ? "draft" : "drafts"}
                </s-button>
              </s-stack>
            ) : (
              bulkView &&
              data.matching.length > 0 && (
                <s-button
                  icon="wand"
                  commandFor="bulk-confirm"
                  command="--show"
                  onClick={() => setPending(data.matching)}
                  {...(busy ? { disabled: true } : {})}
                >
                  {data.matching.length > MAX_BULK
                    ? `Write drafts for the first ${MAX_BULK}`
                    : `Write drafts for all ${data.matching.length}`}
                </s-button>
              )
            )}
          </s-stack>
        </s-box>

        <s-table
          ref={tableRef}
          paginate
          {...(data.page < data.pageCount ? { hasNextPage: true } : {})}
          {...(data.page > 1 ? { hasPreviousPage: true } : {})}
          {...(loading ? { loading: true } : {})}
        >
          <s-grid
            slot="filters"
            gridTemplateColumns="1fr auto auto"
            gap="small"
            alignItems="center"
          >
            <s-search-field
              label="Search products"
              labelAccessibilityVisibility="exclusive"
              placeholder="Search by title, vendor or tag"
              value={search}
              onInput={(e) => runSearch(fieldValue(e))}
            />
            <s-select
              ref={statusRef}
              label="Status"
              labelAccessibilityVisibility="exclusive"
              value={filters.status}
            >
              <s-option value="">Any status</s-option>
              <s-option value="active">Active</s-option>
              <s-option value="draft">Draft</s-option>
              <s-option value="archived">Archived</s-option>
            </s-select>
            <s-select
              ref={sortRef}
              label="Sort by"
              labelAccessibilityVisibility="exclusive"
              icon="sort"
              value={filters.sort}
            >
              {SORTS.map((s) => (
                <s-option key={s.id} value={s.id}>
                  {s.label}
                </s-option>
              ))}
            </s-select>
          </s-grid>

          <s-table-header-row>
            <s-table-header>
              <SelectBox
                label="Select all products on this page"
                checked={
                  pageItems.length > 0 && pageSelected === pageItems.length
                }
                indeterminate={
                  pageSelected > 0 && pageSelected < pageItems.length
                }
                onToggle={(on) => toggle(pageItems, on)}
              />
            </s-table-header>
            <s-table-header listSlot="primary">Product</s-table-header>
            <s-table-header listSlot="secondary">Copy score</s-table-header>
            <s-table-header listSlot="inline">Descripta</s-table-header>
            <s-table-header format="numeric">Words</s-table-header>
            <s-table-header listSlot="labeled">Status</s-table-header>
            <s-table-header>
              <s-text accessibilityVisibility="exclusive">Actions</s-text>
            </s-table-header>
          </s-table-header-row>
          <s-table-body>
            {rows.map((p) => {
              const action =
                p.ai?.status === "draft"
                  ? { label: "Review draft", icon: "view" as const }
                  : p.health.score < GOOD_SCORE
                    ? { label: "Improve", icon: "wand" as const }
                    : { label: "Rewrite", icon: "wand" as const };
              const writing = jobStatus.get(p.numericId);
              return (
                <s-table-row key={p.id}>
                  <s-table-cell>
                    <SelectBox
                      label={`Select ${p.title}`}
                      checked={selected.has(p.numericId)}
                      onToggle={(on) =>
                        toggle([{ id: p.numericId, title: p.title }], on)
                      }
                    />
                  </s-table-cell>
                  <s-table-cell>
                    <s-stack direction="inline" gap="base" alignItems="center">
                      <s-thumbnail
                        size="small"
                        src={p.imageUrl || undefined}
                        alt={p.imageAlt || p.title}
                      />
                      <s-stack direction="block" gap="none">
                        <s-link href={`/app/products/${p.numericId}`}>
                          {p.title}
                        </s-link>
                        <s-paragraph color="subdued" lineClamp={1}>
                          {p.snippet || "No description yet"}
                        </s-paragraph>
                      </s-stack>
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>
                    <s-stack direction="block" gap="small-300">
                      <s-badge tone={p.health.tone}>
                        {p.health.score} · {p.health.label}
                      </s-badge>
                      {p.health.issues.length > 0 && (
                        <s-text color="subdued">
                          {p.health.issues.slice(0, 2).join(", ")}
                          {p.health.issues.length > 2 &&
                            ` +${p.health.issues.length - 2} more`}
                        </s-text>
                      )}
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>
                    {writing === "writing" || writing === "queued" ? (
                      <s-stack
                        direction="inline"
                        gap="small-200"
                        alignItems="center"
                      >
                        {writing === "writing" && (
                          <s-spinner accessibilityLabel="Writing" size="base" />
                        )}
                        <s-text color="subdued">
                          {writing === "writing" ? "Writing…" : "Queued"}
                        </s-text>
                      </s-stack>
                    ) : p.ai ? (
                      <s-stack direction="block" gap="small-300">
                        <s-badge
                          tone={statusBadge(p.ai.status).tone}
                          icon={p.ai.status === "draft" ? "note" : ""}
                        >
                          {p.ai.status === "draft"
                            ? "Draft ready"
                            : statusBadge(p.ai.status).label}
                        </s-badge>
                        <s-text color="subdued">
                          <DateTime iso={p.ai.at} />
                        </s-text>
                      </s-stack>
                    ) : (
                      <s-text color="subdued">Not started</s-text>
                    )}
                  </s-table-cell>
                  <s-table-cell>
                    <s-text
                      color={p.words < data.targetWords ? "subdued" : "base"}
                    >
                      {p.words}
                    </s-text>
                  </s-table-cell>
                  <s-table-cell>
                    <s-badge
                      tone={
                        p.status === "ACTIVE"
                          ? "success"
                          : p.status === "DRAFT"
                            ? "info"
                            : "neutral"
                      }
                    >
                      {capitalize(p.status)}
                    </s-badge>
                  </s-table-cell>
                  <s-table-cell>
                    <s-button
                      variant={
                        p.ai?.status === "draft" ? "secondary" : "tertiary"
                      }
                      icon={action.icon}
                      onClick={() => navigate(`/app/products/${p.numericId}`)}
                    >
                      {action.label}
                    </s-button>
                  </s-table-cell>
                </s-table-row>
              );
            })}
          </s-table-body>
        </s-table>

        {rows.length === 0 &&
          (filtered ? (
            <EmptyState
              icon="search"
              heading={
                filters.view === "draft"
                  ? "No drafts waiting for review"
                  : filters.view === "attention" && !filters.q
                    ? "Nothing needs attention"
                    : "No products match these filters"
              }
              body={
                filters.view === "attention" && !filters.q
                  ? "Every product's copy meets your brand voice target. Nice work."
                  : "Try a different search or filter, or clear them to see every product."
              }
            >
              <s-button
                onClick={() => {
                  setSearch("");
                  setFilters({ q: "", status: "", view: "" });
                }}
              >
                Clear filters
              </s-button>
            </EmptyState>
          ) : (
            <EmptyState
              icon="product-add"
              heading="Add your first product"
              body="Descripta writes copy for the products in your store. Create one in Shopify, then come back here."
            >
              <s-button variant="primary" href="shopify://admin/products/new">
                Add product
              </s-button>
            </EmptyState>
          ))}

        {rows.length > 0 && (
          <s-box padding="base">
            <s-text color="subdued">
              {data.resultCount === 1
                ? "1 product"
                : `${data.resultCount.toLocaleString()} products`}
              {data.pageCount > 1 &&
                ` · Page ${data.page} of ${data.pageCount}`}
              {data.totalCount > data.scanLimit &&
                ` · Scores cover the ${data.scanLimit} most recently updated of ${data.totalCount.toLocaleString()} products. Search to find others.`}
            </s-text>
          </s-box>
        )}
      </s-section>
    </s-page>
  );
}

/**
 * A Polaris checkbox driven from React state. The checked state is set as a
 * property because React 18 can only set attributes on custom elements.
 */
function SelectBox({
  label,
  checked,
  indeterminate = false,
  onToggle,
}: {
  label: string;
  checked: boolean;
  indeterminate?: boolean;
  onToggle: (checked: boolean) => void;
}) {
  const element = useRef<HTMLInputElement | null>(null);
  const listen = useElementEvents({
    change: (e) =>
      onToggle((e.currentTarget as unknown as HTMLInputElement).checked),
  });
  const ref = useCallback(
    (node: Element | null) => {
      element.current = node as HTMLInputElement | null;
      listen(node);
    },
    [listen],
  );
  useEffect(() => {
    if (!element.current) return;
    element.current.checked = checked;
    element.current.indeterminate = indeterminate;
  }, [checked, indeterminate]);

  return <s-checkbox ref={ref} accessibilityLabel={label} />;
}

function BulkConfirm({
  products,
  demoMode,
  onConfirm,
}: {
  products: BulkProduct[];
  demoMode: boolean;
  onConfirm: () => void;
}) {
  const count = Math.min(products.length, MAX_BULK);
  const drafts = count === 1 ? "1 draft" : `${count} drafts`;
  const minutes = Math.max(1, Math.ceil((count * 20) / 2 / 60));

  return (
    <s-modal id="bulk-confirm" heading={`Write ${drafts}?`}>
      <s-stack direction="block" gap="base">
        <s-paragraph>
          Descripta will write a new description and SEO listing for{" "}
          {count === 1 ? "this product" : `these ${count} products`} in your
          brand voice. It takes about {minutes}{" "}
          {minutes === 1 ? "minute" : "minutes"}, and you can keep using the app
          while it runs.
        </s-paragraph>
        <s-paragraph>
          Drafts are saved for you to review. Nothing changes in your store
          until you apply them.
        </s-paragraph>
        {products.length > MAX_BULK && (
          <s-banner tone="info">
            Only the first {MAX_BULK} of {products.length} products are written
            in one run. Run it again for the rest.
          </s-banner>
        )}
        <s-paragraph color="subdued">
          {demoMode
            ? "Demo mode: drafts come from the built-in template, so this costs nothing."
            : "Each product uses one Claude API request."}
        </s-paragraph>
      </s-stack>
      <s-button
        slot="primary-action"
        variant="primary"
        commandFor="bulk-confirm"
        command="--hide"
        onClick={onConfirm}
      >
        Write {drafts}
      </s-button>
      <s-button
        slot="secondary-actions"
        commandFor="bulk-confirm"
        command="--hide"
      >
        Cancel
      </s-button>
    </s-modal>
  );
}

const BULK_STATUS = {
  queued: { tone: "neutral", label: "Waiting" },
  writing: { tone: "info", label: "Writing…" },
  done: { tone: "success", label: "Draft ready" },
  failed: { tone: "critical", label: "Failed" },
  cancelled: { tone: "neutral", label: "Cancelled" },
} as const;

function BulkProgress({
  job,
  onCancel,
  onRetry,
  onDismiss,
  onReview,
}: {
  job: BulkJob;
  onCancel: () => void;
  onRetry: () => void;
  onDismiss: () => void;
  onReview: () => void;
}) {
  const s = bulkSummary(job);
  // The per-product list stays folded so the table stays in view.
  const [open, setOpen] = useState(false);
  const heading = job.running
    ? job.cancelling
      ? "Stopping after the current drafts"
      : `Writing drafts: ${s.finished} of ${s.total}`
    : s.failed
      ? `${s.done} of ${s.total} drafts written, ${s.failed} failed`
      : `${s.done} ${s.done === 1 ? "draft" : "drafts"} ready to review`;

  return (
    <s-section padding="none" accessibilityLabel="Bulk draft progress">
      <s-box paddingBlock="small" paddingInline="base">
        <s-stack direction="block" gap="small">
          <s-stack
            direction="inline"
            gap="base"
            alignItems="center"
            justifyContent="space-between"
          >
            <s-stack direction="inline" gap="small" alignItems="center">
              {job.running ? (
                <s-spinner accessibilityLabel="Writing drafts" size="base" />
              ) : (
                <s-icon
                  type={s.failed ? "alert-triangle" : "check-circle"}
                  tone={s.failed ? "warning" : "success"}
                />
              )}
              <s-text type="strong">{heading}</s-text>
            </s-stack>
            <s-button-group>
              <s-button
                slot="secondary-actions"
                variant="tertiary"
                onClick={() => setOpen((o) => !o)}
              >
                {open ? "Hide details" : "Show details"}
              </s-button>
              {job.running ? (
                <s-button
                  slot="secondary-actions"
                  onClick={onCancel}
                  {...(job.cancelling ? { disabled: true } : {})}
                >
                  Stop
                </s-button>
              ) : (
                <>
                  <s-button slot="secondary-actions" onClick={onDismiss}>
                    Dismiss
                  </s-button>
                  {s.failed > 0 && (
                    <s-button slot="secondary-actions" onClick={onRetry}>
                      Retry {s.failed} failed
                    </s-button>
                  )}
                  {s.done > 0 && (
                    <s-button
                      slot="primary-action"
                      variant="primary"
                      onClick={onReview}
                    >
                      Review drafts
                    </s-button>
                  )}
                </>
              )}
            </s-button-group>
          </s-stack>

          <div
            className="descripta-progress"
            role="progressbar"
            aria-valuenow={s.percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Bulk draft progress"
          >
            <div
              className="descripta-progress__bar"
              style={{ width: `${s.percent}%` }}
            />
          </div>

          {open && (
            <div className="descripta-bulk-list">
              <s-stack direction="block" gap="small-200">
                {job.items.map((item) => {
                  const status = BULK_STATUS[item.status];
                  return (
                    <s-stack
                      key={item.id}
                      direction="inline"
                      gap="small"
                      alignItems="center"
                      justifyContent="space-between"
                    >
                      <s-stack direction="block" gap="none">
                        {item.status === "done" ? (
                          <s-link href={`/app/products/${item.id}`}>
                            {item.title}
                          </s-link>
                        ) : (
                          <s-text>{item.title}</s-text>
                        )}
                        {item.error && (
                          <s-text tone="critical">{item.error}</s-text>
                        )}
                      </s-stack>
                      <s-badge tone={status.tone}>{status.label}</s-badge>
                    </s-stack>
                  );
                })}
              </s-stack>
            </div>
          )}
        </s-stack>
      </s-box>
    </s-section>
  );
}

/** One compact stat in the strip above the product list. */
function Metric({
  label,
  value,
  suffix,
  tone,
  onClick,
  href,
  selected,
}: {
  label: string;
  value: string;
  suffix?: string;
  tone?: "success" | "caution" | "critical";
  onClick?: () => void;
  href?: string;
  selected?: boolean;
}) {
  const body = (
    <s-stack direction="block" gap="none">
      <s-text color="subdued">{label}</s-text>
      <s-stack direction="inline" gap="small-300" alignItems="center">
        <s-text type="strong">{value}</s-text>
        {suffix && <s-text color="subdued">{suffix}</s-text>}
        {tone && (
          <s-badge tone={tone}>
            {tone === "success" ? "Great" : tone === "caution" ? "Fair" : "Low"}
          </s-badge>
        )}
      </s-stack>
    </s-stack>
  );

  const box = {
    paddingBlock: "small-300",
    paddingInline: "small",
    borderRadius: "base",
    background: selected ? "strong" : "transparent",
  } as const;

  if (!onClick && !href) return <s-box {...box}>{body}</s-box>;
  return (
    <s-clickable
      {...box}
      {...(href ? { href } : {})}
      {...(onClick ? { onClick } : {})}
      accessibilityLabel={`${label}: ${value}`}
    >
      {body}
    </s-clickable>
  );
}

function EmptyState({
  icon,
  heading,
  body,
  children,
}: {
  icon: "search" | "product-add";
  heading: string;
  body: string;
  children: React.ReactNode;
}) {
  return (
    <s-box padding="large-200">
      <s-stack direction="block" gap="base" alignItems="center">
        <s-icon type={icon} color="subdued" />
        <s-heading>{heading}</s-heading>
        <s-paragraph color="subdued">{body}</s-paragraph>
        {children}
      </s-stack>
    </s-box>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
