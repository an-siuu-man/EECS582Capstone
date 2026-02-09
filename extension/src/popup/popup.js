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
    const title =
      assignment.data?.title ||
      assignment.title ||
      `Assignment ${assignment.assignmentId}`;
    const status = assignment.status === "extracted" ? "✅" : "⏳";

    li.textContent = `${status} ${title}`;
    li.title = `Course ${assignment.courseId} · Assignment ${assignment.assignmentId}`;
    listEl.appendChild(li);
  });
})();
