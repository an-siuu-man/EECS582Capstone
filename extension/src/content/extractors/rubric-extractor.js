/**
 * Canvas Rubric Extractor
 *
 * Extracts rubric data from a Canvas assignment page when available.
 * Canvas rubrics have a fairly consistent DOM structure:
 *
 *   .rubric_container
 *     .rubric_title
 *     .criterion  (repeated)
 *       .description  →  criterion description
 *       .ratings .rating-description  (repeated)
 *       .criterion_points  →  max points for criterion
 */

import { CANVAS_SELECTORS } from "../../shared/constants/canvas.js";

/**
 * @typedef {Object} RubricRating
 * @property {string} description
 * @property {string|null} points
 */

/**
 * @typedef {Object} RubricCriterion
 * @property {string} description     – short description / title
 * @property {string|null} longDescription – full explanation (optional)
 * @property {RubricRating[]} ratings
 * @property {string|null} points     – max points for this criterion
 */

/**
 * @typedef {Object} Rubric
 * @property {string} title
 * @property {RubricCriterion[]} criteria
 */

/**
 * Attempt to extract rubric data from the page.
 *
 * @param {Document} doc
 * @returns {Rubric|null}  null when no rubric is found on the page
 */
export function extractRubric(doc) {
  const container = doc.querySelector(CANVAS_SELECTORS.RUBRIC_CONTAINER);
  if (!container) {
    return null;
  }

  const title = extractRubricTitle(container);
  const criteria = extractCriteria(container);

  if (criteria.length === 0) {
    return null;
  }

  return { title, criteria };
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function extractRubricTitle(container) {
  const el = container.querySelector(CANVAS_SELECTORS.RUBRIC_TITLE);
  return el ? el.textContent.trim() : "Rubric";
}

function extractCriteria(container) {
  const criterionEls = container.querySelectorAll(
    CANVAS_SELECTORS.RUBRIC_CRITERION,
  );
  const criteria = [];

  criterionEls.forEach((criterionEl) => {
    const description = extractCriterionDescription(criterionEl);
    const longDescription = extractCriterionLongDescription(criterionEl);
    const ratings = extractRatings(criterionEl);
    const points = extractCriterionPoints(criterionEl);

    criteria.push({
      description,
      longDescription,
      ratings,
      points,
    });
  });

  return criteria;
}

function extractCriterionDescription(criterionEl) {
  const el = criterionEl.querySelector(
    CANVAS_SELECTORS.RUBRIC_CRITERION_DESCRIPTION,
  );
  return el ? el.textContent.trim() : "";
}

function extractCriterionLongDescription(criterionEl) {
  const el = criterionEl.querySelector(
    CANVAS_SELECTORS.RUBRIC_CRITERION_LONG_DESCRIPTION,
  );
  return el ? el.textContent.trim() : null;
}

function extractRatings(criterionEl) {
  const ratingEls = criterionEl.querySelectorAll(
    CANVAS_SELECTORS.RUBRIC_RATING,
  );
  const ratings = [];

  ratingEls.forEach((ratingEl) => {
    // For each rating, try to find an associated point value
    const pointsEl = ratingEl.closest(".rating")?.querySelector(".points");
    ratings.push({
      description: ratingEl.textContent.trim(),
      points: pointsEl ? pointsEl.textContent.trim() : null,
    });
  });

  return ratings;
}

function extractCriterionPoints(criterionEl) {
  const el = criterionEl.querySelector(CANVAS_SELECTORS.RUBRIC_POINTS);
  if (!el) return null;

  const match = el.textContent.match(/[\d.]+/);
  return match ? match[0] : el.textContent.trim();
}
