/**
 * Canvas Assignment Data Extractor
 *
 * Scrapes the Canvas assignment page DOM to extract:
 *  - Title
 *  - Description (HTML + plain text)
 *  - Due date
 *  - Points possible
 *  - Submission type
 *  - Rubric (if present)
 */

import { CANVAS_SELECTORS } from "../../shared/constants.js";
import { extractRubric } from "./rubric-extractor.js";

/**
 * @typedef {Object} AssignmentData
 * @property {string} title
 * @property {string} descriptionHtml   – raw HTML of the description
 * @property {string} descriptionText   – plain-text version
 * @property {string|null} dueDate      – ISO-ish date string or raw text
 * @property {string|null} pointsPossible
 * @property {string|null} submissionType
 * @property {import('./rubric-extractor.js').Rubric|null} rubric
 * @property {Object} meta              – courseId, assignmentId, extractedAt
 */

/**
 * Extract all assignment data from the current document.
 *
 * @param {Document} doc – The document to query (allows testing with jsdom)
 * @param {import('../detectors/page-detector.js').PageInfo} pageInfo
 * @returns {AssignmentData}
 */
export function extractAssignmentData(doc, pageInfo) {
  const title = extractTitle(doc);
  const { html: descriptionHtml, text: descriptionText } =
    extractDescription(doc);
  const dueDate = extractDueDate(doc);
  const pointsPossible = extractPointsPossible(doc);
  const submissionType = extractSubmissionType(doc);
  const rubric = extractRubric(doc);

  return {
    title,
    descriptionHtml,
    descriptionText,
    dueDate,
    pointsPossible,
    submissionType,
    rubric,
    meta: {
      courseId: pageInfo.courseId,
      assignmentId: pageInfo.assignmentId,
      url: pageInfo.url,
      extractedAt: new Date().toISOString(),
    },
  };
}

// ──────────────────────────────────────────────
// Individual field extractors
// ──────────────────────────────────────────────

/**
 * Extract the assignment title.
 * Tries multiple selectors because Canvas themes can vary.
 */
function extractTitle(doc) {
  const el = queryFirst(doc, CANVAS_SELECTORS.ASSIGNMENT_TITLE);
  return el ? el.textContent.trim() : "";
}

/**
 * Extract the assignment description as both HTML and plain text.
 */
function extractDescription(doc) {
  const el = queryFirst(doc, CANVAS_SELECTORS.ASSIGNMENT_DESCRIPTION);
  if (!el) return { html: "", text: "" };

  return {
    html: el.innerHTML.trim(),
    text: el.textContent.trim(),
  };
}

/**
 * Extract the due date.
 * Canvas displays dates in various formats – we capture the raw text
 * and the `datetime` attribute when present for reliable parsing.
 */
function extractDueDate(doc) {
  // Canvas often wraps dates in <time datetime="..."> elements
  const timeEl = doc.querySelector(
    ".assignment_dates time, .date-due time, .assignment-date-available time",
  );
  if (timeEl) {
    return timeEl.getAttribute("datetime") || timeEl.textContent.trim();
  }

  const el = queryFirst(doc, CANVAS_SELECTORS.DUE_DATE);
  return el ? el.textContent.trim() : null;
}

/**
 * Extract points possible.
 */
function extractPointsPossible(doc) {
  const el = queryFirst(doc, CANVAS_SELECTORS.POINTS_POSSIBLE);
  if (!el) return null;

  // Attempt to pull just the numeric portion
  const match = el.textContent.match(/[\d.]+/);
  return match ? match[0] : el.textContent.trim();
}

/**
 * Extract submission type (e.g., "Online text entry", "File upload").
 */
function extractSubmissionType(doc) {
  const el = queryFirst(doc, CANVAS_SELECTORS.SUBMISSION_TYPE);
  return el ? el.textContent.trim() : null;
}

// ──────────────────────────────────────────────
// Utility
// ──────────────────────────────────────────────

/**
 * Query the first element matching a comma-separated selector string.
 * Returns null when nothing matches.
 */
function queryFirst(doc, selectorString) {
  // The selector string may contain multiple selectors separated by commas.
  // `querySelector` already handles comma-separated selectors.
  try {
    return doc.querySelector(selectorString);
  } catch {
    // If a selector is malformed, gracefully return null
    return null;
  }
}
