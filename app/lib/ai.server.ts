import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import {
  demoCopy,
  sanitizeHtml,
  stripHtml,
  type GeneratedCopy,
  type ProductInput,
  type VoiceInput,
} from "./copy";

export { DEFAULT_VOICE } from "./copy";

/**
 * Product copy generation.
 *
 * With ANTHROPIC_API_KEY set, copy is written by Claude using structured
 * outputs, so the response is always valid JSON in the shape below.
 * Without a key the app runs in demo mode and builds copy from a template,
 * so the whole flow can be shown without paying for API calls.
 */

export const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";

export const CopySchema = z.object({
  descriptionHtml: z
    .string()
    .describe(
      "Product description as clean HTML using only <p>, <ul>, <li>, <strong> and <em>.",
    ),
  seoTitle: z.string().describe("SEO page title, at most 60 characters."),
  seoDescription: z
    .string()
    .describe("SEO meta description, at most 155 characters."),
  highlights: z
    .array(z.string())
    .describe("Three to five short selling points used in the description."),
});

const LENGTH_GUIDE: Record<string, string> = {
  short: "about 60 to 90 words",
  medium: "about 120 to 180 words",
  long: "about 220 to 300 words",
};

const SYSTEM_PROMPT = `You are an e-commerce copywriter who writes product pages for Shopify stores.
Write copy that is specific to the product facts you are given. Never invent materials, sizes,
certifications, guarantees or prices that are not in the facts. If a fact is missing, write around it.
Lead with the benefit to the shopper, then the details. Keep sentences short and scannable.
The SEO title must stay under 60 characters and the meta description under 155 characters.`;

export function isDemoMode() {
  return !process.env.ANTHROPIC_API_KEY;
}

function buildPrompt(product: ProductInput, voice: VoiceInput) {
  const facts = {
    title: product.title,
    productType: product.productType || undefined,
    vendor: product.vendor || undefined,
    tags: product.tags?.length ? product.tags : undefined,
    options: product.options?.length ? product.options : undefined,
    price:
      product.price && product.currencyCode
        ? `${product.price} ${product.currencyCode}`
        : undefined,
    imageAlt: product.imageAlt || undefined,
    currentDescription: stripHtml(product.currentDescription) || undefined,
  };

  return `<product_facts>
${JSON.stringify(facts, null, 2)}
</product_facts>

<brand_voice>
Brand name: ${voice.brandName || "not given"}
Tone: ${voice.tone}
Target audience: ${voice.audience || "general online shoppers"}
Description length: ${LENGTH_GUIDE[voice.length] || LENGTH_GUIDE.medium}
Language: ${voice.language}
Keywords to work in naturally: ${voice.keywords || "none"}
Words and claims to avoid: ${voice.avoidWords || "none"}
</brand_voice>

Write a new product description, SEO title and meta description for this product.
If there is a current description, keep its true facts but improve the writing.`;
}

let client: Anthropic | null = null;
function getClient() {
  if (!client) client = new Anthropic();
  return client;
}

export async function generateCopy(
  product: ProductInput,
  voice: VoiceInput,
): Promise<GeneratedCopy> {
  if (isDemoMode()) return demoCopy(product, voice);

  const response = await getClient().beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    // If a request is declined by a safety classifier, the API retries it on
    // a suitable fallback model inside the same call.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: {
      effort: "medium",
      format: betaZodOutputFormat(CopySchema),
    },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildPrompt(product, voice) }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error(
      "The AI declined to write copy for this product. Try editing the product details.",
    );
  }
  if (response.stop_reason === "max_tokens" || !response.parsed_output) {
    throw new Error("The AI response was incomplete. Please try again.");
  }

  const copy = response.parsed_output;
  return {
    ...copy,
    descriptionHtml: sanitizeHtml(copy.descriptionHtml),
    seoTitle: copy.seoTitle.slice(0, 70),
    seoDescription: copy.seoDescription.slice(0, 160),
    model: response.model,
  };
}
