/**
 * Headstart AI – Content Script Entry Point
 *
 * Runs on Canvas assignment pages (matched via manifest content_scripts).
 * Responsibilities:
 *  1. Detect which Canvas page type we're on.
 *  2. Extract assignment data from the DOM.
 *  3. Send data to the service worker.
 *  4. Inject the Headstart widget into the page.
 */

import {
  MESSAGE_TYPES,
  CANVAS_SELECTORS,
} from "../shared/constants.js";
import { detectCanvasPage } from "./detectors/page-detector.js";
import { extractAssignmentData } from "./extractors/assignment-extractor.js";
import { injectWidget } from "./ui/widget-injector.js";
import { createLogger } from "../shared/logger.js";

const log = createLogger("Content");

(async function main() {
  log.info("Content script loaded on:", window.location.href);

  // ── Step 1: Detect page type ───────────────────────────────
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

  // Extract course name once for either page type
  const courseNameEl = document.querySelector(CANVAS_SELECTORS.COURSE_NAME);
  const courseName = courseNameEl ? courseNameEl.textContent.trim() : null;
  log.debug("Course name:", courseName ?? "(not found)");

  // ── Step 2: Handle based on page type ──────────────────────
  if (pageInfo.type === "single_assignment" && pageInfo.assignmentId) {
    // Notify service worker about this single assignment
    chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.ASSIGNMENT_DETECTED,
      payload: {
        courseId: pageInfo.courseId,
        assignmentId: pageInfo.assignmentId,
        courseName: courseName,
        url: window.location.href,
      },
    });

    // extractAssignmentData tries the Canvas REST API first (no DOM needed),
    // then falls back to DOM scraping if the API call fails.
    const assignmentData = await extractAssignmentData(document, pageInfo);

    log.info(
      "Extracted assignment data:",
      `title="${assignmentData.title}"`,
      `| dueDate=${assignmentData.dueDate ?? "none"}`,
      `| points=${assignmentData.pointsPossible ?? "none"}`,
      `| rubric=${assignmentData.rubric ? assignmentData.rubric.criteria?.length + " criteria" : "none"}`,
      `| descLen=${assignmentData.descriptionText?.length ?? 0}`,
      `| pdfs=${assignmentData.pdfAttachments?.length ?? 0}`,
    );
    log.debug("Full extracted data:", assignmentData);

    // Send extracted data to service worker
    chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.ASSIGNMENT_DATA,
      payload: {
        courseId: pageInfo.courseId,
        assignmentId: pageInfo.assignmentId,
        data: assignmentData,
      },
    });

    // ── Step 3: Inject the widget ──────────────────────────────
    log.debug("Injecting widget…");
    injectWidget(assignmentData);
  } else if (pageInfo.type === "assignment_list") {
    // ── Assignment list page: detect each assignment with its name and due date ──
    const settled = await waitForSelector(
      ".assignment, .ig-row, #assignment_group",
      5000,
    );
    if (!settled)
      log.warn("waitForSelector (list page) timed out – scraping anyway");

    const assignments = scrapeAssignmentList(pageInfo.courseId, courseName);

    log.info(
      `Assignment list scrape complete: ${assignments.length} assignments found`,
    );

    // Show automatic Sidebar on the list page
    if (assignments.length > 0) {
      injectWidget({
        title: "Course Overview",
        courseName: courseName,
        meta: { courseId: pageInfo.courseId },
        listAssignments: assignments,
      });
    }
  }
})();

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

/**
 * Scrape the assignment list page to detect each assignment with its name and due date.
 */
function scrapeAssignmentList(courseId, courseName) {
  const assignments = [];
  const rows = document.querySelectorAll(CANVAS_SELECTORS.LIST_ASSIGNMENT_ROW);
  const seen = new Set();

  rows.forEach((row) => {
    const link = row.querySelector(CANVAS_SELECTORS.LIST_ASSIGNMENT_TITLE);
    if (!link) return;

    const href = link.getAttribute("href");
    if (!href) return;

    const match = href.match(/\/courses\/(\d+)\/assignments\/(\d+)/);
    if (!match) return;

    const assignmentId = match[2];
    if (seen.has(assignmentId)) return;
    seen.add(assignmentId);

    const title = link.textContent.trim();
    const dueDateEl = row.querySelector(
      CANVAS_SELECTORS.LIST_ASSIGNMENT_DUE_DATE,
    );
    const dueDate = dueDateEl
      ? dueDateEl.textContent.trim().replace(/\s+/g, " ")
      : null;

    log.debug(`List page – found: "${title}" (Due: ${dueDate})`);

    const payload = {
      courseId,
      assignmentId,
      courseName,
      title: title || null,
      dueDate,
      url: href.startsWith("http") ? href : window.location.origin + href,
    };

    assignments.push(payload);

    chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.ASSIGNMENT_DETECTED,
      payload: payload,
    });
  });

  return assignments;
}

/**
 * Waits for a CSS selector to appear in the DOM (up to `timeout` ms).
 * Useful because Canvas often renders content dynamically after page load.
 */
function waitForSelector(selector, timeout = 5000) {
  return new Promise((resolve) => {
    if (document.querySelector(selector)) {
      return resolve(document.querySelector(selector));
    }

    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) {
        observer.disconnect();
        resolve(el);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeout);
  });
}
