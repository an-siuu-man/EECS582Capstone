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
const OUTPUT_ID = "headstart-output";

// If the backend never responds, stop the loader and show a message.
const GUIDE_TIMEOUT_MS = 30000;

export function injectWidget(assignmentData) {
  if (document.getElementById(SIDEBAR_ID)) return;

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
    const sidebar = document.getElementById(SIDEBAR_ID);
    const isOpen = sidebar.classList.contains("open");
    toggleSidebar(!isOpen);
  };

  document.body.appendChild(btn);
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

  // Timeout handle for the current run (prevents infinite loader)
  let guideTimeout = null;

  let contentHtml = "";
  if (isList) {
    contentHtml = `
      <div class="headstart-sidebar__course-label">${escapeHtml(
        data.courseName || "Course Overview"
      )}</div>
      <ul class="headstart-sidebar__list">
        ${data.listAssignments
          .map(
            (a) => `
          <li class="headstart-sidebar__item">
            <div class="headstart-sidebar__item-title">${escapeHtml(a.title)}</div>
            <div class="headstart-sidebar__item-meta">
              ${a.dueDate ? `Due: ${escapeHtml(a.dueDate)}` : "No due date"}
            </div>
          </li>
        `
          )
          .join("")}
      </ul>
    `;
  } else {
    contentHtml = `
      <div class="headstart-sidebar__course-label">${escapeHtml(
        data.courseName || "Current Course"
      )}</div>
      <div class="headstart-sidebar__item">
        <div class="headstart-sidebar__item-title">${escapeHtml(data.title)}</div>
        <div class="headstart-sidebar__item-meta">
          ${data.dueDate ? `Due: ${escapeHtml(data.dueDate)}` : ""}
          <br>
          ${data.pointsPossible ? `${escapeHtml(data.pointsPossible)} Points` : ""}
        </div>
      </div>
      ${
        data.rubric
          ? `<p style="margin-top:12px; font-size:13px;">Rubric available: ${data.rubric.criteria.length} criteria</p>`
          : ""
      }
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
  sidebar.querySelector(".headstart-sidebar__btn").onclick = () => {
    if (isList) return;

    if (!chatEnabled) {
      enableSimpleChatUI(sidebar);
      chatEnabled = true;
    }

    // Clear any prior timeout for previous runs
    if (guideTimeout) {
      clearTimeout(guideTimeout);
      guideTimeout = null;
    }

    // Show loading while generation runs
    showLoadingBubble(sidebar, "guide-loading");

    // Timeout fallback (prevents infinite loading if response never arrives)
    guideTimeout = setTimeout(() => {
      hideLoadingBubble(sidebar, "guide-loading");
      appendChatMessage(
        sidebar,
        "assistant",
        "Timed out waiting for a response. Make sure the backend services are running, then try again."
      );
      guideTimeout = null;
    }, GUIDE_TIMEOUT_MS);

    chrome.runtime.sendMessage({ type: "START_HEADSTART_RUN" }, (resp) => {
      if (!resp?.ok) {
        if (guideTimeout) {
          clearTimeout(guideTimeout);
          guideTimeout = null;
        }
        hideLoadingBubble(sidebar, "guide-loading");
        appendChatMessage(
          sidebar,
          "assistant",
          `Error starting run: ${resp?.error || "unknown"}`
        );
      }
    });
  };

  // Message listener
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg) return;

    // Explicit handling
    if (msg.type === "HEADSTART_ERROR") {
      if (guideTimeout) {
        clearTimeout(guideTimeout);
        guideTimeout = null;
      }
      hideLoadingBubble(sidebar, "guide-loading");
      hideLoadingBubble(sidebar, "chat-loading");

      if (!chatEnabled) {
        enableSimpleChatUI(sidebar);
        chatEnabled = true;
      }

      appendChatMessage(sidebar, "assistant", `Error: ${stringifySafe(msg.error || "Unknown error")}`);
      return;
    }

    if (msg.type === "HEADSTART_RESULT") {
      if (guideTimeout) {
        clearTimeout(guideTimeout);
        guideTimeout = null;
      }
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
        appendChatMessage(
          sidebar,
          "assistant",
          `Error rendering result: ${stringifySafe(e?.message || e)}`
        );
      }

      const input = sidebar.querySelector("#headstart-chat-input");
      if (input) input.focus();
      return;
    }

    // Keep your generic handlers as fallback
    if (isErrorMessage(msg)) {
      if (guideTimeout) {
        clearTimeout(guideTimeout);
        guideTimeout = null;
      }
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

      appendChatMessage(sidebar, "assistant", `Error: ${stringifySafe(errText)}`);
      return;
    }

    if (isResultMessage(msg)) {
      if (guideTimeout) {
        clearTimeout(guideTimeout);
        guideTimeout = null;
      }
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
          "Received a completion message, but no result content was found."
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

  outputEl.style.display = "block";
  outputEl.innerHTML = `<div id="headstart-chat-messages" class="headstart-chat-messages"></div>`;

  const actionArea = sidebar.querySelector(".headstart-sidebar__action-area");
  if (!actionArea) return;

  actionArea.innerHTML = `
    <div class="headstart-chat-composer">
      <textarea
        id="headstart-chat-input"
        class="headstart-chat-input"
        rows="2"
        placeholder="Ask a question..."
      ></textarea>
      <button id="headstart-chat-send" class="headstart-chat-send">Send</button>
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

  bubble.textContent = stringifySafe(text);

  messages.appendChild(bubble);

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

  if (data?.tldr) {
    lines.push("TL;DR");
    lines.push(String(data.tldr));
    lines.push("");
  }

  if (Array.isArray(data?.keyRequirements) && data.keyRequirements.length) {
    lines.push("Key requirements");
    data.keyRequirements.forEach((x) => lines.push(`• ${x}`));
    lines.push("");
  }

  if (Array.isArray(data?.deliverables) && data.deliverables.length) {
    lines.push("Deliverables");
    data.deliverables.forEach((x) => lines.push(`• ${x}`));
    lines.push("");
  }

  if (Array.isArray(data?.milestones) && data.milestones.length) {
    lines.push("Milestones");
    data.milestones.forEach((m) => {
      const duration = m?.durationMin ? `${m.durationMin} min` : "";
      const focus = m?.focus ? String(m.focus) : "";
      const dash = duration && focus ? " — " : "";
      lines.push(`• ${duration}${dash}${focus}`.trim());
    });
    lines.push("");
  }

  if (Array.isArray(data?.risks) && data.risks.length) {
    lines.push("Risks");
    data.risks.forEach((x) => lines.push(`• ${x}`));
    lines.push("");
  }

  if (lines.length === 0) {
    return typeof result === "string" ? result : JSON.stringify(result, null, 2);
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

function toggleSidebar(open) {
  const sidebar = document.getElementById(SIDEBAR_ID);
  if (!sidebar) return;
  sidebar.classList.toggle("open", !!open);
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