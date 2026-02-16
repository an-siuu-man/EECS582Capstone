/**
 * Headstart Widget Injector
 *
 * Responsibilities:
 *  1. Inject a floating sidebar into Canvas assignment pages and assignment list pages.
 *  2. Auto-open the sidebar on load and allow toggling via a floating button.
 *  3. Display scraped assignment metadata (title, due date, points, rubric count, etc.).
 *  4. NEW: Provide a "Generate Guide" action which triggers the service worker to build
 *     a normalized Headstart payload for the currently-open assignment.
 *  5. NEW: Display the generated payload in the sidebar for debugging/validation
 *     (temporary until backend + AI generation is wired).
 */

import { CANVAS_SELECTORS, WIDGET } from "../../shared/constants.js";

const SIDEBAR_ID = "headstart-sidebar";
const TOGGLE_ID = "headstart-toggle-btn";

// NEW: Status line + debug output box IDs
const STATUS_ID = "headstart-status";
const OUTPUT_ID = "headstart-output";

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

  // Toggle sidebar open/close state
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

  // True if we are on the Canvas "Assignments list" page vs a single assignment page
  const isList = !!data.listAssignments;

  // Prepare content section HTML
  let contentHtml = "";

  if (isList) {
    // Assignments list view
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

      <!-- NEW: Simple status line to show progress/errors -->
      <div id="${STATUS_ID}" style="margin-top:12px; font-size:13px; opacity:0.85;">
        Status: Ready
      </div>

      <!-- NEW: Debug output area (hidden by default) -->
      <pre id="${OUTPUT_ID}" style="margin-top:10px; font-size:12px; max-height:220px; overflow:auto; background:rgba(0,0,0,0.05); padding:10px; border-radius:8px; display:none;"></pre>

    </div>

    <div class="headstart-sidebar__action-area">
      <button class="headstart-sidebar__btn">
        ${isList ? "View Full Dashboard" : "Generate Guide"}
      </button>
    </div>
  `;

  // Close button handler
  sidebar.querySelector(".headstart-sidebar__close").onclick = () =>
    toggleSidebar(false);

  /**
   * NEW: Action button behavior
   * - List page: placeholder (dashboard not wired yet)
   * - Assignment page: triggers service worker to build a normalized payload
   */
  sidebar.querySelector(".headstart-sidebar__btn").onclick = () => {
    const statusEl = sidebar.querySelector(`#${STATUS_ID}`);
    const outputEl = sidebar.querySelector(`#${OUTPUT_ID}`);

    if (isList) {
      // For list view, keep behavior simple for now
      statusEl.textContent = "Status: Open dashboard (not wired yet)";
      return;
    }

    // Update UI to show we’re doing something
    statusEl.textContent = "Status: Building payload…";
    if (outputEl) outputEl.style.display = "none";

    // NEW: Request the background service worker to build the payload
    const pageTitle = data?.title || document.title || "";

    chrome.runtime.sendMessage(
      { type: "START_HEADSTART_RUN", pageTitle },
      (resp) => {
      if (!resp?.ok) {
        statusEl.textContent = `Status: Error — ${resp?.error || "unknown"}`;
      } else {
        statusEl.textContent = "Status: Payload received (see below)";
      }
    });
  };

  /**
   * NEW: Listener for payload or error messages from the service worker.
   * We display the payload JSON for debugging until backend/AI is connected.
   */
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg) return;

    const statusEl = sidebar.querySelector(`#${STATUS_ID}`);
    const outputEl = sidebar.querySelector(`#${OUTPUT_ID}`);

    if (msg.type === "HEADSTART_PAYLOAD") {
      if (statusEl) statusEl.textContent = "Status: Payload ready ✅";
      if (outputEl) {
        outputEl.style.display = "block";
        outputEl.textContent = JSON.stringify(msg.payload, null, 2);
      }
    }

    if (msg.type === "HEADSTART_ERROR") {
      if (statusEl) statusEl.textContent = `Status: Error — ${msg.error}`;
    }
  });

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

/**
 * Escape user/content text to avoid HTML injection in the sidebar.
 */
function escapeHtml(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}