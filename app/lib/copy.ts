/**
 * Shared types and helpers, safe to import from both server and browser code.
 */

export interface CopyResult {
  descriptionHtml: string;
  seoTitle: string;
  seoDescription: string;
  highlights: string[];
}

export type GeneratedCopy = CopyResult & { model: string };

export interface ProductInput {
  title: string;
  productType?: string | null;
  vendor?: string | null;
  tags?: string[];
  currentDescription?: string | null;
  options?: { name: string; values: string[] }[];
  price?: string | null;
  currencyCode?: string | null;
  imageAlt?: string | null;
}

export interface VoiceInput {
  brandName: string;
  tone: string;
  audience: string;
  length: string;
  language: string;
  keywords: string;
  avoidWords: string;
}

export const DEFAULT_VOICE: VoiceInput = {
  brandName: "",
  tone: "friendly",
  audience: "",
  length: "medium",
  language: "English",
  keywords: "",
  avoidWords: "",
};

export const TONES = [
  { value: "friendly", label: "Friendly and warm" },
  { value: "luxury", label: "Premium and refined" },
  { value: "playful", label: "Playful and witty" },
  { value: "technical", label: "Technical and precise" },
  { value: "minimal", label: "Minimal and direct" },
];

export const LENGTHS = [
  { value: "short", label: "Short (60 to 90 words)" },
  { value: "medium", label: "Medium (120 to 180 words)" },
  { value: "long", label: "Long (220 to 300 words)" },
];

export function stripHtml(html: string | null | undefined) {
  return (html || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Template-based copy for demo mode (no API key). */
export function demoCopy(
  product: ProductInput,
  voice: VoiceInput,
): GeneratedCopy {
  const brand = voice.brandName || product.vendor || "our studio";
  const type = (product.productType || "piece").toLowerCase();
  const audience = voice.audience || "everyday shoppers";
  const optionLine = product.options
    ?.filter((o) => o.name !== "Title")
    .map((o) => `${o.values.length} ${o.name.toLowerCase()} options`)
    .join(" and ");
  const keywords = voice.keywords
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);

  const highlights = [
    `Designed by ${brand} for ${audience}`,
    optionLine ? `Available in ${optionLine}` : "Made to be used every day",
    keywords[0] ? `Built around ${keywords[0]}` : "Easy to care for",
    "Ships fast, with easy returns",
  ];

  const opener =
    voice.tone === "luxury"
      ? `Meet the ${product.title}, a ${type} made with quiet confidence.`
      : voice.tone === "playful"
        ? `Say hello to the ${product.title}, the ${type} you didn't know you needed.`
        : voice.tone === "technical"
          ? `The ${product.title} is a ${type} engineered for reliable performance.`
          : `The ${product.title} is the ${type} that makes every day a little easier.`;

  const descriptionHtml = [
    `<p>${opener}</p>`,
    `<p>Thoughtfully made by ${brand}, it is built for ${audience} who want quality without the fuss.</p>`,
    `<ul>${highlights.map((h) => `<li>${h}</li>`).join("")}</ul>`,
    `<p><strong>Demo mode:</strong> add an ANTHROPIC_API_KEY to get copy written by Claude.</p>`,
  ].join("\n");

  return {
    descriptionHtml,
    seoTitle: `${product.title} | ${brand}`.slice(0, 60),
    seoDescription:
      `Shop the ${product.title} by ${brand}. ${highlights[1]}. ${highlights[3]}.`.slice(
        0,
        155,
      ),
    highlights,
    model: "demo-template",
  };
}

const ALLOWED_TAGS = new Set([
  "p",
  "br",
  "ul",
  "ol",
  "li",
  "strong",
  "em",
  "b",
  "i",
  "h2",
  "h3",
  "h4",
]);

/**
 * Allowlist sanitiser for generated copy. Keeps simple formatting tags,
 * drops every attribute and every other tag (including script and style
 * content), so AI output can never inject markup into the admin or storefront.
 */
export function sanitizeHtml(html: string) {
  return (html || "")
    .replace(
      /<(script|style|iframe|object|embed|template)[\s\S]*?<\/\1\s*>/gi,
      "",
    )
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\/?([a-zA-Z0-9]+)\b[^>]*>/g, (tag, name: string) => {
      const n = name.toLowerCase();
      if (!ALLOWED_TAGS.has(n)) return "";
      return tag.startsWith("</") ? `</${n}>` : `<${n}>`;
    })
    .trim();
}
