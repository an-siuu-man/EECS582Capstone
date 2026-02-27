import { createLogger } from "../../shared/logger.js";
import { scrapeAssignmentList } from "../extractors/assignment-list-extractor.js";
import { injectWidget } from "../injectors/widget-injector.js";
import { waitForSelector } from "../utils/wait-for-selector.js";

const log = createLogger("ListFlow");

/**
 * End-to-end assignment list page flow.
 */
export async function runAssignmentListFlow(courseId, courseName) {
  const settled = await waitForSelector(
    ".assignment, .ig-row, #assignment_group",
    5000,
  );
  if (!settled) {
    log.warn("waitForSelector (list page) timed out – scraping anyway");
  }

  const assignments = scrapeAssignmentList(courseId, courseName);

  log.info(`Assignment list scrape complete: ${assignments.length} assignments found`);

  if (assignments.length > 0) {
    injectWidget({
      title: "Course Overview",
      courseName,
      meta: { courseId },
      listAssignments: assignments,
    });
  }
}
