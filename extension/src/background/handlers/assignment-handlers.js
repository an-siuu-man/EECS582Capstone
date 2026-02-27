/**
 * Message handlers for assignment detection and extraction updates.
 */

import { createLogger } from "../../shared/logger.js";
import {
  mergeExtractedAssignment,
  upsertDetectedAssignment,
} from "../../storage/assignment-store.js";

const log = createLogger("SW.Handlers");

/**
 * Handle ASSIGNMENT_DETECTED from content script.
 */
export async function handleAssignmentDetected(payload, tab) {
  const { courseId, assignmentId } = payload;

  if (!assignmentId) {
    log.debug("ASSIGNMENT_DETECTED skipped – no assignmentId (list page)");
    return;
  }

  const { isNew, record } = await upsertDetectedAssignment(payload);

  log.info(
    `Assignment ${isNew ? "stored (new)" : "updated (existing)"}:`,
    `course=${courseId} assignment=${assignmentId}`,
    `| title="${record.title}" | dueDate=${record.dueDate}`,
  );

  if (isNew && tab?.id != null) {
    chrome.action.setBadgeText({ text: "!", tabId: tab.id });
    chrome.action.setBadgeBackgroundColor({ color: "#0051BA", tabId: tab.id });
  }
}

/**
 * Handle ASSIGNMENT_DATA from content script.
 */
export async function handleAssignmentData(payload, tab) {
  const { courseId, assignmentId } = payload;
  const { record } = await mergeExtractedAssignment(payload, tab?.url);

  log.info(
    "Assignment data merged:",
    `course=${courseId} assignment=${assignmentId}`,
    `| title="${record.title}" | points=${record.pointsPossible}`,
    `| rubric=${record.rubric ? record.rubric.criteria?.length + " criteria" : "none"}`,
    `| descLen=${record.descriptionText?.length ?? 0}`,
  );

  log.debug("Merged record:", record);
}
