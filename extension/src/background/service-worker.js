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
import { createLogger } from "../shared/logger.js";

const log = createLogger("SW");

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
 * Handles two formats:
 *   1. ISO-8601 from Canvas API (e.g., "2025-02-15T23:59:00Z")
 *   2. Human-readable from DOM scraping (e.g., "Due Feb 15 at 11:59pm")
 */
function parseCanvasDueDate(dueDateRaw) {
  if (!dueDateRaw) return null;

  // Handle ISO-8601 dates from Canvas API (e.g., "2025-02-15T23:59:00Z")
  if (/^\d{4}-\d{2}-\d{2}T/.test(dueDateRaw)) {
    const d = new Date(dueDateRaw);
    return isNaN(d.getTime()) ? null : d;
  }

  // Fallback: parse human-readable "Mon DD at HH:MM(am|pm)" format
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
    jan: 0,
    feb: 1,
    mar: 2,
    apr: 3,
    may: 4,
    jun: 5,
    jul: 6,
    aug: 7,
    sep: 8,
    oct: 9,
    nov: 10,
    dec: 11,
  };
  const month = months[monthStr];
  if (month === undefined) return null;

  // NEW: Canvas due dates don’t show the year in the string we observed
  const year = new Date().getFullYear();

  // NEW: Construct a local Date (timezone = the user's machine timezone)
  return new Date(year, month, day, hour, minute, 0, 0);
}

/**
 * Format an ISO-8601 date string into a human-readable string in the given IANA timezone.
 * Falls back to the browser's local timezone if none is provided.
 *
 * @param {string|null} isoString
 * @param {string|null} timezone – IANA timezone (e.g. "America/New_York")
 * @returns {string|null}
 */
function formatDateInTimezone(isoString, timezone) {
  if (!isoString) return null;
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return null;
    const opts = {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    };
    if (timezone) opts.timeZone = timezone;
    return new Intl.DateTimeFormat("en-US", opts).format(d);
  } catch {
    return null;
  }
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

  // Extract user timezone (IANA string from Canvas profile API)
  const userTimezone = source?.userTimezone || stored?.userTimezone || null;

  // Format the due date in the user's Canvas timezone for display and agent use
  const dueAtISO = due ? due.toISOString() : null;
  const dueDateFormatted = formatDateInTimezone(dueAtISO, userTimezone);

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
    dueAtISO,
    dueDateFormatted,
    userTimezone,

    flags: {
      daysToDue,
      isOverdue: typeof daysToDue === "number" ? daysToDue < 0 : false,
      isDueSoon:
        typeof daysToDue === "number"
          ? daysToDue >= 0 && daysToDue <= 3
          : false,
    },

    // Placeholders for next steps (description/rubric/pdfs)
    descriptionText: source?.descriptionText ?? null,
    rubric: source?.rubric ?? null,
    pdfs: source?.pdfs ?? [],
    pdfAttachments: source?.pdfAttachments ?? stored?.pdfAttachments ?? [],
  };
}

// ──────────────────────────────────────────────
// Message Router
// ──────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  log.debug(
    "Message received:",
    message.type,
    "| tab:",
    sender.tab?.id,
    sender.tab?.url?.slice(0, 80),
  );

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
      log.info(
        "START_HEADSTART_RUN received for tab:",
        sender.tab?.id,
        "| pageTitle:",
        message.pageTitle,
      );
      handleStartHeadstartRun(sender.tab, message.pageTitle);
      sendResponse({ ok: true });
      break;

    default:
      log.warn("Unknown message type:", message.type);
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
  if (!assignmentId) {
    log.debug("ASSIGNMENT_DETECTED skipped – no assignmentId (list page)");
    return;
  }

  const storageKey = `assignment::${courseId}::${assignmentId}`;

  const existing = await chrome.storage.local.get(storageKey);
  const isNew = !existing[storageKey];

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

  log.info(
    `Assignment ${isNew ? "stored (new)" : "updated (existing)"}:`,
    `course=${courseId} assignment=${assignmentId}`,
    `| title="${update.title}" | dueDate=${update.dueDate}`,
  );

  // Update badge to signal new assignment if it's truly new or was just detected
  if (isNew) {
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
    title:
      data?.title && data.title.trim() !== ""
        ? data.title
        : (prev.title ?? null),
    courseName:
      data?.courseName && data.courseName.trim() !== ""
        ? data.courseName
        : (prev.courseName ?? null),
    dueDate:
      data?.dueDate && data.dueDate.trim() !== ""
        ? data.dueDate
        : (prev.dueDate ?? null),

    // Merge in other extracted fields if they exist (safe defaults)
    pointsPossible: data?.pointsPossible ?? prev.pointsPossible ?? null,
    descriptionText: data?.descriptionText ?? prev.descriptionText ?? null,
    rubric: data?.rubric ?? prev.rubric ?? null,
    userTimezone: data?.userTimezone ?? prev.userTimezone ?? null,
    pdfs: data?.pdfs ?? prev.pdfs ?? [],
    pdfAttachments: data?.pdfAttachments ?? prev.pdfAttachments ?? [],
  };

  await chrome.storage.local.set({ [storageKey]: next });

  log.info(
    `Assignment data merged:`,
    `course=${courseId} assignment=${assignmentId}`,
    `| title="${next.title}" | points=${next.pointsPossible}`,
    `| rubric=${next.rubric ? next.rubric.criteria?.length + " criteria" : "none"}`,
    `| descLen=${next.descriptionText?.length ?? 0}`,
  );

  log.debug("Merged record:", next);

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
    log.warn("START_HEADSTART_RUN: not on a Canvas assignment URL:", tab?.url);
    chrome.tabs.sendMessage(tab.id, {
      type: "HEADSTART_ERROR",
      error: "Not on a Canvas assignment page.",
    });
    return;
  }

  // NEW: Load the stored assignment record from chrome.storage.local
  const storageKey = `assignment::${ids.courseId}::${ids.assignmentId}`;
  log.info("Loading stored assignment:", storageKey);

  const obj = await chrome.storage.local.get(storageKey);
  const stored = obj?.[storageKey];

  if (!stored) {
    log.warn("No stored record for:", storageKey);
    chrome.tabs.sendMessage(tab.id, {
      type: "HEADSTART_ERROR",
      error: `No stored assignment found for key ${storageKey}`,
    });
    return;
  }

  // NEW: Normalize and compute due-date flags
  const payload = buildHeadstartPayload(stored);

  log.info(
    "Built payload:",
    `title="${payload.title}"`,
    `dueAtISO=${payload.dueAtISO}`,
    `daysToDue=${payload.flags.daysToDue}`,
  );
  log.debug("Full payload:", payload);

  // NEW: fallback title from content script if storage/extractor didn't have it
  if ((!payload.title || payload.title.trim() === "") && pageTitle) {
    payload.title = pageTitle.replace(" - Assignments", "").trim();
    log.debug("Applied pageTitle fallback:", payload.title);
  }

  // NEW: Send payload to webapp backend (local dev)
  const BACKEND = "http://localhost:3000";

  try {
    // 1) Ingest
    log.info(`POST ${BACKEND}/api/ingest-assignment`);
    const ingestStart = Date.now();

    const res = await fetch(`${BACKEND}/api/ingest-assignment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    log.info(
      `/api/ingest-assignment → ${res.status} (${Date.now() - ingestStart}ms)`,
    );

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Ingest failed (${res.status}): ${errText}`);
    }

    const json = await res.json();
    log.debug("/api/ingest-assignment response:", json);

    // 2) Run agent (proxy endpoint on webapp)
    log.info(
      `POST ${BACKEND}/api/run-agent | assignment_uuid=${json.assignment_uuid}`,
    );
    const runStart = Date.now();

    let runResp;
    try {
      // Extract PDF attachments from the payload to send separately
      const pdfFiles = (payload.pdfAttachments || []).map((a) => ({
        filename: a.filename,
        base64_data: a.base64Data,
      }));

      // Remove bulky base64 data from the payload sent as context
      const { pdfAttachments: _discarded, ...payloadWithoutPdfs } = payload;

      log.info(`Sending ${pdfFiles.length} PDF file(s) to agent service`);

      runResp = await fetch(`${BACKEND}/api/run-agent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assignment_uuid: json.assignment_uuid,
          payload: {
            ...payloadWithoutPdfs,
            assignment_uuid: json.assignment_uuid,
          },
          pdf_text: "",
          pdf_files: pdfFiles,
        }),
      });
    } catch (e) {
      throw new Error(
        `Fetch to /api/run-agent failed: ${String(e?.message || e)}`,
      );
    }

    // IMPORTANT: clone() lets us read the body even if something else tries to read it
    let raw = "";
    try {
      raw = await runResp.clone().text();
    } catch (e) {
      throw new Error(
        `Could not read /api/run-agent response body (status ${runResp?.status}): ${String(
          e?.message || e,
        )}`,
      );
    }

    log.info(
      `/api/run-agent → ${runResp.status} (${Date.now() - runStart}ms) | bodyLen=${raw.length}`,
    );
    log.debug("/api/run-agent raw (first 500):", raw.slice(0, 500));

    if (!runResp.ok) {
      throw new Error(
        `run-agent failed (${runResp.status}): ${raw.slice(0, 300)}`,
      );
    }

    let ai;
    try {
      ai = JSON.parse(raw);
    } catch {
      throw new Error(`run-agent returned non-JSON: ${raw.slice(0, 300)}`);
    }

    log.info("Sending HEADSTART_RESULT to tab:", tab.id);
    chrome.tabs.sendMessage(tab.id, {
      type: "HEADSTART_RESULT",
      result: ai,
    });
  } catch (e) {
    log.error("handleStartHeadstartRun failed:", e?.message || e);
    chrome.tabs.sendMessage(tab.id, {
      type: "HEADSTART_ERROR",
      error: String(e?.message || e),
    });
  }
}

// ──────────────────────────────────────────────
// Extension Install / Update
// ──────────────────────────────────────────────

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    log.info("Extension installed.");
  } else if (details.reason === "update") {
    log.info(`Extension updated to v${chrome.runtime.getManifest().version}`);
  }
});
