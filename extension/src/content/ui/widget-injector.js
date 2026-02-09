/**
 * Headstart Widget Injector
 *
 * Injects a small UI widget into the Canvas assignment page so students
 * can see at a glance that Headstart has processed the assignment and
 * can click through to the generated guide.
 *
 * The widget is intentionally minimal – a lightweight vanilla-JS component
 * injected into Canvas' right sidebar. A full React widget upgrade is
 * planned for a later sprint.
 */

import { CANVAS_SELECTORS, WIDGET } from "../../shared/constants.js";

/**
 * Inject the Headstart widget into the Canvas page.
 *
 * @param {import('../extractors/assignment-extractor.js').AssignmentData} assignmentData
 */
export function injectWidget(assignmentData) {
  // Avoid duplicate injection
  if (document.getElementById(WIDGET.CONTAINER_ID)) {
    console.log("[Headstart] Widget already injected – updating.");
    updateWidget(assignmentData);
    return;
  }

  const injectionTarget = findInjectionTarget();
  if (!injectionTarget) {
    console.warn("[Headstart] Could not find injection target in Canvas DOM.");
    return;
  }

  const widget = createWidgetElement(assignmentData);
  injectionTarget.prepend(widget);
  console.log("[Headstart] Widget injected successfully.");
}

/**
 * Update an already-injected widget with new data.
 */
function updateWidget(assignmentData) {
  const container = document.getElementById(WIDGET.CONTAINER_ID);
  if (!container) return;

  const statusEl = container.querySelector(".headstart-status");
  if (statusEl) {
    statusEl.textContent = buildStatusText(assignmentData);
  }
}

// ──────────────────────────────────────────────
// DOM Construction
// ──────────────────────────────────────────────

function findInjectionTarget() {
  // Try each candidate selector in order of preference
  const selectors = CANVAS_SELECTORS.WIDGET_INJECTION_POINT.split(",").map(
    (s) => s.trim(),
  );

  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el) return el;
  }

  return null;
}

function createWidgetElement(assignmentData) {
  const container = document.createElement("div");
  container.id = WIDGET.CONTAINER_ID;
  container.className = "headstart-widget";

  container.innerHTML = `
    <div class="headstart-widget__header">
      <span class="headstart-widget__logo">🚀</span>
      <span class="headstart-widget__title">Headstart AI</span>
    </div>
    <div class="headstart-widget__body">
      <p class="headstart-status">${buildStatusText(assignmentData)}</p>
      <div class="headstart-widget__details">
        ${assignmentData.dueDate ? `<p class="headstart-detail"><strong>Due:</strong> ${escapeHtml(assignmentData.dueDate)}</p>` : ""}
        ${assignmentData.pointsPossible ? `<p class="headstart-detail"><strong>Points:</strong> ${escapeHtml(assignmentData.pointsPossible)}</p>` : ""}
        ${assignmentData.rubric ? `<p class="headstart-detail"><strong>Rubric:</strong> ${assignmentData.rubric.criteria.length} criteria</p>` : ""}
      </div>
      <button class="headstart-widget__btn" id="headstart-generate-btn">
        View Guide
      </button>
    </div>
  `;

  // Attach event listener
  container
    .querySelector("#headstart-generate-btn")
    .addEventListener("click", () => {
      handleViewGuide(assignmentData);
    });

  return container;
}

function buildStatusText(data) {
  if (data.title) {
    return `Assignment detected: "${data.title}"`;
  }
  return "Assignment detected – extracting data…";
}

function handleViewGuide(assignmentData) {
  // TODO: Open the generated guide (web app URL or side panel)
  console.log("[Headstart] View guide requested for:", assignmentData.meta);
  alert(
    "Headstart AI guide generation coming soon!\n\n" +
      `Assignment: ${assignmentData.title}\n` +
      `Course ID: ${assignmentData.meta.courseId}`,
  );
}

// ──────────────────────────────────────────────
// Utility
// ──────────────────────────────────────────────

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
