import { MESSAGE_TYPES } from "../../shared/contracts/messages.js";
import { createLogger } from "../../shared/logger.js";
import { extractAssignmentData } from "../extractors/assignment-extractor.js";
import { injectWidget } from "../injectors/widget-injector.js";

const log = createLogger("SingleFlow");

/**
 * End-to-end single assignment page flow.
 */
export async function runSingleAssignmentFlow(pageInfo, courseName) {
  chrome.runtime.sendMessage({
    type: MESSAGE_TYPES.ASSIGNMENT_DETECTED,
    payload: {
      courseId: pageInfo.courseId,
      assignmentId: pageInfo.assignmentId,
      courseName,
      url: window.location.href,
    },
  });

  const assignmentData = await extractAssignmentData(document, pageInfo);

  log.info(
    "Extracted assignment data:",
    `title=\"${assignmentData.title}\"`,
    `| dueDate=${assignmentData.dueDate ?? "none"}`,
    `| points=${assignmentData.pointsPossible ?? "none"}`,
    `| rubric=${assignmentData.rubric ? assignmentData.rubric.criteria?.length + " criteria" : "none"}`,
    `| descLen=${assignmentData.descriptionText?.length ?? 0}`,
    `| pdfs=${assignmentData.pdfAttachments?.length ?? 0}`,
  );
  log.debug("Full extracted data:", assignmentData);

  chrome.runtime.sendMessage({
    type: MESSAGE_TYPES.ASSIGNMENT_DATA,
    payload: {
      courseId: pageInfo.courseId,
      assignmentId: pageInfo.assignmentId,
      data: assignmentData,
    },
  });

  log.debug("Injecting widget…");
  injectWidget(assignmentData);
}
