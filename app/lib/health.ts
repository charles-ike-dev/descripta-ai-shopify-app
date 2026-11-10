/**
 * Copy health scoring, shared by the products list and its filters.
 * Only counts what Descripta can fix: the description and the SEO listing.
 */

/** Word count each brand voice length setting aims for (lower bound). */
const TARGET_WORDS: Record<string, number> = {
  short: 60,
  medium: 120,
  long: 220,
};

export const GOOD_SCORE = 90;

export interface HealthInput {
  descriptionWords: number;
  seoTitle: string | null;
  seoDescription: string | null;
}

export interface Health {
  score: number;
  tone: "success" | "caution" | "warning" | "critical";
  label: string;
  issues: string[];
}

export function targetWords(voiceLength: string) {
  return TARGET_WORDS[voiceLength] ?? TARGET_WORDS.medium;
}

export function scoreCopy(p: HealthInput, voiceLength: string): Health {
  const target = targetWords(voiceLength);
  const issues: string[] = [];
  let score = 0;

  // Description: 60 points, scaled against the brand voice target length.
  if (p.descriptionWords === 0) {
    issues.push("No description");
  } else if (p.descriptionWords < target / 2) {
    score += 20;
    issues.push(`Very short (${p.descriptionWords} words)`);
  } else if (p.descriptionWords < target) {
    score += 45;
    issues.push(`Below ${target}-word target`);
  } else {
    score += 60;
  }

  // SEO listing: 40 points.
  if (p.seoTitle?.trim()) score += 15;
  else issues.push("No SEO title");
  if (p.seoDescription?.trim()) score += 25;
  else issues.push("No meta description");

  const [tone, label] =
    score >= GOOD_SCORE
      ? (["success", "Great"] as const)
      : score >= 60
        ? (["caution", "Fair"] as const)
        : score >= 30
          ? (["warning", "Weak"] as const)
          : (["critical", "Poor"] as const);

  return { score, tone, label, issues };
}
