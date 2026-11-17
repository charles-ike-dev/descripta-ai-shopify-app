/**
 * Bulk draft writing. The drafts are written by the server's background
 * worker, so a run keeps going after the merchant closes the app. This
 * provider lives in the app layout: it starts runs, polls their progress and,
 * when the app opens, picks up the latest run the merchant hasn't dismissed.
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
import { useNavigate, useRevalidator } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { type BulkItemStatus, type BulkJob, MAX_BULK } from "./jobs";

export { MAX_BULK } from "./jobs";
export type { BulkItem, BulkItemStatus, BulkJob } from "./jobs";

/** How often progress is checked while a run is going. */
const POLL_MS = 2000;
/** Wait after a failed progress check, so a blip doesn't hammer the server. */
const POLL_RETRY_MS = 6000;

export interface BulkProduct {
  id: string; // numeric product id
  title: string;
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
  jobId: initialJobId,
  children,
}: {
  /** The run to show when the app opens, from the layout loader. */
  jobId: string | null;
  children: React.ReactNode;
}) {
  const shopify = useAppBridge();
  const revalidator = useRevalidator();
  const navigate = useNavigate();
  const [jobId, setJobId] = useState(initialJobId);
  const [job, setJob] = useState<BulkJob | null>(null);
  const [starting, setStarting] = useState(false);
  // Whether this page saw the run going, so finishing it earns a toast.
  // A run that finished while the merchant was away just shows its banner.
  const sawRunning = useRef(false);

  const api = useCallback(
    async (path: string, init: RequestInit = {}) => {
      const response = await fetch(path, {
        ...init,
        headers: {
          ...init.headers,
          Authorization: `Bearer ${await shopify.idToken()}`,
        },
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw Object.assign(
          new Error(body?.error || `Request failed (${response.status})`),
          { status: response.status, body },
        );
      }
      return body;
    },
    [shopify],
  );

  const finished = useCallback(
    (next: BulkJob) => {
      revalidator.revalidate();
      const done = next.items.filter((i) => i.status === "done").length;
      const failed = next.items.filter((i) => i.status === "failed").length;
      if (done) {
        shopify.toast.show(
          `${done} ${done === 1 ? "draft" : "drafts"} ready to review`,
          { action: "Review", onAction: () => navigate("/app/review") },
        );
      } else if (failed) {
        shopify.toast.show("No drafts were written", { isError: true });
      }
    },
    // revalidator changes identity on every navigation; the latest one is fine.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shopify, navigate],
  );

  // Poll the current run until it finishes.
  useEffect(() => {
    if (!jobId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = (await api(`/app/api/jobs/${jobId}`)) as BulkJob;
        if (!active) return;
        setJob((current) =>
          // Keep "Stopping…" showing until the server has caught up.
          current?.id === next.id && current.cancelling && next.running
            ? { ...next, cancelling: true }
            : next,
        );
        if (next.running) {
          sawRunning.current = true;
          timer = setTimeout(poll, POLL_MS);
        } else if (sawRunning.current) {
          sawRunning.current = false;
          finished(next);
        }
      } catch (error) {
        if (!active) return;
        if ((error as { status?: number }).status === 404) {
          setJob(null);
          setJobId(null);
        } else {
          timer = setTimeout(poll, POLL_RETRY_MS);
        }
      }
    };
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [jobId, api, finished]);

  const start = useCallback(
    async (products: BulkProduct[], replacing?: string) => {
      setStarting(true);
      try {
        const { jobId: id } = (await api("/app/api/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ products }),
        })) as { jobId: string };
        // The new run replaces the finished one, which shouldn't come back.
        // Only now, so a failed start leaves the old banner and its retry.
        if (replacing) {
          api(`/app/api/jobs/${replacing}/dismiss`, { method: "POST" }).catch(
            () => {},
          );
        }
        sawRunning.current = true;
        setJob({
          id,
          running: true,
          cancelling: false,
          items: products.map((p) => ({ ...p, status: "queued" })),
        });
        setJobId(id);
      } catch (error) {
        shopify.toast.show(
          error instanceof Error ? error.message : "Could not start the run",
          { isError: true },
        );
        // Another tab already started a run: show that one instead.
        const running = (error as { body?: { jobId?: string } }).body?.jobId;
        if (running) {
          sawRunning.current = true;
          setJobId(running);
        }
      } finally {
        setStarting(false);
      }
    },
    [api, shopify],
  );

  const value = useMemo<BulkContext>(
    () => ({
      job,
      start: (products) => {
        if (starting || job?.running || products.length === 0) return;
        void start(products.slice(0, MAX_BULK), job?.id);
      },
      cancel: () => {
        if (!job?.running) return;
        setJob({ ...job, cancelling: true });
        api(`/app/api/jobs/${job.id}/cancel`, { method: "POST" }).catch(() => {
          setJob((j) => j && { ...j, cancelling: false });
          shopify.toast.show("Could not stop the run", { isError: true });
        });
      },
      retryFailed: () => {
        if (starting || !job || job.running) return;
        void start(
          job.items
            .filter((i) => i.status === "failed")
            .map(({ id, title }) => ({ id, title })),
          job.id,
        );
      },
      dismiss: () => {
        if (!job || job.running) return;
        void api(`/app/api/jobs/${job.id}/dismiss`, { method: "POST" }).catch(
          () => {},
        );
        setJob(null);
        setJobId(null);
      },
    }),
    [job, start, starting, api, shopify],
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
