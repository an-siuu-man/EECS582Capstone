/**
 * Headstart AI – MV3 Service Worker
 *
 * Responsibilities:
 *  1. Listen for content-script messages (assignment detected / extracted).
 *  2. Deduplicate assignment events via chrome.storage.local.
 *  3. Build a normalized "Headstart payload" for the currently-open assignment
 *     when the user clicks "Generate Guide" in the sidebar.
 *  4. (Future) Forward ingestion payloads to the backend API for AI generation.
 *  5. Manage the extension badge to signal new Headstart docs.
 */

import { MESSAGE_TYPES } from "../shared/constants.js";

// ──────────────────────────────────────────────
// Helpers (NEW)
// ──────────────────────────────────────────────

/**
 * Extract (courseId, assignmentId) from a standard Canvas assignment URL.
 * Example: /courses/176517/assignments/1295092
 */
function getCanvasIdsFromUrl(url) {
  const m = url?.match(/\/courses\/(\d+)\/assignments\/(\d+)/);
  if (!m) return null;
  return { courseId: m[1], assignmentId: m[2] };
}

/**
 * Parse Canvas due date strings into a real Date object.
 * Current observed format: "Due Feb 15 at 11:59pm Feb 15 at 11:59pm"
 * We parse the first "Mon DD at HH:MM(am|pm)" occurrence.
 *
 * Note: This assumes the current year and local timezone.
 * Later, we can improve by extracting year/timezone if Canvas provides it.
 */
function parseCanvasDueDate(dueDateRaw) {
  if (!dueDateRaw) return null;

  // NEW: Extract month/day/time (first match) from the human-readable due date string
  const m = dueDateRaw.match(
    /([A-Za-z]{3})\s+(\d{1,2})\s+at\s+(\d{1,2}):(\d{2})(am|pm)/i,
  );
  if (!m) return null;

  const monthStr = m[1].toLowerCase();
  const day = parseInt(m[2], 10);
  let hour = parseInt(m[3], 10);
  const minute = parseInt(m[4], 10);
  const ampm = m[5].toLowerCase();

  // NEW: Convert 12-hour time into 24-hour time
  if (ampm === "pm" && hour !== 12) hour += 12;
  if (ampm === "am" && hour === 12) hour = 0;

  // NEW: Map 3-letter month abbreviations to Date month index
  const months = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };
  const month = months[monthStr];
  if (month === undefined) return null;

  // NEW: Canvas due dates don’t show the year in the string we observed
  const year = new Date().getFullYear();

  // NEW: Construct a local Date (timezone = the user's machine timezone)
  return new Date(year, month, day, hour, minute, 0, 0);
}

/**
 * Build a normalized payload that is stable for downstream use (API + AI agent),
 * even if the stored record format differs:
 *  - "detected" format: top-level fields (title, dueDate, url, courseName, etc.)
 *  - "extracted" format: nested `data` object
 */
function buildHeadstartPayload(stored) {
  // NEW: Normalize differences between detected vs extracted record formats
  const source = stored?.data ? stored.data : stored;

  // NEW: Prefer due date from extracted data if present, else from detected record
  const dueDateRaw = source?.dueDate || stored?.dueDate || null;

  // NEW: Parse into a Date and compute timing flags
  const due = parseCanvasDueDate(dueDateRaw);
  const now = new Date();

  const daysToDue = due
    ? Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    : null;

  // NEW: Return stable schema for later API/agent integration
  return {
    courseId: stored?.courseId ?? source?.courseId ?? null,
    courseName: stored?.courseName ?? source?.courseName ?? null,
    assignmentId: stored?.assignmentId ?? source?.assignmentId ?? null,

    title: source?.title ?? stored?.title ?? "",
    url: source?.url ?? stored?.url ?? "",

    detectedAt: stored?.detectedAt ?? null,
    status: stored?.status ?? null,

    dueDateRaw,
    dueAtISO: due ? due.toISOString() : null,

    flags: {
      daysToDue,
      isOverdue: typeof daysToDue === "number" ? daysToDue < 0 : false,
      isDueSoon:
        typeof daysToDue === "number" ? daysToDue >= 0 && daysToDue <= 3 : false,
    },

    // Placeholders for next steps (description/rubric/pdfs)
    descriptionText: source?.descriptionText ?? null,
    rubric: source?.rubric ?? null,
    pdfs: source?.pdfs ?? [],
  };
}

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

    /**
     * NEW: Triggered by sidebar action button ("Generate Guide").
     * Builds the normalized payload for the currently-open assignment page
     * and sends it back to the content script.
     */
    case "START_HEADSTART_RUN":
      handleStartHeadstartRun(sender.tab, message.pageTitle);
      sendResponse({ ok: true });
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

  // Load existing record so we can MERGE instead of overwrite
  const existing = await chrome.storage.local.get(storageKey);
  const prev = existing?.[storageKey] || {};

  // The extractor data might include some of these fields; if not, keep previous
  const next = {
    // Stable identity
    courseId,
    assignmentId,

    // Always keep the current tab URL (most accurate)
    url: tab.url,

    // Preserve original detected timestamp if present
    detectedAt: prev.detectedAt || new Date().toISOString(),

    // Update status
    status: "extracted",

    // Keep these at top-level so payload builder always finds them
    title: (data?.title && data.title.trim() !== "") ? data.title : (prev.title ?? null),
    courseName: (data?.courseName && data.courseName.trim() !== "") ? data.courseName : (prev.courseName ?? null),
    dueDate: (data?.dueDate && data.dueDate.trim() !== "") ? data.dueDate : (prev.dueDate ?? null),

    // Merge in other extracted fields if they exist (safe defaults)
    pointsPossible: data?.pointsPossible ?? prev.pointsPossible ?? null,
    descriptionText: data?.descriptionText ?? prev.descriptionText ?? null,
    rubric: data?.rubric ?? prev.rubric ?? null,
    pdfs: data?.pdfs ?? prev.pdfs ?? [],
  };

  await chrome.storage.local.set({ [storageKey]: next });

  console.log(
    `[Headstart SW] Assignment data merged: course=${courseId} assignment=${assignmentId}`,
    next,
  );


  console.log(
    `[Headstart SW] Assignment data stored: course=${courseId} assignment=${assignmentId}`,
    data,
  );

  // TODO: Forward `data` to backend API for generation
  // await fetch(API_ENDPOINT, { method: 'POST', body: JSON.stringify(data) });
}

/**
 * NEW: Build and send a normalized payload for the currently-open assignment tab.
 * This is the bridge between "scraping" and "AI generation" (next step).
 */
async function handleStartHeadstartRun(tab, pageTitle) {
  // NEW: Extract courseId/assignmentId from the current tab URL
  const ids = getCanvasIdsFromUrl(tab?.url || "");
  if (!ids) {
    chrome.tabs.sendMessage(tab.id, {
      type: "HEADSTART_ERROR",
      error: "Not on a Canvas assignment page.",
    });
    return;
  }

  // NEW: Load the stored assignment record from chrome.storage.local
  const storageKey = `assignment::${ids.courseId}::${ids.assignmentId}`;
  const obj = await chrome.storage.local.get(storageKey);
  const stored = obj?.[storageKey];

  if (!stored) {
    chrome.tabs.sendMessage(tab.id, {
      type: "HEADSTART_ERROR",
      error: `No stored assignment found for key ${storageKey}`,
    });
    return;
  }

  // NEW: Normalize and compute due-date flags
  const payload = buildHeadstartPayload(stored);

  console.log("[Headstart SW] Built payload:", payload);

  // NEW: fallback title from content script if storage/extractor didn't have it
  if ((!payload.title || payload.title.trim() === "") && pageTitle) {
    payload.title = pageTitle.replace(" - Assignments", "").trim();
  }
  
  // NEW: Send payload back to the content script (sidebar) for display/debug
  chrome.tabs.sendMessage(tab.id, {
    type: "HEADSTART_PAYLOAD",
    payload,
  });
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