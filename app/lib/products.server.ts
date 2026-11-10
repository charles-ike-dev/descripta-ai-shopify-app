import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import type { ProductInput } from "./copy";

type Admin = AdminApiContext;

export interface ProductRow {
  id: string;
  numericId: string;
  title: string;
  status: string;
  imageUrl: string | null;
  imageAlt: string | null;
  descriptionWords: number;
  /** The start of the current description as plain text. */
  snippet: string;
  seoTitle: string | null;
  seoDescription: string | null;
  updatedAt: string;
}

export interface ProductDetail extends ProductRow {
  descriptionHtml: string;
  productType: string;
  vendor: string;
  tags: string[];
  handle: string;
  options: { name: string; values: string[] }[];
  price: string | null;
  currencyCode: string | null;
}

export const toGid = (numericId: string) =>
  `gid://shopify/Product/${numericId.replace(/\D/g, "")}`;
export const toNumericId = (gid: string) => gid.split("/").pop() || gid;

const plainText = (html: string) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

const countWords = (text: string) => (text ? text.split(" ").length : 0);

async function gql<T>(
  admin: Admin,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const response = await admin.graphql(query, { variables });
  const json = (await response.json()) as { data?: T; errors?: unknown };
  if (!json.data) {
    throw new Error(`Shopify GraphQL error: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}

interface RawProductNode {
  id: string;
  title: string;
  status: string;
  updatedAt: string;
  descriptionHtml: string;
  featuredMedia: {
    preview: { image: { url: string; altText: string | null } | null } | null;
  } | null;
  seo: { title: string | null; description: string | null };
}

const PRODUCT_ROW_FIELDS = `#graphql
  id
  title
  status
  updatedAt
  descriptionHtml
  featuredMedia { preview { image { url(transform: { maxWidth: 120 }) altText } } }
  seo { title description }
`;

function toRow(node: RawProductNode): ProductRow {
  const image = node.featuredMedia?.preview?.image ?? null;
  const text = plainText(node.descriptionHtml);
  return {
    id: node.id,
    numericId: toNumericId(node.id),
    title: node.title,
    status: node.status,
    imageUrl: image?.url ?? null,
    imageAlt: image?.altText ?? null,
    descriptionWords: countWords(text),
    snippet: text.slice(0, 160),
    seoTitle: node.seo.title,
    seoDescription: node.seo.description,
    updatedAt: node.updatedAt,
  };
}

/** How many products the list scores in one go (the API maximum per page). */
export const SCAN_LIMIT = 250;

export const PRODUCT_STATUSES = ["active", "draft", "archived"] as const;

/**
 * The most recently updated products matching a search, scored and filtered
 * in memory. Shopify search cannot filter by description length or missing
 * SEO fields, so the list works from one page of up to SCAN_LIMIT products.
 */
export async function scanProducts(
  admin: Admin,
  opts: { search?: string; status?: string },
) {
  const terms = [
    opts.search?.replace(/[":\\()]/g, " ").trim(),
    PRODUCT_STATUSES.includes(
      opts.status as (typeof PRODUCT_STATUSES)[number],
    )
      ? `status:${opts.status}`
      : "",
  ].filter(Boolean);
  const query = terms.length ? terms.join(" AND ") : null;

  const data = await gql<{
    products: { nodes: RawProductNode[] };
    productsCount: { count: number };
  }>(
    admin,
    `#graphql
    query DescriptaProducts($first: Int!, $query: String) {
      products(first: $first, query: $query, sortKey: UPDATED_AT, reverse: true) {
        nodes { ${PRODUCT_ROW_FIELDS} }
      }
      productsCount(query: $query) { count }
    }`,
    { first: SCAN_LIMIT, query },
  );

  return {
    products: data.products.nodes.map(toRow),
    totalCount: data.productsCount.count,
  };
}

export async function getProduct(
  admin: Admin,
  gid: string,
): Promise<ProductDetail | null> {
  const data = await gql<{
    product:
      | (RawProductNode & {
          handle: string;
          productType: string;
          vendor: string;
          tags: string[];
          options: { name: string; values: string[] }[];
          priceRangeV2: {
            minVariantPrice: { amount: string; currencyCode: string };
          };
        })
      | null;
  }>(
    admin,
    `#graphql
    query DescriptaProduct($id: ID!) {
      product(id: $id) {
        ${PRODUCT_ROW_FIELDS}
        handle
        productType
        vendor
        tags
        options { name values }
        priceRangeV2 { minVariantPrice { amount currencyCode } }
      }
    }`,
    { id: gid },
  );

  const p = data.product;
  if (!p) return null;
  return {
    ...toRow(p),
    descriptionHtml: p.descriptionHtml,
    handle: p.handle,
    productType: p.productType,
    vendor: p.vendor,
    tags: p.tags,
    options: p.options,
    price: p.priceRangeV2?.minVariantPrice.amount ?? null,
    currencyCode: p.priceRangeV2?.minVariantPrice.currencyCode ?? null,
  };
}

export function toProductInput(p: ProductDetail): ProductInput {
  return {
    title: p.title,
    productType: p.productType,
    vendor: p.vendor,
    tags: p.tags,
    currentDescription: p.descriptionHtml,
    options: p.options,
    price: p.price,
    currencyCode: p.currencyCode,
    imageAlt: p.imageAlt,
  };
}

/** Write description and SEO fields back to Shopify. */
export async function updateProductCopy(
  admin: Admin,
  gid: string,
  copy: { descriptionHtml: string; seoTitle: string; seoDescription: string },
) {
  const data = await gql<{
    productUpdate: {
      product: { id: string } | null;
      userErrors: { field: string[] | null; message: string }[];
    };
  }>(
    admin,
    `#graphql
    mutation DescriptaUpdateProduct($product: ProductUpdateInput!) {
      productUpdate(product: $product) {
        product { id }
        userErrors { field message }
      }
    }`,
    {
      product: {
        id: gid,
        descriptionHtml: copy.descriptionHtml,
        seo: { title: copy.seoTitle, description: copy.seoDescription },
      },
    },
  );

  const errors = data.productUpdate.userErrors;
  if (errors.length) {
    throw new Error(errors.map((e) => e.message).join("; "));
  }
}
