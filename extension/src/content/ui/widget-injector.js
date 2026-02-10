/**
 * Headstart Widget Injector
 *
 * Injects a floating sidebar into the Canvas assignment page.
 * The sidebar slides in automatically and can be toggled via a button.
 */

import { CANVAS_SELECTORS, WIDGET } from "../../shared/constants.js";

const SIDEBAR_ID = "headstart-sidebar";
const TOGGLE_ID = "headstart-toggle-btn";

/**
 * Inject the Headstart sidebar and toggle button.
 *
 * @param {import('../extractors/assignment-extractor.js').AssignmentData} assignmentData
 */
export function injectWidget(assignmentData) {
  // Prevent duplicate injection
  if (document.getElementById(SIDEBAR_ID)) return;

  injectToggle();
  injectSidebar(assignmentData);

  // Auto-open sidebar on load
  setTimeout(() => {
    toggleSidebar(true);
  }, 500);
}

// ──────────────────────────────────────────────
// Toggle Button
// ──────────────────────────────────────────────

function injectToggle() {
  const btn = document.createElement("button");
  btn.id = TOGGLE_ID;
  btn.className = "headstart-toggle";
  btn.innerHTML = "🚀";
  btn.title = "Toggle Headstart AI";
  
  btn.onclick = () => {
    const sidebar = document.getElementById(SIDEBAR_ID);
    const isOpen = sidebar.classList.contains("open");
    toggleSidebar(!isOpen);
  };

  document.body.appendChild(btn);
}

// ──────────────────────────────────────────────
// Sidebar Injection
// ──────────────────────────────────────────────

function injectSidebar(data) {
  const sidebar = document.createElement("div");
  sidebar.id = SIDEBAR_ID;
  sidebar.className = "headstart-sidebar";

  const isList = !!data.listAssignments;
  
  // Prepare content
  let contentHtml = "";

  if (isList) {
    contentHtml = `
      <div class="headstart-sidebar__course-label">${escapeHtml(data.courseName || "Course Overview")}</div>
      <ul class="headstart-sidebar__list">
        ${data.listAssignments.map(a => `
          <li class="headstart-sidebar__item">
            <div class="headstart-sidebar__item-title">${escapeHtml(a.title)}</div>
            <div class="headstart-sidebar__item-meta">
              ${a.dueDate ? `Due: ${escapeHtml(a.dueDate)}` : "No due date"}
            </div>
          </li>
        `).join("")}
      </ul>
    `;
  } else {
    // Single Assignment View
    contentHtml = `
      <div class="headstart-sidebar__course-label">${escapeHtml(data.courseName || "Current Course")}</div>
      <div class="headstart-sidebar__item">
        <div class="headstart-sidebar__item-title">${escapeHtml(data.title)}</div>
        <div class="headstart-sidebar__item-meta">
           ${data.dueDate ? `Due: ${escapeHtml(data.dueDate)}` : ""}
           <br>
           ${data.pointsPossible ? `${escapeHtml(data.pointsPossible)} Points` : ""}
        </div>
      </div>
      ${data.rubric ? `<p style="margin-top:12px; font-size:13px;">Rubric available: ${data.rubric.criteria.length} criteria</p>` : ""}
    `;
  }

  sidebar.innerHTML = `
    <div class="headstart-sidebar__header">
      <div class="headstart-sidebar__logo-area">
        <span>🚀</span>
        <span class="headstart-sidebar__title">Headstart AI</span>
      </div>
      <button class="headstart-sidebar__close">&times;</button>
    </div>
    
    <div class="headstart-sidebar__body">
      ${contentHtml}
    </div>

    <div class="headstart-sidebar__action-area">
      <button class="headstart-sidebar__btn">
        ${isList ? "View Full Dashboard" : "Generate Guide"}
      </button>
    </div>
  `;

  // Close button handler
  sidebar.querySelector(".headstart-sidebar__close").onclick = () => toggleSidebar(false);

  // Action button stub
  sidebar.querySelector(".headstart-sidebar__btn").onclick = () => {
    alert("Headstart AI Guide Generation coming soon!");
  };

  document.body.appendChild(sidebar);
}

function toggleSidebar(open) {
  const sidebar = document.getElementById(SIDEBAR_ID);
  if (!sidebar) return;

  if (open) {
    sidebar.classList.add("open");
  } else {
    sidebar.classList.remove("open");
  }
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function escapeHtml(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
