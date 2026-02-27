import { CANVAS_URL_PATTERNS } from "../../shared/constants/canvas.js";
import { createLogger } from "../../shared/logger.js";

const log = createLogger("Detector");

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
    log.debug(
      "Matched single_assignment:",
      `course=${singleMatch[1]} assignment=${singleMatch[2]}`,
    );
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
    log.debug("Matched assignment_list:", `course=${listMatch[1]}`);
    return {
      type: "assignment_list",
      courseId: listMatch[1],
      assignmentId: null,
      url,
    };
  }

  log.debug("No Canvas pattern matched for URL:", url);
  return null;
}
