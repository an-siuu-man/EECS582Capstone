/**
 * Shared constants used across the extension (service worker, content scripts, popup).
 */

/** Message types for chrome.runtime messaging */
export const MESSAGE_TYPES = {
  /** Content script detected a Canvas assignment page */
  ASSIGNMENT_DETECTED: "ASSIGNMENT_DETECTED",
  /** Content script extracted full assignment data */
  ASSIGNMENT_DATA: "ASSIGNMENT_DATA",
  /** Request content script to re-extract data */
  REQUEST_EXTRACTION: "REQUEST_EXTRACTION",
};

/**
 * URL patterns used for Canvas page detection.
 * These regexes are designed for *.instructure.com hosted Canvas instances.
 */
export const CANVAS_URL_PATTERNS = {
  /** Matches a single assignment page: /courses/:courseId/assignments/:assignmentId */
  SINGLE_ASSIGNMENT: /\/courses\/(\d+)\/assignments\/(\d+)/,
  /** Matches the assignments list page: /courses/:courseId/assignments */
  ASSIGNMENT_LIST: /\/courses\/(\d+)\/assignments\/?$/,
};

/**
 * CSS selectors for Canvas DOM elements.
 * Canvas uses a fairly stable DOM structure – these may need updating
 * when Instructure ships UI changes.
 */
export const CANVAS_SELECTORS = {
  // Assignment detail page
  ASSIGNMENT_TITLE:
    "#assignment_show h1.title, h1.assignment-title, .assignment-title",
  ASSIGNMENT_DESCRIPTION:
    "#assignment_show .description, .assignment-description .user_content",
  DUE_DATE:
    ".assignment_dates .date_text, .assignment-date-available .date-text, .date-due",
  POINTS_POSSIBLE: ".points_possible, .assignment_value",
  SUBMISSION_TYPE: ".submission_types, #submit_assignment .submission-type",

  // Course Info
  COURSE_NAME:
    "#breadcrumbs li:nth-of-type(2) .ellipsible, #breadcrumbs li:nth-of-type(2) a, .ic-app-header__menu-list-link .ic-avatar__label",

  // List Page
  LIST_ASSIGNMENT_ROW: ".assignment, .ig-row, .item-group-condensed .ig-row",
  LIST_ASSIGNMENT_TITLE: ".ig-title, .item-group-condensed .ig-title, a.title",
  LIST_ASSIGNMENT_DUE_DATE: ".assignment-date-due, .due_date_display, .ig-details .due_at",

  // Rubric
  RUBRIC_CONTAINER:
    "#rubrics .rubric_container, .rubric_summary, #rubric_summary_holder",
  RUBRIC_TITLE: ".rubric_title, .rubric-title",
  RUBRIC_CRITERION: ".rubric-criterion, .criterion",
  RUBRIC_CRITERION_DESCRIPTION:
    ".criterion_description .description_title, .description",
  RUBRIC_CRITERION_LONG_DESCRIPTION: ".criterion_description .long_description",
  RUBRIC_RATING: ".rating-description, .rating .description",
  RUBRIC_POINTS: ".criterion_points, .points",

  // Headstart widget injection target
  WIDGET_INJECTION_POINT:
    "#right-side, .course-content aside, #sidebar_content",
};

/** Widget element IDs */
export const WIDGET = {
  CONTAINER_ID: "headstart-ai-widget",
  MODAL_ID: "headstart-ai-modal",
  OVERLAY_ID: "headstart-ai-overlay",
};
