/**
 * Artifact: extension/src/background/handlers/assignment-handlers.js
 * Purpose: Handles assignment detection/extraction runtime messages and synchronizes assignment records in extension storage.
 * Author: Ansuman Sharma
 * Created: 2026-02-27
 * Revised:
 * - 2026-03-01: Added standardized file-level prologue metadata and interface contracts. (Ansuman Sharma)
 * Preconditions:
 * - Background service worker is active with chrome.runtime messaging and chrome.storage.local permissions.
 * Inputs:
 * - Acceptable: ASSIGNMENT_DETECTED and ASSIGNMENT_DATA payloads with Canvas identifiers and extracted assignment fields.
 * - Unacceptable: Missing course/assignment identifiers, malformed payload objects, or non-Canvas message shapes.
 * Postconditions:
 * - Assignment records are inserted/updated in storage and badge state may be updated for newly detected assignments.
 * Returns:
 * - Exported handlers return `Promise<void>` after storage and logging side effects.
 * Errors/Exceptions:
 * - Storage and runtime API failures can throw and are expected to be handled by caller workflow boundaries.
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
