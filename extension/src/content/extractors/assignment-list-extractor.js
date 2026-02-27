import { MESSAGE_TYPES } from "../../shared/contracts/messages.js";
import { CANVAS_SELECTORS } from "../../shared/constants/canvas.js";
import { createLogger } from "../../shared/logger.js";

const log = createLogger("ListExtractor");

/**
 * Scrape assignment rows from a Canvas assignment list page.
 */
export function scrapeAssignmentList(courseId, courseName) {
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
      payload,
    });
  });

  return assignments;
}
