/**
 * Headstart AI – Popup Script
 *
 * Displays recently detected assignments from chrome.storage.local.
 */

(async function () {
  const listEl = document.getElementById("assignment-list");

  // Fetch all stored items
  const allData = await chrome.storage.local.get(null);

  const assignments = Object.entries(allData)
    .filter(([key]) => key.startsWith("assignment::"))
    .map(([, value]) => value)
    .sort((a, b) => new Date(b.detectedAt) - new Date(a.detectedAt));

  if (assignments.length === 0) {
    listEl.innerHTML =
      '<li class="empty-state">No assignments detected yet.</li>';
    return;
  }

  assignments.forEach((assignment) => {
    const li = document.createElement("li");
    
    // Prefer extracted data, fall back to detection data (top-level)
    const title = assignment.data?.title || assignment.title || `Assignment ${assignment.assignmentId}`;
    const course = assignment.data?.courseName || assignment.courseName || `Course ${assignment.courseId}`;
    const statusClass = assignment.status === "extracted" ? "extracted" : "pending";
    
    const rawDate = assignment.data?.dueDate || assignment.dueDate;
    const dateStr = rawDate ? new Date(rawDate).toLocaleDateString() : "";

    li.innerHTML = `
      <div class="item-course">${escapeHtml(course)}</div>
      <div class="item-title">${escapeHtml(title)}</div>
      <div class="item-meta">
        <span class="status-badge ${statusClass}" title="${assignment.status}"></span>
        ${dateStr ? `<span>Due: ${escapeHtml(dateStr)}</span>` : "<span>No due date detected</span>"}
      </div>
    `;
    
    listEl.appendChild(li);
  });
})();

function escapeHtml(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}