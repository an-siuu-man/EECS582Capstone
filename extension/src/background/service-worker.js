/**
 * Headstart AI – MV3 Service Worker
 *
 * Responsibilities:
 *  1. Listen for content-script messages (assignment detected / extracted).
 *  2. Deduplicate assignment events via chrome.storage.local.
 *  3. (Future) Forward ingestion payloads to the backend API.
 *  4. Manage the extension badge to signal new Headstart docs.
 */

import { MESSAGE_TYPES } from "../shared/constants.js";

// ──────────────────────────────────────────────
// Message Router
// ──────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case MESSAGE_TYPES.ASSIGNMENT_DETECTED:
      handleAssignmentDetected(message.payload, sender.tab);
      sendResponse({ status: "ack" });
      break;

    case MESSAGE_TYPES.ASSIGNMENT_DATA:
      handleAssignmentData(message.payload, sender.tab);
      sendResponse({ status: "ack" });
      break;

    default:
      console.warn("[Headstart SW] Unknown message type:", message.type);
      sendResponse({ status: "unknown" });
  }

  // Return true to indicate async sendResponse (not used yet but good practice)
  return true;
});

// ──────────────────────────────────────────────
// Handlers
// ──────────────────────────────────────────────

/**
 * Called when the content script detects a Canvas assignment page.
 * Deduplicates by (courseId, assignmentId) so we don't re-process.
 */
async function handleAssignmentDetected(payload, tab) {
  const { courseId, assignmentId, url, title, courseName, dueDate } = payload;

  // Skip list-page events with no assignmentId
  if (!assignmentId) return;

  const storageKey = `assignment::${courseId}::${assignmentId}`;

  const existing = await chrome.storage.local.get(storageKey);

  // Update logic: if we have more info now (title, courseName, dueDate), merge it
  const update = {
    courseId,
    assignmentId,
    url,
    detectedAt: existing[storageKey]?.detectedAt || new Date().toISOString(),
    status: existing[storageKey]?.status || "detected",
    title: title || existing[storageKey]?.title || null,
    courseName: courseName || existing[storageKey]?.courseName || null,
    dueDate: dueDate || existing[storageKey]?.dueDate || null,
  };

  await chrome.storage.local.set({ [storageKey]: update });

  console.log(
    `[Headstart SW] Assignment updated: course=${courseId} assignment=${assignmentId} title="${update.title}"`,
  );

  // Update badge to signal new assignment if it's truly new or was just detected
  if (!existing[storageKey]) {
    chrome.action.setBadgeText({ text: "!", tabId: tab.id });
    chrome.action.setBadgeBackgroundColor({ color: "#0051BA", tabId: tab.id });
  }
}

/**
 * Called when the content script sends the fully extracted assignment data.
 * Stores locally and (future) forwards to the backend ingestion endpoint.
 */
async function handleAssignmentData(payload, tab) {
  const { courseId, assignmentId, data } = payload;
  const storageKey = `assignment::${courseId}::${assignmentId}`;

  await chrome.storage.local.set({
    [storageKey]: {
      courseId,
      assignmentId,
      url: tab.url,
      detectedAt: new Date().toISOString(),
      status: "extracted",
      data,
    },
  });

  console.log(
    `[Headstart SW] Assignment data stored: course=${courseId} assignment=${assignmentId}`,
    data,
  );

  // TODO: Forward `data` to backend API for generation
  // await fetch(API_ENDPOINT, { method: 'POST', body: JSON.stringify(data) });
}

// ──────────────────────────────────────────────
// Extension Install / Update
// ──────────────────────────────────────────────

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    console.log("[Headstart SW] Extension installed.");
  } else if (details.reason === "update") {
    console.log(
      `[Headstart SW] Extension updated to v${chrome.runtime.getManifest().version}`,
    );
  }
});
