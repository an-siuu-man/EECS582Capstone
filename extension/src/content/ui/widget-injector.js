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
import { createLogger } from "../../shared/logger.js";
import { marked } from "marked";
import { animate, spring } from "motion";

const log = createLogger("Widget");

// Configure marked for safe rendering
marked.setOptions({ breaks: true, gfm: true });

const SIDEBAR_ID = "headstart-sidebar";
const TOGGLE_ID = "headstart-toggle-btn";
const OUTPUT_ID = "headstart-output";

export function injectWidget(assignmentData) {
  if (document.getElementById(SIDEBAR_ID)) {
    log.debug("Widget already injected – skipping.");
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

// ──────────────────────────────────────────────
// Toggle button
// ──────────────────────────────────────────────

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

  // Bounce-in animation
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

// ──────────────────────────────────────────────
// Sidebar
// ──────────────────────────────────────────────

function injectSidebar(data) {
  const sidebar = document.createElement("div");
  sidebar.id = SIDEBAR_ID;
  sidebar.className = "headstart-sidebar";

  const isList = !!data.listAssignments;

  let chatEnabled = false;

  // Extract user timezone for date formatting (IANA string from Canvas profile)
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
        ${isList ? "View Full Dashboard" : "Generate Guide"}
      </button>
    </div>
  `;

  sidebar.querySelector(".headstart-sidebar__close").onclick = () =>
    toggleSidebar(false);

  // Generate Guide
  const actionBtn = sidebar.querySelector(".headstart-sidebar__btn");
  actionBtn.onclick = () => {
    if (isList) return;

    log.info("Generate Guide clicked");

    // Spring press feedback
    try {
      animate(
        actionBtn,
        { transform: ["scale(1)", "scale(0.95)", "scale(1)"] },
        { duration: 0.2 },
      );
    } catch (e) {
      log.warn("Button animate error:", e?.message || e);
    }

    if (!chatEnabled) {
      enableSimpleChatUI(sidebar);
      chatEnabled = true;
    }

    // Show loading while generation runs
    showLoadingBubble(sidebar, "guide-loading");

    chrome.runtime.sendMessage({ type: "START_HEADSTART_RUN" }, (resp) => {
      log.debug("START_HEADSTART_RUN ack:", resp);
      if (!resp?.ok) {
        hideLoadingBubble(sidebar, "guide-loading");
        appendChatMessage(
          sidebar,
          "assistant",
          `Error starting run: ${resp?.error || "unknown"}`,
        );
      }
    });
  };

  // Message listener
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg) return;

    // Explicit handling
    if (msg.type === "HEADSTART_ERROR") {
      log.error("HEADSTART_ERROR received:", msg.error);
      hideLoadingBubble(sidebar, "guide-loading");
      hideLoadingBubble(sidebar, "chat-loading");

      if (!chatEnabled) {
        enableSimpleChatUI(sidebar);
        chatEnabled = true;
      }

      appendChatMessage(
        sidebar,
        "assistant",
        `Error: ${stringifySafe(msg.error || "Unknown error")}`,
      );
      return;
    }

    if (msg.type === "HEADSTART_RESULT") {
      log.info("HEADSTART_RESULT received");
      log.debug("Result payload:", msg.result);
      hideLoadingBubble(sidebar, "guide-loading");
      hideLoadingBubble(sidebar, "chat-loading");

      if (!chatEnabled) {
        enableSimpleChatUI(sidebar);
        chatEnabled = true;
      }

      try {
        const guideText = buildGuideText(msg.result);
        appendChatMessage(sidebar, "assistant", guideText);
      } catch (e) {
        log.error("Error rendering HEADSTART_RESULT:", e?.message || e);
        appendChatMessage(
          sidebar,
          "assistant",
          `Error rendering result: ${stringifySafe(e?.message || e)}`,
        );
      }

      const input = sidebar.querySelector("#headstart-chat-input");
      if (input) input.focus();
      return;
    }

    // Keep your generic handlers as fallback
    if (isErrorMessage(msg)) {
      hideLoadingBubble(sidebar, "guide-loading");
      hideLoadingBubble(sidebar, "chat-loading");

      const errText =
        msg.error ||
        msg.message ||
        msg.detail ||
        (typeof msg === "string" ? msg : "Unknown error");

      if (!chatEnabled) {
        enableSimpleChatUI(sidebar);
        chatEnabled = true;
      }

      appendChatMessage(
        sidebar,
        "assistant",
        `Error: ${stringifySafe(errText)}`,
      );
      return;
    }

    if (isResultMessage(msg)) {
      hideLoadingBubble(sidebar, "guide-loading");
      hideLoadingBubble(sidebar, "chat-loading");

      if (!chatEnabled) {
        enableSimpleChatUI(sidebar);
        chatEnabled = true;
      }

      const rawResult = extractResult(msg);

      if (!rawResult) {
        appendChatMessage(
          sidebar,
          "assistant",
          "Received a completion message, but no result content was found.",
        );
        return;
      }

      appendChatMessage(sidebar, "assistant", buildGuideText(rawResult));

      const input = sidebar.querySelector("#headstart-chat-input");
      if (input) input.focus();
      return;
    }
  });

  document.body.appendChild(sidebar);
}

// ──────────────────────────────────────────────
// Chat UI
// ──────────────────────────────────────────────

function enableSimpleChatUI(sidebar) {
  const outputEl = sidebar.querySelector(`#${OUTPUT_ID}`);
  if (!outputEl) return;

  outputEl.style.display = "flex";
  outputEl.innerHTML = `<div id="headstart-chat-messages" class="headstart-chat-messages"></div>`;

  const actionArea = sidebar.querySelector(".headstart-sidebar__action-area");
  if (!actionArea) return;

  actionArea.innerHTML = `
    <div class="headstart-chat-composer">
      <textarea
        id="headstart-chat-input"
        class="headstart-chat-input"
        rows="1"
        placeholder="Ask a follow-up question..."
      ></textarea>
      <button id="headstart-chat-send" class="headstart-chat-send" aria-label="Send">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 2L11 13"/><path d="M22 2L15 22L11 13L2 9L22 2"/>
        </svg>
      </button>
    </div>
  `;

  const input = sidebar.querySelector("#headstart-chat-input");
  const sendBtn = sidebar.querySelector("#headstart-chat-send");

  const send = () => handleVisualSend(sidebar);
  sendBtn.addEventListener("click", send);

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
}

function handleVisualSend(sidebar) {
  const input = sidebar.querySelector("#headstart-chat-input");
  if (!input) return;

  const text = (input.value || "").trim();
  if (!text) return;

  input.value = "";
  appendChatMessage(sidebar, "user", text);

  // Visual "thinking" animation
  showLoadingBubble(sidebar, "chat-loading");

  setTimeout(() => {
    hideLoadingBubble(sidebar, "chat-loading");
    appendChatMessage(sidebar, "assistant", "Not wired yet");
  }, 350);
}

function appendChatMessage(sidebar, role, text) {
  const messages = sidebar.querySelector("#headstart-chat-messages");
  if (!messages) return;

  const bubble = document.createElement("div");
  bubble.className =
    role === "user"
      ? "headstart-chat-bubble user"
      : "headstart-chat-bubble assistant";

  if (role === "assistant") {
    bubble.innerHTML = marked.parse(stringifySafe(text));
    bubble.classList.add("headstart-markdown");
  } else {
    bubble.textContent = stringifySafe(text);
  }

  messages.appendChild(bubble);

  // Entrance animation — user slides from right, assistant from left
  try {
    const slideFrom =
      role === "user" ? "translateX(20px)" : "translateX(-20px)";
    animate(
      bubble,
      { opacity: [0, 1], transform: [slideFrom, "translateX(0)"] },
      { duration: 0.3, easing: "ease-out" },
    );
  } catch (e) {
    log.warn("Bubble animate error:", e?.message || e);
  }

  requestAnimationFrame(() => {
    messages.scrollTop = messages.scrollHeight;
  });
}

// ──────────────────────────────────────────────
// Loading
// ──────────────────────────────────────────────

function showLoadingBubble(sidebar, id = "hs-loading") {
  const messages = sidebar.querySelector("#headstart-chat-messages");
  if (!messages) return;

  if (messages.querySelector(`[data-loading="${id}"]`)) return;

  const bubble = document.createElement("div");
  bubble.className = "headstart-chat-bubble assistant headstart-loading-bubble";
  bubble.setAttribute("data-loading", id);

  // Dots
  bubble.innerHTML = `
    <span class="hs-dots" aria-label="Loading">
      <span></span><span></span><span></span>
    </span>
  `;

  messages.appendChild(bubble);

  // Fade-in + scale animation
  try {
    animate(
      bubble,
      { opacity: [0, 1], transform: ["scale(0.8)", "scale(1)"] },
      { duration: 0.2 },
    );
  } catch (e) {
    log.warn("Loading animate error:", e?.message || e);
  }

  requestAnimationFrame(() => {
    messages.scrollTop = messages.scrollHeight;
  });
}

function hideLoadingBubble(sidebar, id = "hs-loading") {
  const messages = sidebar.querySelector("#headstart-chat-messages");
  if (!messages) return;

  const el = messages.querySelector(`[data-loading="${id}"]`);
  if (el) el.remove();
}

// ──────────────────────────────────────────────
// Result detection + extraction
// ──────────────────────────────────────────────

function isResultMessage(msg) {
  const t = String(msg.type || "").toUpperCase();

  if (
    t === "HEADSTART_RESULT" ||
    t === "HEADSTART_DONE" ||
    t === "RUN_AGENT_RESULT" ||
    t === "RUN_AGENT_DONE" ||
    t === "AGENT_RESULT" ||
    t === "RESULT"
  ) {
    return true;
  }

  return (
    msg.result != null ||
    msg.data != null ||
    msg.output != null ||
    msg.response != null ||
    (msg.payload && (msg.payload.result != null || msg.payload.output != null))
  );
}

function isErrorMessage(msg) {
  const t = String(msg.type || "").toUpperCase();
  return (
    t === "HEADSTART_ERROR" ||
    t === "RUN_AGENT_ERROR" ||
    t === "AGENT_ERROR" ||
    t === "ERROR" ||
    msg.error != null
  );
}

function extractResult(msg) {
  if (msg.result != null) return msg.result;
  if (msg.data != null) return msg.data;
  if (msg.output != null) return msg.output;
  if (msg.response != null) return msg.response;

  if (msg.payload) {
    if (msg.payload.result != null) return msg.payload.result;
    if (msg.payload.output != null) return msg.payload.output;
    if (msg.payload.data != null) return msg.payload.data;
    if (msg.payload.response != null) return msg.payload.response;
  }

  return null;
}

// ──────────────────────────────────────────────
// Guide formatting
// ──────────────────────────────────────────────

function buildGuideText(result) {
  const data = normalizeJson(result);
  const lines = [];

  // Description (markdown) — new format, with backward compat for tldr
  if (data?.description) {
    lines.push(String(data.description));
    lines.push("");
  } else if (data?.tldr) {
    lines.push(String(data.tldr));
    lines.push("");
  }

  if (Array.isArray(data?.keyRequirements) && data.keyRequirements.length) {
    lines.push("### Key Requirements");
    data.keyRequirements.forEach((x) => lines.push(`- ${x}`));
    lines.push("");
  }

  if (Array.isArray(data?.deliverables) && data.deliverables.length) {
    lines.push("### Deliverables");
    data.deliverables.forEach((x) => lines.push(`- ${x}`));
    lines.push("");
  }

  if (Array.isArray(data?.milestones) && data.milestones.length) {
    lines.push("### Milestones");
    data.milestones.forEach((m) => {
      const date = m?.date ? String(m.date) : "";
      const task = m?.task ? String(m.task) : "";
      const sep = date && task ? " — " : "";
      lines.push(`- **${date}**${sep}${task}`.trim());
    });
    lines.push("");
  }

  if (Array.isArray(data?.studyPlan) && data.studyPlan.length) {
    lines.push("### Study Plan");
    data.studyPlan.forEach((s) => {
      const duration = s?.durationMin ? `${s.durationMin} min` : "";
      const focus = s?.focus ? String(s.focus) : "";
      const sep = duration && focus ? " — " : "";
      lines.push(`- **${duration}**${sep}${focus}`.trim());
    });
    lines.push("");
  }

  if (Array.isArray(data?.risks) && data.risks.length) {
    lines.push("### Risks");
    data.risks.forEach((x) => lines.push(`- ${x}`));
    lines.push("");
  }

  if (lines.length === 0) {
    return typeof result === "string"
      ? result
      : JSON.stringify(result, null, 2);
  }

  return lines.join("\n").trim();
}

function normalizeJson(result) {
  if (result == null) return result;
  if (typeof result === "object") return result;

  if (typeof result === "string") {
    try {
      return JSON.parse(result);
    } catch {
      return { tldr: result };
    }
  }

  return result;
}

// ──────────────────────────────────────────────
// Sidebar open/close
// ──────────────────────────────────────────────

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
    // Fallback: just set the transform directly
    log.warn("Sidebar animate error:", e?.message || e);
    sidebar.style.transform = shouldOpen ? "translateX(0)" : "translateX(100%)";
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

function stringifySafe(v) {
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

/**
 * Format an ISO-8601 date string into a human-readable string in the given IANA timezone.
 * Falls back to the browser's local timezone if no timezone is provided.
 *
 * @param {string|null} dateStr – ISO-8601 string or raw date text
 * @param {string|null} timezone – IANA timezone (e.g. "America/New_York")
 * @returns {string|null}
 */
function formatDateInTimezone(dateStr, timezone) {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr; // Not parseable – return raw string
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
    return dateStr; // Fallback to raw string on error
  }
}
