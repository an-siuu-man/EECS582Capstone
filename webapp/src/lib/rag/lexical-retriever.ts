import { type AssignmentPayload } from "@/lib/chat-types";

export type RetrievalChunk = {
  chunk_id: string;
  source: "guide_markdown" | "assignment_payload";
  text: string;
  score: number;
};

function tokenize(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !STOPWORDS.has(token));
}

function buildAssignmentSummary(payload: AssignmentPayload) {
  const lines: string[] = [];

  const title = typeof payload.title === "string" ? payload.title.trim() : "";
  if (title) lines.push(`Title: ${title}`);

  const courseName =
    typeof payload.courseName === "string" ? payload.courseName.trim() : "";
  const courseId = payload.courseId != null ? String(payload.courseId) : "";
  if (courseName || courseId) {
    lines.push(`Course: ${courseName || "(unknown)"} (${courseId || "n/a"})`);
  }

  const assignmentId = payload.assignmentId != null ? String(payload.assignmentId) : "";
  if (assignmentId) lines.push(`Assignment ID: ${assignmentId}`);

  const dueAt = typeof payload.dueAtISO === "string" ? payload.dueAtISO.trim() : "";
  if (dueAt) lines.push(`Due At ISO: ${dueAt}`);

  const timezone =
    typeof payload.userTimezone === "string" ? payload.userTimezone.trim() : "";
  if (timezone) lines.push(`User Timezone: ${timezone}`);

  const description =
    typeof payload.descriptionText === "string" ? payload.descriptionText.trim() : "";
  if (description) lines.push(`Description: ${description}`);

  const points =
    typeof payload.pointsPossible === "number" && Number.isFinite(payload.pointsPossible)
      ? payload.pointsPossible
      : null;
  if (points != null) lines.push(`Points Possible: ${points}`);

  const rubricCount = Array.isArray(payload.rubric?.criteria)
    ? payload.rubric?.criteria.length
    : 0;
  if (rubricCount > 0) lines.push(`Rubric Criteria Count: ${rubricCount}`);

  return lines.join("\n").trim();
}

function chunkText(
  source: RetrievalChunk["source"],
  text: string,
  maxChars: number,
  overlapChars: number,
) {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [] as RetrievalChunk[];

  const paragraphs = normalized
    .split(/\n\s*\n/g)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  const chunks: RetrievalChunk[] = [];
  let index = 0;

  for (const paragraph of paragraphs) {
    if (paragraph.length <= maxChars) {
      chunks.push({
        chunk_id: `${source}-${index}`,
        source,
        text: paragraph,
        score: 0,
      });
      index += 1;
      continue;
    }

    let start = 0;
    while (start < paragraph.length) {
      const end = Math.min(paragraph.length, start + maxChars);
      const slice = paragraph.slice(start, end).trim();
      if (slice.length > 0) {
        chunks.push({
          chunk_id: `${source}-${index}`,
          source,
          text: slice,
          score: 0,
        });
        index += 1;
      }
      if (end >= paragraph.length) break;
      start = Math.max(0, end - overlapChars);
    }
  }

  return chunks;
}

function computeScores(chunks: RetrievalChunk[], query: string) {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return chunks;

  const avgLen =
    chunks.reduce((sum, chunk) => sum + tokenize(chunk.text).length, 0) /
    Math.max(1, chunks.length);

  const docFrequency = new Map<string, number>();
  for (const chunk of chunks) {
    const uniqueTokens = new Set(tokenize(chunk.text));
    for (const token of uniqueTokens) {
      docFrequency.set(token, (docFrequency.get(token) ?? 0) + 1);
    }
  }

  const totalDocs = chunks.length;
  return chunks.map((chunk) => {
    const chunkTokens = tokenize(chunk.text);
    const tokenCounts = new Map<string, number>();
    for (const token of chunkTokens) {
      tokenCounts.set(token, (tokenCounts.get(token) ?? 0) + 1);
    }

    let score = 0;
    const k1 = 1.2;
    const b = 0.75;
    const docLen = Math.max(1, chunkTokens.length);

    for (const token of queryTokens) {
      const tf = tokenCounts.get(token) ?? 0;
      if (tf <= 0) continue;

      const df = docFrequency.get(token) ?? 0;
      const idf = Math.log(1 + (totalDocs - df + 0.5) / (df + 0.5));
      const norm = tf + k1 * (1 - b + (b * docLen) / Math.max(1, avgLen));
      score += idf * ((tf * (k1 + 1)) / norm);
    }

    if (chunk.text.toLowerCase().includes(query.toLowerCase().trim())) {
      score += 1.25;
    }

    return {
      ...chunk,
      score,
    };
  });
}

export function retrieveLexicalContext(input: {
  guideMarkdown: string;
  payload: AssignmentPayload;
  query: string;
  maxChunks?: number;
  maxChars?: number;
}) {
  const maxChunks = input.maxChunks ?? 6;
  const maxChars = input.maxChars ?? 700;
  const overlapChars = 80;

  const payloadSummary = buildAssignmentSummary(input.payload);

  const corpus = [
    ...chunkText("guide_markdown", input.guideMarkdown || "", maxChars, overlapChars),
    ...chunkText("assignment_payload", payloadSummary, maxChars, overlapChars),
  ];

  if (corpus.length === 0) return [] as RetrievalChunk[];

  const scored = computeScores(corpus, input.query)
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => b.score - a.score || a.chunk_id.localeCompare(b.chunk_id));

  if (scored.length > 0) {
    return scored.slice(0, maxChunks);
  }

  return corpus.slice(0, Math.min(maxChunks, corpus.length));
}

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "you",
  "your",
  "are",
  "was",
  "were",
  "have",
  "has",
  "had",
  "will",
  "shall",
  "must",
  "can",
  "could",
  "would",
  "should",
  "into",
  "onto",
  "about",
  "what",
  "when",
  "where",
  "which",
  "their",
  "there",
  "then",
  "than",
  "them",
  "each",
  "also",
  "just",
  "over",
  "under",
  "because",
  "while",
  "within",
  "among",
]);
