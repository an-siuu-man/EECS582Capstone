/**
 * Artifact: extension/src/content/index.js
 * Purpose: Content-script entrypoint that detects Canvas page type and dispatches the proper content workflow.
 * Author: Ansuman Sharma
 * Created: 2026-02-27
 * Revised:
 * - 2026-02-27: Refactored page logic into dedicated single-assignment and assignment-list workflows. (Ansuman Sharma)
 * Preconditions:
 * - Script executes on Canvas assignment URLs where DOM access and `chrome.runtime` messaging are permitted.
 * Inputs:
 * - Acceptable: Canvas assignment/list URLs and Canvas DOM structures matching configured selectors.
 * - Unacceptable: Non-Canvas pages or unsupported DOM structures missing required selectors.
 * Postconditions:
 * - The relevant detection/extraction workflow runs and widget injection occurs when appropriate.
 * Returns:
 * - No return value; asynchronous IIFE performs side-effectful runtime actions.
 * Errors/Exceptions:
 * - Workflow-level extraction/messaging failures are logged and handled by downstream modules.
 */

import { CANVAS_SELECTORS } from "../shared/constants/canvas.js";
import { createLogger } from "../shared/logger.js";
import { detectCanvasPage } from "./detectors/page-detector.js";
import { runAssignmentListFlow } from "./workflows/assignment-list-workflow.js";
import { runSingleAssignmentFlow } from "./workflows/single-assignment-workflow.js";

const log = createLogger("Content");

(async function main() {
  log.info("Content script loaded on:", window.location.href);

  const pageInfo = detectCanvasPage(window.location.href);

  if (!pageInfo) {
    log.debug("Not a recognised Canvas assignment page – exiting.");
    return;
  }

  log.info(
    "Detected page:",
    pageInfo.type,
    `| course=${pageInfo.courseId} assignment=${pageInfo.assignmentId ?? "(list)"}`,
  );

  const courseName = extractCourseName();
  log.debug("Course name:", courseName ?? "(not found)");

  if (pageInfo.type === "single_assignment" && pageInfo.assignmentId) {
    await runSingleAssignmentFlow(pageInfo, courseName);
    return;
  }

  if (pageInfo.type === "assignment_list") {
    await runAssignmentListFlow(pageInfo.courseId, courseName);
  }
})();

function extractCourseName() {
  const courseNameEl = document.querySelector(CANVAS_SELECTORS.COURSE_NAME);
  return courseNameEl ? courseNameEl.textContent.trim() : null;
}
