import { type AssignmentPayload } from "@/lib/chat-types";

export type RubricCoverageStatus = "covered" | "partial" | "missing";

export type RubricCoverageCriterion = {
  index: number;
  criterion_text: string;
  status: RubricCoverageStatus;
  matched_snippets: string[];
};

export type RubricCoverageResult = {
  rubric_available: boolean;
  criteria: RubricCoverageCriterion[];
};

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "has",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "with",
  "your",
  "you",
  "their",
  "they",
  "them",
  "its",
]);

function normalizeForMatch(value: string) {
  return value
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractKeywords(value: string) {
  const normalized = normalizeForMatch(value);
  if (!normalized) return [];
  const tokens = normalized.split(" ");
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const token of tokens) {
    if (token.length < 3) continue;
    if (STOPWORDS.has(token)) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    keywords.push(token);
  }
  return keywords;
}

function criterionTextFromUnknown(index: number, raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return `Criterion ${index + 1}`;
  }

  const entry = raw as Record<string, unknown>;
  const description =
    typeof entry.description === "string" ? entry.description.trim() : "";
  const longDescription =
    typeof entry.longDescription === "string" ? entry.longDescription.trim() : "";

  if (description && longDescription) {
    return `${description}. ${longDescription}`;
  }
  if (description) return description;
  if (longDescription) return longDescription;

  return `Criterion ${index + 1}`;
}

function trimSnippet(value: string, maxChars = 220) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 3)}...`;
}

function findMatchedSnippets(
  guideLines: string[],
  criterionNormalized: string,
  matchedKeywords: string[],
) {
  const scored: Array<{ index: number; score: number; line: string }> = [];

  for (let index = 0; index < guideLines.length; index += 1) {
    const rawLine = guideLines[index] ?? "";
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    const normalizedLine = normalizeForMatch(trimmed);
    if (!normalizedLine) continue;

    let score = 0;
    if (criterionNormalized && normalizedLine.includes(criterionNormalized)) {
      score += 10;
    }

    const lineTokens = new Set(normalizedLine.split(" "));
    for (const keyword of matchedKeywords) {
      if (lineTokens.has(keyword)) {
        score += 1;
      }
    }

    if (score > 0) {
      scored.push({ index, score, line: trimmed });
    }
  }

  scored.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return left.index - right.index;
  });

  const snippets: string[] = [];
  const seen = new Set<string>();
  for (const row of scored) {
    const snippet = trimSnippet(row.line);
    if (!snippet || seen.has(snippet)) continue;
    seen.add(snippet);
    snippets.push(snippet);
    if (snippets.length >= 2) break;
  }

  return snippets;
}

function toRubricCriteria(payload: AssignmentPayload) {
  const rawRubric = payload.rubric;
  if (!rawRubric || typeof rawRubric !== "object" || Array.isArray(rawRubric)) {
    return [];
  }

  const criteria = (rawRubric as { criteria?: unknown[] }).criteria;
  return Array.isArray(criteria) ? criteria : [];
}

export function analyzeRubricCoverage(
  guideMarkdown: string,
  payload: AssignmentPayload,
): RubricCoverageResult {
  const criteriaList = toRubricCriteria(payload);
  if (criteriaList.length === 0) {
    return {
      rubric_available: false,
      criteria: [],
    };
  }

  const guideNormalized = normalizeForMatch(guideMarkdown || "");
  const guideTokenSet = new Set(guideNormalized.split(" ").filter((token) => token.length > 0));
  const guideLines = (guideMarkdown || "").split(/\r?\n/);

  const criteria = criteriaList.map((criterion, index) => {
    const criterionText = criterionTextFromUnknown(index, criterion);
    const criterionNormalized = normalizeForMatch(criterionText);
    const keywords = extractKeywords(criterionText);
    const matchedKeywords = keywords.filter((keyword) => guideTokenSet.has(keyword));

    let status: RubricCoverageStatus = "missing";
    if (criterionNormalized && guideNormalized.includes(criterionNormalized)) {
      status = "covered";
    } else if (matchedKeywords.length >= 2) {
      status = "partial";
    }

    const snippets = findMatchedSnippets(
      guideLines,
      criterionNormalized,
      matchedKeywords,
    );

    return {
      index,
      criterion_text: criterionText,
      status,
      matched_snippets: snippets,
    };
  });

  return {
    rubric_available: true,
    criteria,
  };
}
