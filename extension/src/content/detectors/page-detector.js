/**
 * Canvas Page Detector
 *
 * Examines the current URL (and optionally DOM hints) to determine
 * which type of Canvas page the user is on.
 *
 * Returns a PageInfo object or null if the page isn't relevant.
 */

import { CANVAS_URL_PATTERNS } from "../../shared/constants.js";

/**
 * @typedef {Object} PageInfo
 * @property {"single_assignment"|"assignment_list"} type
 * @property {string} courseId
 * @property {string|null} assignmentId  – only set for single_assignment
 * @property {string} url
 */

/**
 * Detect the Canvas page type from a URL string.
 *
 * @param {string} url – The full page URL
 * @returns {PageInfo|null}
 */
export function detectCanvasPage(url) {
  // Try single assignment first (more specific)
  const singleMatch = url.match(CANVAS_URL_PATTERNS.SINGLE_ASSIGNMENT);
  if (singleMatch) {
    return {
      type: "single_assignment",
      courseId: singleMatch[1],
      assignmentId: singleMatch[2],
      url,
    };
  }

  // Assignment list page
  const listMatch = url.match(CANVAS_URL_PATTERNS.ASSIGNMENT_LIST);
  if (listMatch) {
    return {
      type: "assignment_list",
      courseId: listMatch[1],
      assignmentId: null,
      url,
    };
  }

  return null;
}
