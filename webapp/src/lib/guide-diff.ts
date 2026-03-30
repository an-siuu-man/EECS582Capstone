export type GuideDiffLineType = "context" | "added" | "removed";

export type GuideDiffLine = {
  type: GuideDiffLineType;
  text: string;
};

export type GuideDiffSummary = {
  added_lines: number;
  removed_lines: number;
  changed_sections: number;
};

export type GuideDiffResult = {
  summary: GuideDiffSummary;
  diff: GuideDiffLine[];
};

const HEADING_PATTERN = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/;
const MAX_LCS_MATRIX_CELLS = 4_000_000;

function splitLines(value: string) {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

function toHeadingKey(line: string) {
  const match = line.match(HEADING_PATTERN);
  if (!match) return null;
  const heading = match[1]?.trim();
  return heading && heading.length > 0 ? heading.toLocaleLowerCase() : null;
}

function findSectionKey(lines: string[], lineIndex: number) {
  for (let cursor = lineIndex; cursor >= 0; cursor -= 1) {
    const key = toHeadingKey(lines[cursor] ?? "");
    if (key) return key;
  }
  return "__root__";
}

function buildFallbackDiff(fromLines: string[], toLines: string[]) {
  let prefix = 0;
  const maxPrefix = Math.min(fromLines.length, toLines.length);
  while (prefix < maxPrefix && fromLines[prefix] === toLines[prefix]) {
    prefix += 1;
  }

  let suffix = 0;
  const fromRemaining = fromLines.length - prefix;
  const toRemaining = toLines.length - prefix;
  const maxSuffix = Math.min(fromRemaining, toRemaining);
  while (
    suffix < maxSuffix &&
    fromLines[fromLines.length - 1 - suffix] === toLines[toLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const diff: GuideDiffLine[] = [];
  const changedFromIndices = new Set<number>();
  const changedToIndices = new Set<number>();

  for (let i = 0; i < prefix; i += 1) {
    diff.push({ type: "context", text: fromLines[i] ?? "" });
  }

  const fromMiddleEnd = fromLines.length - suffix;
  for (let i = prefix; i < fromMiddleEnd; i += 1) {
    diff.push({ type: "removed", text: fromLines[i] ?? "" });
    changedFromIndices.add(i);
  }

  const toMiddleEnd = toLines.length - suffix;
  for (let i = prefix; i < toMiddleEnd; i += 1) {
    diff.push({ type: "added", text: toLines[i] ?? "" });
    changedToIndices.add(i);
  }

  for (let i = suffix; i > 0; i -= 1) {
    diff.push({ type: "context", text: fromLines[fromLines.length - i] ?? "" });
  }

  return { diff, changedFromIndices, changedToIndices };
}

function buildLcsDiff(fromLines: string[], toLines: string[]) {
  const aLen = fromLines.length;
  const bLen = toLines.length;
  const rowWidth = bLen + 1;
  const matrix = new Uint32Array((aLen + 1) * (bLen + 1));

  for (let i = aLen - 1; i >= 0; i -= 1) {
    for (let j = bLen - 1; j >= 0; j -= 1) {
      const idx = i * rowWidth + j;
      const down = matrix[(i + 1) * rowWidth + j];
      const right = matrix[i * rowWidth + (j + 1)];
      const diagonal = matrix[(i + 1) * rowWidth + (j + 1)];
      matrix[idx] = fromLines[i] === toLines[j] ? diagonal + 1 : Math.max(down, right);
    }
  }

  const diff: GuideDiffLine[] = [];
  const changedFromIndices = new Set<number>();
  const changedToIndices = new Set<number>();
  let i = 0;
  let j = 0;

  while (i < aLen && j < bLen) {
    if (fromLines[i] === toLines[j]) {
      diff.push({ type: "context", text: fromLines[i] ?? "" });
      i += 1;
      j += 1;
      continue;
    }

    const down = matrix[(i + 1) * rowWidth + j];
    const right = matrix[i * rowWidth + (j + 1)];

    if (right >= down) {
      diff.push({ type: "added", text: toLines[j] ?? "" });
      changedToIndices.add(j);
      j += 1;
    } else {
      diff.push({ type: "removed", text: fromLines[i] ?? "" });
      changedFromIndices.add(i);
      i += 1;
    }
  }

  while (i < aLen) {
    diff.push({ type: "removed", text: fromLines[i] ?? "" });
    changedFromIndices.add(i);
    i += 1;
  }

  while (j < bLen) {
    diff.push({ type: "added", text: toLines[j] ?? "" });
    changedToIndices.add(j);
    j += 1;
  }

  return { diff, changedFromIndices, changedToIndices };
}

function countChangedSections(
  fromLines: string[],
  toLines: string[],
  changedFromIndices: Set<number>,
  changedToIndices: Set<number>,
) {
  if (changedFromIndices.size === 0 && changedToIndices.size === 0) return 0;

  const sectionKeys = new Set<string>();
  for (const index of changedFromIndices) {
    sectionKeys.add(findSectionKey(fromLines, index));
  }
  for (const index of changedToIndices) {
    sectionKeys.add(findSectionKey(toLines, index));
  }

  return sectionKeys.size;
}

export function buildGuideDiff(fromText: string, toText: string): GuideDiffResult {
  const fromLines = splitLines(fromText || "");
  const toLines = splitLines(toText || "");
  const lcsCells = fromLines.length * toLines.length;

  const { diff, changedFromIndices, changedToIndices } =
    lcsCells <= MAX_LCS_MATRIX_CELLS
      ? buildLcsDiff(fromLines, toLines)
      : buildFallbackDiff(fromLines, toLines);

  let addedLines = 0;
  let removedLines = 0;
  for (const line of diff) {
    if (line.type === "added") addedLines += 1;
    if (line.type === "removed") removedLines += 1;
  }

  return {
    summary: {
      added_lines: addedLines,
      removed_lines: removedLines,
      changed_sections: countChangedSections(
        fromLines,
        toLines,
        changedFromIndices,
        changedToIndices,
      ),
    },
    diff,
  };
}
