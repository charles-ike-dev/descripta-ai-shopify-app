import { describe, expect, it } from "vitest";
import {
  errorMessage,
  nextRunAt,
  pickClaimable,
  retryDelayMs,
  retryable,
  toBulkJob,
} from "./jobs";

const named = (name: string, props: Record<string, unknown> = {}) =>
  Object.assign(new Error("x"), { name }, props);

describe("retryable", () => {
  it("retries rate limits, overloads and server errors", () => {
    expect(retryable(named("RateLimitError", { status: 429 }))).toBe(true);
    expect(retryable(named("APIError", { status: 529 }))).toBe(true);
    expect(retryable(named("InternalServerError", { status: 500 }))).toBe(true);
  });

  it("retries Shopify HTTP errors, which carry the status on response.code", () => {
    expect(
      retryable(named("HttpThrottlingError", { response: { code: 429 } })),
    ).toBe(true);
    expect(
      retryable(named("HttpInternalError", { response: { code: 502 } })),
    ).toBe(true);
  });

  it("retries a throttled GraphQL query", () => {
    const error = Object.assign(new Error("Throttled"), {
      name: "GraphqlQueryError",
      response: { status: 200 },
    });
    expect(retryable(error)).toBe(true);
  });

  it("retries dropped connections", () => {
    expect(retryable(named("APIConnectionError"))).toBe(true);
    expect(retryable(named("HttpRequestError"))).toBe(true);
  });

  it("retries a failed token refresh, thrown as a bare Response", () => {
    expect(retryable(new Response(null, { status: 500 }))).toBe(true);
  });

  it("does not retry errors that will fail again", () => {
    expect(retryable(new Error("Product no longer exists"))).toBe(false);
    expect(retryable(named("BadRequestError", { status: 400 }))).toBe(false);
    expect(retryable(named("SessionNotFoundError"))).toBe(false);
    expect(retryable(null)).toBe(false);
    expect(retryable("oops")).toBe(false);
  });
});

describe("retryDelayMs", () => {
  it("backs off from about 15 seconds to about a minute", () => {
    expect(retryDelayMs(1, () => 0.5)).toBe(15_000);
    expect(retryDelayMs(2, () => 0.5)).toBe(60_000);
  });

  it("stays within 20% either way", () => {
    expect(retryDelayMs(1, () => 0)).toBe(12_000);
    expect(retryDelayMs(1, () => 1)).toBe(18_000);
  });
});

describe("errorMessage", () => {
  it("explains a missing session", () => {
    expect(errorMessage(named("SessionNotFoundError"))).toBe(
      "Descripta is no longer installed on this store",
    );
  });

  it("describes a thrown Response", () => {
    expect(errorMessage(new Response(null, { status: 500 }))).toBe(
      "Shopify could not be reached (500)",
    );
  });

  it("uses the error's own message otherwise", () => {
    expect(errorMessage(new Error("Product no longer exists"))).toBe(
      "Product no longer exists",
    );
    expect(errorMessage("plain")).toBe("plain");
  });
});

describe("pickClaimable", () => {
  const items = [
    { id: "a1", shop: "a" },
    { id: "a2", shop: "a" },
    { id: "a3", shop: "a" },
    { id: "b1", shop: "b" },
    { id: "b2", shop: "b" },
  ];

  it("caps each shop and keeps order", () => {
    expect(pickClaimable(items, new Map(), 10, 2)).toEqual([
      "a1",
      "a2",
      "b1",
      "b2",
    ]);
  });

  it("counts items a shop already has running", () => {
    expect(pickClaimable(items, new Map([["a", 1]]), 10, 2)).toEqual([
      "a1",
      "b1",
      "b2",
    ]);
  });

  it("stops at the free slots", () => {
    expect(pickClaimable(items, new Map(), 3, 2)).toEqual(["a1", "a2", "b1"]);
    expect(pickClaimable(items, new Map(), 0, 2)).toEqual([]);
  });
});

describe("nextRunAt", () => {
  const due = new Date("2026-11-16T02:00:00Z");

  it("moves one interval on when run on time", () => {
    expect(nextRunAt(due, 60, new Date("2026-11-16T02:00:01Z"))).toEqual(
      new Date("2026-11-16T03:00:00Z"),
    );
  });

  it("skips runs missed while the server was down", () => {
    expect(nextRunAt(due, 60, new Date("2026-11-16T05:30:00Z"))).toEqual(
      new Date("2026-11-16T06:00:00Z"),
    );
  });
});

describe("toBulkJob", () => {
  const items = [
    {
      resourceId: "gid://shopify/Product/1",
      title: "One",
      status: "running",
      error: null,
    },
    {
      resourceId: "gid://shopify/Product/2",
      title: "Two",
      status: "failed",
      error: "Gone",
    },
  ];

  it("maps items to numeric ids and the page's statuses", () => {
    const job = toBulkJob(
      { id: "j", status: "running", finishedAt: null },
      items,
    );
    expect(job).toEqual({
      id: "j",
      running: true,
      cancelling: false,
      items: [
        { id: "1", title: "One", status: "writing" },
        { id: "2", title: "Two", status: "failed", error: "Gone" },
      ],
    });
  });

  it("is cancelling while a cancelled job still has items running", () => {
    expect(
      toBulkJob({ id: "j", status: "cancelled", finishedAt: null }, items)
        .cancelling,
    ).toBe(true);
    expect(
      toBulkJob({ id: "j", status: "cancelled", finishedAt: new Date() }, items),
    ).toMatchObject({ running: false, cancelling: false });
  });
});
