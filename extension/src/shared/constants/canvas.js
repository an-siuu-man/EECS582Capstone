/**
 * Canvas URL patterns and DOM selectors used by detectors/extractors.
 */
export const CANVAS_URL_PATTERNS = {
  SINGLE_ASSIGNMENT: /\/courses\/(\d+)\/assignments\/(\d+)/,
  ASSIGNMENT_LIST: /\/courses\/(\d+)\/assignments\/?$/,
};

export const CANVAS_SELECTORS = {
  ASSIGNMENT_TITLE:
    "#assignment_show h1.title, h1.assignment-title, .assignment-title",
  ASSIGNMENT_DESCRIPTION:
    "#assignment_show .description, .assignment-description .user_content",
  DUE_DATE:
    ".assignment_dates .date_text, .assignment-date-available .date-text, .date-due",
  POINTS_POSSIBLE: ".points_possible, .assignment_value",
  SUBMISSION_TYPE: ".submission_types, #submit_assignment .submission-type",

  COURSE_NAME:
    "#breadcrumbs li:nth-of-type(2) .ellipsible, #breadcrumbs li:nth-of-type(2) a, .ic-app-header__menu-list-link .ic-avatar__label",

  LIST_ASSIGNMENT_ROW: ".assignment, .ig-row, .item-group-condensed .ig-row",
  LIST_ASSIGNMENT_TITLE: ".ig-title, .item-group-condensed .ig-title, a.title",
  LIST_ASSIGNMENT_DUE_DATE:
    ".assignment-date-due, .due_date_display, .ig-details .due_at",

  RUBRIC_CONTAINER:
    "#rubrics .rubric_container, .rubric_summary, #rubric_summary_holder",
  RUBRIC_TITLE: ".rubric_title, .rubric-title",
  RUBRIC_CRITERION: ".rubric-criterion, .criterion",
  RUBRIC_CRITERION_DESCRIPTION:
    ".criterion_description .description_title, .description",
  RUBRIC_CRITERION_LONG_DESCRIPTION: ".criterion_description .long_description",
  RUBRIC_RATING: ".rating-description, .rating .description",
  RUBRIC_POINTS: ".criterion_points, .points",

  WIDGET_INJECTION_POINT:
    "#right-side, .course-content aside, #sidebar_content",
};
