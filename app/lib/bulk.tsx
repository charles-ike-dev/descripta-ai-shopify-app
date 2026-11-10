/**
 * Bulk draft writing. The job lives in the app layout so it keeps running
 * while the merchant moves between pages inside the app.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRevalidator } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";

/** Most drafts one run may write, to keep cost and waiting time in check. */
export const MAX_BULK = 25;
/** Drafts written at the same time. */
const CONCURRENCY = 2;

export interface BulkProduct {
  id: string; // numeric product id
  title: string;
}

export type BulkItemStatus =
  | "queued"
  | "writing"
  | "done"
  | "failed"
  | "cancelled";

export interface BulkItem extends BulkProduct {
  status: BulkItemStatus;
  error?: string;
}

export interface BulkJob {
  items: BulkItem[];
  running: boolean;
  cancelling: boolean;
}

interface BulkContext {
  job: BulkJob | null;
  start: (products: BulkProduct[]) => void;
  cancel: () => void;
  retryFailed: () => void;
  dismiss: () => void;
}

const Context = createContext<BulkContext | null>(null);

export function useBulkDrafts() {
  const value = useContext(Context);
  if (!value) throw new Error("useBulkDrafts needs a BulkDraftsProvider");
  return value;
}

export function BulkDraftsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const shopify = useAppBridge();
  const revalidator = useRevalidator();
  const [job, setJob] = useState<BulkJob | null>(null);
  const cancelled = useRef(false);

  const setItem = (id: string, patch: Partial<BulkItem>) =>
    setJob(
      (j) =>
        j && {
          ...j,
          items: j.items.map((i) => (i.id === id ? { ...i, ...patch } : i)),
        },
    );

  const writeDraft = useCallback(
    async (item: BulkProduct) => {
      const body = new FormData();
      body.set("productId", item.id);
      const response = await fetch("/app/api/drafts", {
        method: "POST",
        body,
        headers: { Authorization: `Bearer ${await shopify.idToken()}` },
      });
      const result = (await response.json().catch(() => null)) as {
        ok: boolean;
        error?: string;
      } | null;
      if (!response.ok || !result?.ok) {
        throw new Error(result?.error || `Request failed (${response.status})`);
      }
    },
    [shopify],
  );

  const run = useCallback(
    async (products: BulkProduct[]) => {
      cancelled.current = false;
      setJob({
        items: products.map((p) => ({ ...p, status: "queued" })),
        running: true,
        cancelling: false,
      });

      let next = 0;
      let done = 0;
      let failed = 0;
      const worker = async () => {
        while (!cancelled.current && next < products.length) {
          const item = products[next++];
          setItem(item.id, { status: "writing" });
          try {
            await writeDraft(item);
            done++;
            setItem(item.id, { status: "done" });
          } catch (error) {
            failed++;
            setItem(item.id, {
              status: "failed",
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, products.length) }, worker),
      );

      setJob(
        (j) =>
          j && {
            running: false,
            cancelling: false,
            items: j.items.map((i) =>
              i.status === "queued" ? { ...i, status: "cancelled" } : i,
            ),
          },
      );
      revalidator.revalidate();
      if (done) {
        shopify.toast.show(
          `${done} ${done === 1 ? "draft" : "drafts"} ready to review`,
        );
      } else if (failed) {
        shopify.toast.show("No drafts were written", { isError: true });
      }
    },
    // revalidator changes identity on every navigation; the latest one is fine.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shopify, writeDraft],
  );

  // Leaving the app mid-run would abandon the remaining products.
  const running = Boolean(job?.running);
  useEffect(() => {
    if (!running) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running]);

  const value = useMemo<BulkContext>(
    () => ({
      job,
      start: (products) => {
        if (job?.running || products.length === 0) return;
        void run(products.slice(0, MAX_BULK));
      },
      cancel: () => {
        cancelled.current = true;
        setJob((j) => j && { ...j, cancelling: true });
      },
      retryFailed: () => {
        if (!job || job.running) return;
        void run(job.items.filter((i) => i.status === "failed"));
      },
      dismiss: () => {
        if (!job?.running) setJob(null);
      },
    }),
    [job, run],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function bulkSummary(job: BulkJob) {
  const count = (status: BulkItemStatus) =>
    job.items.filter((i) => i.status === status).length;
  const done = count("done");
  const failed = count("failed");
  const cancelled = count("cancelled");
  const finished = done + failed + cancelled;
  return {
    total: job.items.length,
    done,
    failed,
    cancelled,
    finished,
    percent: Math.round((finished / Math.max(1, job.items.length)) * 100),
  };
}
