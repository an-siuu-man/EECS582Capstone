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

import { CANVAS_URL_PATTERNS, MESSAGE_TYPES, CANVAS_SELECTORS } from "../shared/constants.js";
import { detectCanvasPage } from "./detectors/page-detector.js";
import { extractAssignmentData } from "./extractors/assignment-extractor.js";
import { injectWidget } from "./ui/widget-injector.js";

(async function main() {
  console.log("[Headstart] Content script loaded on:", window.location.href);

  // ── Step 1: Detect page type ───────────────────────────────
  const pageInfo = detectCanvasPage(window.location.href);

  if (!pageInfo) {
    console.log(
      "[Headstart] Not a recognised Canvas assignment page – exiting.",
    );
    return;
  }

  console.log("[Headstart] Detected page:", pageInfo);

  // Extract course name once for either page type
  const courseNameEl = document.querySelector(CANVAS_SELECTORS.COURSE_NAME);
  const courseName = courseNameEl ? courseNameEl.textContent.trim() : null;

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

    // Wait briefly for Canvas to finish rendering dynamic content
    await waitForSelector("#assignment_show, .assignment-title", 5000);

    const assignmentData = extractAssignmentData(document, pageInfo);

    console.log("[Headstart] Extracted assignment data:", assignmentData);

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
    injectWidget(assignmentData);
  } else if (pageInfo.type === "assignment_list") {
    // ── Assignment list page: detect each assignment with its name and due date ──
    await waitForSelector(".assignment, .ig-row, #assignment_group", 5000);
    const assignments = scrapeAssignmentList(pageInfo.courseId, courseName);

    // Show automatic Sidebar on the list page
    if (assignments.length > 0) {
      injectWidget({
        title: "Course Overview",
        courseName: courseName,
        meta: { courseId: pageInfo.courseId },
        listAssignments: assignments
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
    const dueDateEl = row.querySelector(CANVAS_SELECTORS.LIST_ASSIGNMENT_DUE_DATE);
    const dueDate = dueDateEl ? dueDateEl.textContent.trim().replace(/\s+/g, " ") : null;

    console.log(
      `[Headstart] List page – found: "${title}" (Due: ${dueDate})`,
    );

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
