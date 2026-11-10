import { useEffect, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  demoCopy,
  LENGTHS,
  sanitizeHtml,
  TONES,
  type VoiceInput,
} from "../lib/copy";
import { fieldValue, useElementEvents } from "../lib/ui";
import { getVoice } from "../lib/voice.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return { voice: await getVoice(session.shop) };
};

const FIELDS = [
  "brandName",
  "tone",
  "audience",
  "length",
  "language",
  "keywords",
  "avoidWords",
] as const;

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();

  const data = Object.fromEntries(
    FIELDS.map((f) => [
      f,
      String(form.get(f) ?? "")
        .trim()
        .slice(0, 500),
    ]),
  ) as unknown as VoiceInput;

  if (!TONES.some((t) => t.value === data.tone)) data.tone = "friendly";
  if (!LENGTHS.some((l) => l.value === data.length)) data.length = "medium";
  if (!data.language) data.language = "English";

  await db.brandVoice.upsert({
    where: { shop: session.shop },
    create: { shop: session.shop, ...data },
    update: data,
  });

  return { saved: true };
};

export default function BrandVoicePage() {
  const { voice } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [form, setForm] = useState<VoiceInput>(voice);
  const saving = fetcher.state !== "idle";
  const dirty = FIELDS.some((f) => form[f] !== voice[f]);

  // After a save the loader revalidates with the cleaned-up values; show
  // those so the form is no longer marked as changed.
  const [savedVoice, setSavedVoice] = useState(voice);
  if (voice !== savedVoice) {
    setSavedVoice(voice);
    setForm(voice);
  }

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.saved) {
      shopify.toast.show("Brand voice saved");
    }
  }, [fetcher.state, fetcher.data, shopify]);

  const update = (key: keyof VoiceInput) => (e: Event) =>
    setForm((f) => ({ ...f, [key]: fieldValue(e) }));

  const toneRef = useElementEvents({ change: update("tone") });
  const lengthRef = useElementEvents({ change: update("length") });

  const save = () => fetcher.submit({ ...form }, { method: "POST" });
  const discard = () => setForm(voice);

  // A live sample so merchants can see the effect of tone and audience.
  const sample = demoCopy(
    {
      title: "Everyday Canvas Tote",
      productType: "Bag",
      options: [{ name: "Color", values: ["Sand", "Olive", "Black"] }],
    },
    form,
  );

  return (
    <s-page heading="Brand voice">
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={save}
        {...(saving ? { loading: true } : {})}
        {...(!dirty && !saving ? { disabled: true } : {})}
      >
        Save
      </s-button>
      {dirty && !saving && (
        <s-button slot="secondary-actions" onClick={discard}>
          Discard changes
        </s-button>
      )}

      <s-section heading="Your brand">
        <s-stack direction="block" gap="base">
          <s-paragraph color="subdued">
            Descripta uses these settings every time it writes product copy, so
            every page in your catalog reads like the same brand.
          </s-paragraph>
          <s-text-field
            label="Brand name"
            value={form.brandName}
            placeholder="Northwind Goods"
            onInput={update("brandName")}
          />
          <s-text-area
            label="Who you sell to"
            rows={2}
            value={form.audience}
            placeholder="Busy city commuters who value durable, simple design"
            details="Describe your typical customer in a sentence."
            onInput={update("audience")}
          />
        </s-stack>
      </s-section>

      <s-section heading="Writing style">
        <s-query-container>
          <s-grid
            gridTemplateColumns="@container (inline-size > 520px) 1fr 1fr, 1fr"
            gap="base"
          >
            <s-select ref={toneRef} label="Tone" value={form.tone}>
              {TONES.map((t) => (
                <s-option key={t.value} value={t.value}>
                  {t.label}
                </s-option>
              ))}
            </s-select>
            <s-select
              ref={lengthRef}
              label="Description length"
              value={form.length}
            >
              {LENGTHS.map((l) => (
                <s-option key={l.value} value={l.value}>
                  {l.label}
                </s-option>
              ))}
            </s-select>
            <s-text-field
              label="Language"
              value={form.language}
              placeholder="English"
              onInput={update("language")}
            />
          </s-grid>
        </s-query-container>
      </s-section>

      <s-section heading="SEO and guardrails">
        <s-stack direction="block" gap="base">
          <s-text-field
            label="Keywords to include"
            details="Comma separated. Used naturally, never stuffed."
            value={form.keywords}
            placeholder="organic cotton, gift ideas"
            onInput={update("keywords")}
          />
          <s-text-field
            label="Words and claims to avoid"
            details="For example, claims your legal team has not approved."
            value={form.avoidWords}
            placeholder="cheap, best in the world, eco-friendly"
            onInput={update("avoidWords")}
          />
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Live sample">
        <s-stack direction="block" gap="base">
          <s-paragraph color="subdued">
            Updates as you type, for an example product.
          </s-paragraph>
          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
            background="subdued"
          >
            <s-stack direction="block" gap="small">
              <s-text type="strong">Everyday Canvas Tote</s-text>
              <div
                className="descripta-preview"
                dangerouslySetInnerHTML={{
                  __html: sanitizeHtml(sample.descriptionHtml),
                }}
              />
            </s-stack>
          </s-box>
          <s-text color="subdued">
            This is a template preview. Claude writes the real copy from each
            product&apos;s details.
          </s-text>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
