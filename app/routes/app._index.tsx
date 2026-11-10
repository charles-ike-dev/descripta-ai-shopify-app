import { useEffect, useRef, useState } from "react";
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
    navigation.state === "loading" &&
    navigation.location.pathname === "/app";

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
  const filtered =
    filters.q || filters.status || filters.view !== "all";

  return (
    <s-page heading="Products">
      <s-button slot="secondary-actions" href="/app/voice">
        Brand voice
      </s-button>

      {data.demoMode && (
        <s-banner tone="info" heading="Running in demo mode">
          <s-paragraph>
            No ANTHROPIC_API_KEY is set, so drafts come from a built-in
            template. Add a key to your environment to have Claude write them.
          </s-paragraph>
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

      <s-query-container>
        <s-grid
          gridTemplateColumns="@container (inline-size > 640px) 1fr 1fr 1fr 1fr, @container (inline-size > 360px) 1fr 1fr, 1fr"
          gap="base"
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
            sub={`Across ${data.scanned.toLocaleString()} products`}
          />
          <Metric
            label="Need attention"
            value={counts.attention.toLocaleString()}
            sub="Show these products"
            onClick={() => setView("attention")}
            selected={filters.view === "attention"}
          />
          <Metric
            label="Drafts to review"
            value={counts.draft.toLocaleString()}
            sub={counts.draft ? "Ready to apply" : "None waiting"}
            onClick={() => setView("draft")}
            selected={filters.view === "draft"}
          />
          <Metric
            label="Descriptions applied"
            value={data.appliedCount.toLocaleString()}
            sub="Written with Descripta"
            href="/app/history"
          />
        </s-grid>
      </s-query-container>

      <s-section padding="none" accessibilityLabel="Products">
        <s-box padding="base" paddingBlockEnd="none">
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
              return (
                <s-table-row key={p.id}>
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
                    {p.ai ? (
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
                      variant={p.ai?.status === "draft" ? "secondary" : "tertiary"}
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

function Metric({
  label,
  value,
  suffix,
  sub,
  tone,
  onClick,
  href,
  selected,
}: {
  label: string;
  value: string;
  suffix?: string;
  sub: string;
  tone?: "success" | "caution" | "critical";
  onClick?: () => void;
  href?: string;
  selected?: boolean;
}) {
  const body = (
    <s-stack direction="block" gap="small-200">
      <s-text color="subdued">{label}</s-text>
      <s-stack direction="inline" gap="small-200" alignItems="baseline">
        <s-heading>{value}</s-heading>
        {suffix && <s-text color="subdued">{suffix}</s-text>}
        {tone && (
          <s-badge tone={tone} size="base">
            {tone === "success" ? "Great" : tone === "caution" ? "Fair" : "Low"}
          </s-badge>
        )}
      </s-stack>
      <s-text color="subdued">{sub}</s-text>
    </s-stack>
  );

  const box = {
    padding: "base",
    borderWidth: selected ? "large" : "base",
    borderColor: selected ? "strong" : "base",
    borderRadius: "base",
    background: "base",
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
