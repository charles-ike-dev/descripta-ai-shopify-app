/**
 * Small client-safe UI helpers shared by the app routes.
 */
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { sanitizeHtml } from "./copy";

const noopSubscribe = () => () => {};

/**
 * React 18 drops `on*` props it does not know (such as `onNextPage`) and only
 * fires `onChange` for native form elements, so Polaris web component events
 * are attached by hand. Returns a callback ref for the element.
 */
export function useElementEvents(
  handlers: Record<string, ((event: Event) => void) | undefined>,
) {
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });
  const cleanup = useRef<(() => void) | null>(null);
  const types = Object.keys(handlers).join(",");

  return useCallback(
    (element: Element | null) => {
      cleanup.current?.();
      cleanup.current = null;
      if (!element) return;
      const listeners = types.split(",").map((type) => {
        const listener = (event: Event) => latest.current[type]?.(event);
        element.addEventListener(type, listener);
        return [type, listener] as const;
      });
      cleanup.current = () =>
        listeners.forEach(([type, listener]) =>
          element.removeEventListener(type, listener),
        );
    },
    [types],
  );
}

/** The current value of a Polaris field from one of its events. */
export const fieldValue = (event: Event) =>
  (event.currentTarget as unknown as HTMLInputElement).value;

export const capitalize = (text: string) =>
  text ? text[0].toUpperCase() + text.slice(1).toLowerCase() : text;

/** "claude-opus-5-5" -> "Claude Opus 5.5", "demo-template" -> "Demo template". */
export function modelLabel(model: string) {
  if (model === "demo-template") return "Demo template";
  const match = model.match(/^claude-([a-z]+)-(\d+)(?:-(\d+))?/);
  if (!match) return model;
  const [, family, major, minor] = match;
  return `Claude ${capitalize(family)} ${minor && minor.length < 3 ? `${major}.${minor}` : major}`;
}

const dateFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});
const timeFormat = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
});

/**
 * Shows a timestamp in the merchant's own time zone. The server does not know
 * that zone, so it renders the date only and the time appears after hydration.
 */
export function DateTime({ iso }: { iso: string }) {
  const hydrated = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );

  const date = new Date(iso);
  if (!hydrated) {
    return <time dateTime={iso}>{iso.slice(0, 10)}</time>;
  }

  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const day = sameDay(date, today)
    ? "Today"
    : sameDay(date, yesterday)
      ? "Yesterday"
      : dateFormat.format(date);

  return (
    <time dateTime={iso} title={date.toLocaleString()}>
      {day} at {timeFormat.format(date)}
    </time>
  );
}

export const STATUS_BADGE = {
  draft: { tone: "info", label: "Draft" },
  applied: { tone: "success", label: "Applied" },
  reverted: { tone: "neutral", label: "Reverted" },
  replaced: { tone: "neutral", label: "Replaced" },
  discarded: { tone: "neutral", label: "Discarded" },
} as const;

export function statusBadge(status: string) {
  return (
    STATUS_BADGE[status as keyof typeof STATUS_BADGE] ?? {
      tone: "neutral" as const,
      label: capitalize(status),
    }
  );
}

/**
 * A Polaris checkbox driven from React state. The checked state is set as a
 * property because React 18 can only set attributes on custom elements.
 */
export function SelectBox({
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

/** Product description HTML, rendered the way it reads on the storefront. */
export function HtmlPreview({ html, empty }: { html: string; empty?: string }) {
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
