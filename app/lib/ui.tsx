/**
 * Small client-safe UI helpers shared by the app routes.
 */
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

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
} as const;

export function statusBadge(status: string) {
  return (
    STATUS_BADGE[status as keyof typeof STATUS_BADGE] ?? {
      tone: "neutral" as const,
      label: capitalize(status),
    }
  );
}
