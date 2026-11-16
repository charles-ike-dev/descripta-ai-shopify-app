import { describe, expect, it } from "vitest";
import { copyChanged, copyToApply, mapLimit, plural, summarize } from "./apply";

const draft = {
  descriptionHtml: "<p>New copy</p>",
  seoTitle: "New title",
  seoDescription: "New description",
};

describe("copyToApply", () => {
  it("uses the stored draft when nothing was edited", () => {
    expect(copyToApply(draft)).toEqual(draft);
  });

  it("prefers the merchant's edits", () => {
    expect(copyToApply(draft, { seoTitle: "Edited" }).seoTitle).toBe("Edited");
  });

  it("sanitises edited HTML", () => {
    const copy = copyToApply(draft, {
      descriptionHtml: '<p onclick="x()">Hi</p><script>alert(1)</script>',
    });
    expect(copy.descriptionHtml).toBe("<p>Hi</p>");
  });

  it("caps SEO fields", () => {
    const copy = copyToApply(draft, {
      seoTitle: "t".repeat(100),
      seoDescription: "d".repeat(400),
    });
    expect(copy.seoTitle).toHaveLength(70);
    expect(copy.seoDescription).toHaveLength(320);
  });
});

describe("copyChanged", () => {
  const seen = {
    descriptionHtml: "<p>Live copy</p>",
    seoTitle: "Title",
    seoDescription: null,
  };

  it("is false for the same copy", () => {
    expect(copyChanged({ ...seen }, seen)).toBe(false);
  });

  it("treats an empty SEO field and a missing one as the same", () => {
    expect(copyChanged({ ...seen, seoDescription: "" }, seen)).toBe(false);
  });

  it("ignores surrounding whitespace", () => {
    expect(
      copyChanged({ ...seen, descriptionHtml: "\n<p>Live copy</p>  " }, seen),
    ).toBe(false);
  });

  it("is true when the description changed", () => {
    expect(
      copyChanged({ ...seen, descriptionHtml: "<p>Edited</p>" }, seen),
    ).toBe(true);
  });

  it("is true when an SEO field changed", () => {
    expect(copyChanged({ ...seen, seoTitle: "Other" }, seen)).toBe(true);
  });
});

describe("mapLimit", () => {
  it("keeps input order and respects the limit", async () => {
    let inFlight = 0;
    let peak = 0;
    const results = await mapLimit([30, 10, 20, 5], 2, async (ms) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, ms));
      inFlight--;
      return ms * 2;
    });
    expect(results).toEqual([60, 20, 40, 10]);
    expect(peak).toBe(2);
  });

  it("handles an empty list", async () => {
    expect(await mapLimit([], 2, async () => 1)).toEqual([]);
  });
});

describe("summarize", () => {
  it("splits results into done, stale and failed", () => {
    expect(
      summarize([
        { id: "a", ok: true },
        { id: "b", ok: false, stale: true, error: "Edited" },
        { id: "c", ok: false, stale: false, error: "Gone" },
        { id: "d", ok: true },
      ]),
    ).toEqual({ done: 2, stale: ["b"], failed: ["c"] });
  });
});

describe("plural", () => {
  it("picks the right form", () => {
    expect(plural(1, "draft")).toBe("1 draft");
    expect(plural(3, "draft")).toBe("3 drafts");
    expect(plural(2, "product was", "products were")).toBe("2 products were");
  });
});
