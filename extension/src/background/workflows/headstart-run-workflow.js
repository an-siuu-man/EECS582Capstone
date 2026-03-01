/**
 * Workflow for START_HEADSTART_RUN message: build payload, call backend, return result.
 */

import { ingestAssignment, runAgent } from "../../clients/webapp-client.js";
import { MESSAGE_TYPES } from "../../shared/contracts/messages.js";
import { createLogger } from "../../shared/logger.js";
import { getAssignmentRecord } from "../../storage/assignment-store.js";
import {
  buildHeadstartPayload,
  getCanvasIdsFromUrl,
} from "./headstart-payload.js";

const log = createLogger("SW.Run");

const BACKEND_BASE_URL = "http://localhost:3000";

function sendToTabWithLogging(tabId, message, logContext) {
  if (!tabId) {
    log.error(`${logContext}: missing tab id; cannot send message`);
    return;
  }

  chrome.tabs.sendMessage(tabId, message, () => {
    if (chrome.runtime.lastError) {
      log.error(`${logContext}: delivery failed:`, chrome.runtime.lastError.message);
      return;
    }
    log.info(`${logContext}: delivered to tab ${tabId}`);
  });
}

/**
 * Build and send a normalized payload for the currently-open assignment tab.
 */
export async function handleStartHeadstartRun(tab, pageTitle) {
  const ids = getCanvasIdsFromUrl(tab?.url || "");
  if (!ids) {
    log.warn("START_HEADSTART_RUN: not on a Canvas assignment URL:", tab?.url);
    sendToTabWithLogging(tab?.id, {
      type: MESSAGE_TYPES.HEADSTART_ERROR,
      error: "Not on a Canvas assignment page.",
    }, "HEADSTART_ERROR");
    return;
  }

  const { key, record: stored } = await getAssignmentRecord(
    ids.courseId,
    ids.assignmentId,
  );

  log.info("Loading stored assignment:", key);

  if (!stored) {
    log.warn("No stored record for:", key);
    sendToTabWithLogging(tab?.id, {
      type: MESSAGE_TYPES.HEADSTART_ERROR,
      error: `No stored assignment found for key ${key}`,
    }, "HEADSTART_ERROR");
    return;
  }

  const payload = buildHeadstartPayload(stored);

  log.info(
    "Built payload:",
    `title="${payload.title}"`,
    `dueAtISO=${payload.dueAtISO}`,
    `daysToDue=${payload.flags.daysToDue}`,
  );
  log.debug("Full payload:", payload);

  if ((!payload.title || payload.title.trim() === "") && pageTitle) {
    payload.title = pageTitle.replace(" - Assignments", "").trim();
    log.debug("Applied pageTitle fallback:", payload.title);
  }

  try {
    log.info(`POST ${BACKEND_BASE_URL}/api/ingest-assignment`);
    const ingestStart = Date.now();
    const ingestResponse = await ingestAssignment(payload, BACKEND_BASE_URL);
    log.info(
      `/api/ingest-assignment → 200 (${Date.now() - ingestStart}ms)`,
    );
    log.debug("/api/ingest-assignment response:", ingestResponse);

    const pdfFiles = (payload.pdfAttachments || []).map((a) => ({
      filename: a.filename,
      base64_data: a.base64Data,
    }));

    const { pdfAttachments: _discarded, ...payloadWithoutPdfs } = payload;
    log.info(`Sending ${pdfFiles.length} PDF file(s) to agent service`);
    log.info(
      `POST ${BACKEND_BASE_URL}/api/run-agent | assignment_uuid=${ingestResponse.assignment_uuid}`,
    );

    const runStart = Date.now();
    const ai = await runAgent(
      {
        assignmentUuid: ingestResponse.assignment_uuid,
        payload: payloadWithoutPdfs,
        pdfFiles,
      },
      BACKEND_BASE_URL,
    );

    log.info(`/api/run-agent → 200 (${Date.now() - runStart}ms)`);
    log.info("Sending HEADSTART_RESULT to tab:", tab?.id);

    sendToTabWithLogging(tab?.id, {
      type: MESSAGE_TYPES.HEADSTART_RESULT,
      result: ai,
    }, "HEADSTART_RESULT");
  } catch (e) {
    log.error("handleStartHeadstartRun failed:", e?.message || e);
    sendToTabWithLogging(tab?.id, {
      type: MESSAGE_TYPES.HEADSTART_ERROR,
      error: String(e?.message || e),
    }, "HEADSTART_ERROR");
  }
}
