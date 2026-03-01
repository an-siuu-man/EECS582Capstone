/**
 * Artifact: extension/src/content/injectors/widget-injector.js
 * Purpose: Injects and manages the Headstart sidebar UI and webapp handoff actions inside Canvas pages.
 * Author: Ansuman Sharma
 * Created: 2026-02-27
 * Revised:
 * - 2026-03-01: Replaced in-extension chat flow with webapp chat handoff and status messaging. (Codex)
 * Preconditions:
 * - Executed on Canvas pages with DOM access and content-script runtime messaging available.
 * Inputs:
 * - Acceptable: Assignment payload objects for single-assignment or assignment-list rendering.
 * - Unacceptable: Null/undefined payloads or payloads missing required view fields (title/course/list data).
 * Postconditions:
 * - Sidebar/toggle UI is mounted once, user actions are wired, and status/error updates are shown.
 * Returns:
 * - `injectWidget` returns void after DOM and listener side effects are applied.
 * Errors/Exceptions:
 * - UI/rendering and animation errors are caught and logged; runtime errors are surfaced as status text.
 */

import { MESSAGE_TYPES } from "../../shared/contracts/messages.js";
import { createLogger } from "../../shared/logger.js";
import { animate, spring } from "motion";

const log = createLogger("Widget");

const SIDEBAR_ID = "headstart-sidebar";
const TOGGLE_ID = "headstart-toggle-btn";
const OUTPUT_ID = "headstart-output";
const WEBAPP_BASE_URL = "http://localhost:3000";

export function injectWidget(assignmentData) {
  if (document.getElementById(SIDEBAR_ID)) {
    log.debug("Widget already injected - skipping.");
    return;
  }

  log.info(
    "Injecting widget | isList:",
    !!assignmentData.listAssignments,
    "| title:",
    assignmentData.title ?? "(list)",
  );
  injectToggle();
  injectSidebar(assignmentData);

  setTimeout(() => toggleSidebar(true), 500);
}

// ------------------------------------------------------------
// Toggle button
// ------------------------------------------------------------

function injectToggle() {
  const btn = document.createElement("button");
  btn.id = TOGGLE_ID;
  btn.className = "headstart-toggle";
  btn.innerHTML = "🚀";
  btn.title = "Toggle Headstart AI";

  btn.onclick = () => {
    toggleSidebar(!sidebarOpen);
  };

  document.body.appendChild(btn);

  try {
    animate(
      btn,
      { opacity: [0, 1], transform: ["translateX(60px)", "translateX(0)"] },
      { easing: spring(0.3, 0.3) },
    );
  } catch (e) {
    log.warn("Toggle animate error:", e?.message || e);
  }
}

// ------------------------------------------------------------
// Sidebar
// ------------------------------------------------------------

function injectSidebar(data) {
  const sidebar = document.createElement("div");
  sidebar.id = SIDEBAR_ID;
  sidebar.className = "headstart-sidebar";

  const isList = !!data.listAssignments;
  const userTimezone = data.userTimezone || null;

  let contentHtml = "";
  if (isList) {
    contentHtml = `
      <div class="headstart-sidebar__course-label">${escapeHtml(
        data.courseName || "Course Overview",
      )}</div>
      <ul class="headstart-sidebar__list">
        ${data.listAssignments
          .map(
            (a) => `
          <li class="headstart-sidebar__item">
            <div class="headstart-sidebar__item-title">${escapeHtml(a.title)}</div>
            <div class="headstart-sidebar__item-meta">
              ${a.dueDate ? `Due: ${escapeHtml(formatDateInTimezone(a.dueDate, userTimezone) || a.dueDate)}` : "No due date"}
            </div>
          </li>
        `,
          )
          .join("")}
      </ul>
    `;
  } else {
    const formattedDueDate = data.dueDate
      ? formatDateInTimezone(data.dueDate, userTimezone) || data.dueDate
      : null;
    contentHtml = `
      <div class="headstart-sidebar__course-label">${escapeHtml(
        data.courseName || "Current Course",
      )}</div>
      <div class="headstart-sidebar__item">
        <div class="headstart-sidebar__item-title">${escapeHtml(data.title)}</div>
        <div class="headstart-sidebar__item-meta">
          ${formattedDueDate ? `Due: ${escapeHtml(formattedDueDate)}` : ""}
          <br>
          ${data.pointsPossible ? `${escapeHtml(data.pointsPossible)} Points` : ""}
        </div>
      </div>
      ${
        data.rubric
          ? `<div class="headstart-sidebar__item-meta" style="margin-top:6px;">Rubric: ${data.rubric.criteria.length} criteria</div>`
          : ""
      }
    `;
  }

  sidebar.innerHTML = `
    <div class="headstart-sidebar__header">
      <div class="headstart-sidebar__logo-area">
        <span style="font-size:18px;">🚀</span>
        <span class="headstart-sidebar__title">Headstart AI</span>
      </div>
      <button class="headstart-sidebar__close">&times;</button>
    </div>

    <div class="headstart-sidebar__body">
      <div class="headstart-sidebar__body-content">
        ${contentHtml}
      </div>
      <div id="${OUTPUT_ID}" class="headstart-sidebar__output" style="display:none;"></div>
    </div>

    <div class="headstart-sidebar__action-area">
      <button class="headstart-sidebar__btn">
        ${isList ? "Open Dashboard" : "Generate Guide"}
      </button>
    </div>
  `;

  sidebar.querySelector(".headstart-sidebar__close").onclick = () =>
    toggleSidebar(false);

  const outputEl = sidebar.querySelector(`#${OUTPUT_ID}`);
  const setStatus = (text, tone = "info") => {
    if (!outputEl) return;
    outputEl.style.display = "block";
    outputEl.style.whiteSpace = "pre-wrap";
    outputEl.style.fontSize = "14px";
    outputEl.style.lineHeight = "1.45";
    outputEl.style.padding = "12px";
    outputEl.style.borderRadius = "12px";

    if (tone === "error") {
      outputEl.style.background = "#fef2f2";
      outputEl.style.color = "#991b1b";
      outputEl.style.border = "1px solid #fecaca";
    } else if (tone === "success") {
      outputEl.style.background = "#f0fdf4";
      outputEl.style.color = "#166534";
      outputEl.style.border = "1px solid #bbf7d0";
    } else {
      outputEl.style.background = "#eff6ff";
      outputEl.style.color = "#1e3a8a";
      outputEl.style.border = "1px solid #bfdbfe";
    }

    outputEl.textContent = stringifySafe(text);
  };

  const actionBtn = sidebar.querySelector(".headstart-sidebar__btn");
  let dashboardUrl = null;
  actionBtn.onclick = () => {
    try {
      animate(
        actionBtn,
        { transform: ["scale(1)", "scale(0.95)", "scale(1)"] },
        { duration: 0.2 },
      );
    } catch (e) {
      log.warn("Button animate error:", e?.message || e);
    }

    if (isList) {
      window.open(`${WEBAPP_BASE_URL}/dashboard`, "_blank", "noopener,noreferrer");
      setStatus("Opened dashboard in a new tab.", "success");
      return;
    }

    if (dashboardUrl) {
      window.open(dashboardUrl, "_blank", "noopener,noreferrer");
      setStatus("Opened dashboard guide view in a new tab.", "success");
      return;
    }

    actionBtn.disabled = true;
    actionBtn.textContent = "Generating...";
    setStatus("Guide generation started. This can take up to a minute.", "info");

    chrome.runtime.sendMessage({ type: MESSAGE_TYPES.START_HEADSTART_RUN }, (resp) => {
      log.debug("START_HEADSTART_RUN ack:", resp);
      if (!resp?.ok) {
        actionBtn.disabled = false;
        actionBtn.textContent = "Generate Guide";
        setStatus(
          `Unable to start guide generation: ${resp?.error || "unknown error"}`,
          "error",
        );
      }
    });
  };

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg) return;

    if (msg.type === MESSAGE_TYPES.HEADSTART_ERROR) {
      log.error("HEADSTART_ERROR received:", msg.error);
      actionBtn.disabled = false;
      actionBtn.textContent = "Generate Guide";
      setStatus(
        `Unable to start guide generation: ${stringifySafe(msg.error || "Unknown error")}`,
        "error",
      );
      return;
    }

    if (msg.type === MESSAGE_TYPES.HEADSTART_RESULT) {
      log.info("HEADSTART_RESULT received");
      log.debug("Result payload:", msg.result);
      actionBtn.disabled = false;

      const redirectUrl = msg.result?.redirectUrl || msg.redirectUrl;
      if (redirectUrl) {
        dashboardUrl = redirectUrl;
        actionBtn.textContent = "View Guide in Dashboard";
        setStatus(
          "Guide generation is running in the background. Click \"View Guide in Dashboard\" to follow progress.",
          "success",
        );
      } else {
        actionBtn.textContent = "Generate Guide";
        setStatus("Guide request started, but dashboard link was missing.", "error");
      }
    }
  });

  document.body.appendChild(sidebar);
}

// ------------------------------------------------------------
// Sidebar open/close
// ------------------------------------------------------------

let sidebarOpen = false;

function toggleSidebar(open) {
  const sidebar = document.getElementById(SIDEBAR_ID);
  if (!sidebar) return;

  const shouldOpen = !!open;
  if (shouldOpen === sidebarOpen) return;
  sidebarOpen = shouldOpen;

  try {
    if (shouldOpen) {
      animate(
        sidebar,
        { transform: ["translateX(100%)", "translateX(0)"] },
        { easing: spring(0.35, 0.15) },
      );
    } else {
      animate(
        sidebar,
        { transform: ["translateX(0)", "translateX(100%)"] },
        { duration: 0.25, easing: "ease-in" },
      );
    }
  } catch (e) {
    log.warn("Sidebar animate error:", e?.message || e);
    sidebar.style.transform = shouldOpen ? "translateX(0)" : "translateX(100%)";
  }
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

function escapeHtml(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function stringifySafe(v) {
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function formatDateInTimezone(dateStr, timezone) {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
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
    return dateStr;
  }
}
