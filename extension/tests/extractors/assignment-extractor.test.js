/**
 * Tests for Canvas assignment data extraction.
 */

import { extractAssignmentData } from "../../src/content/extractors/assignment-extractor.js";

/**
 * Helper: build a minimal DOM representing a Canvas assignment page.
 */
function buildAssignmentDOM({
  title,
  courseName,
  description,
  dueDate,
  points,
  submissionType,
  rubric,
} = {}) {
  document.body.innerHTML = `
    <nav id="breadcrumbs">
      <ul>
        <li><a href="/">Home</a></li>
        <li><a href="/courses/101"><span class="ellipsible">${courseName || "Course 101"}</span></a></li>
        <li><span>Assignment</span></li>
      </ul>
    </nav>
    <div id="assignment_show">
      <h1 class="title">${title || ""}</h1>
      <div class="description">
        <div class="user_content">${description || ""}</div>
      </div>
    </div>
    <div class="assignment_dates">
      ${dueDate ? `<span class="date_text"><time datetime="${dueDate}">${dueDate}</time></span>` : ""}
    </div>
    ${points ? `<span class="points_possible">${points} pts</span>` : ""}
    ${submissionType ? `<span class="submission_types">${submissionType}</span>` : ""}
    ${rubric ? buildRubricHTML(rubric) : ""}
  `;
  return document;
}

function buildRubricHTML(rubric) {
  const criteriaHTML = rubric.criteria
    .map(
      (c) => `
      <div class="criterion">
        <div class="criterion_description">
          <span class="description_title">${c.description}</span>
          ${c.longDescription ? `<span class="long_description">${c.longDescription}</span>` : ""}
        </div>
        ${c.ratings
          .map(
            (r) => `
          <div class="rating">
            <span class="rating-description">${r.description}</span>
            ${r.points ? `<span class="points">${r.points}</span>` : ""}
          </div>`,
          )
          .join("")}
        ${c.points ? `<span class="criterion_points">${c.points} pts</span>` : ""}
      </div>`,
    )
    .join("");

  return `
    <div id="rubrics">
      <div class="rubric_container">
        <span class="rubric_title">${rubric.title}</span>
        ${criteriaHTML}
      </div>
    </div>
  `;
}

const pageInfo = {
  type: "single_assignment",
  courseId: "101",
  assignmentId: "202",
  url: "https://umich.instructure.com/courses/101/assignments/202",
};

describe("extractAssignmentData", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("extracts title", () => {
    const doc = buildAssignmentDOM({ title: "Essay on AI Ethics" });
    const data = extractAssignmentData(doc, pageInfo);
    expect(data.title).toBe("Essay on AI Ethics");
  });

  test("extracts course name", () => {
    const doc = buildAssignmentDOM({ courseName: "EECS 582" });
    const data = extractAssignmentData(doc, pageInfo);
    expect(data.courseName).toBe("EECS 582");
  });

  test("extracts description as HTML and text", () => {
    const doc = buildAssignmentDOM({
      title: "Test",
      description: "<p>Write a <strong>500 word</strong> essay.</p>",
    });
    const data = extractAssignmentData(doc, pageInfo);
    expect(data.descriptionHtml).toContain("<strong>500 word</strong>");
    expect(data.descriptionText).toContain("500 word");
  });

  test("extracts due date from time element", () => {
    const doc = buildAssignmentDOM({
      title: "Test",
      dueDate: "2026-03-15T23:59:00Z",
    });
    const data = extractAssignmentData(doc, pageInfo);
    expect(data.dueDate).toBe("2026-03-15T23:59:00Z");
  });

  test("extracts points possible", () => {
    const doc = buildAssignmentDOM({ title: "Test", points: "100" });
    const data = extractAssignmentData(doc, pageInfo);
    expect(data.pointsPossible).toBe("100");
  });

  test("extracts submission type", () => {
    const doc = buildAssignmentDOM({
      title: "Test",
      submissionType: "Online text entry",
    });
    const data = extractAssignmentData(doc, pageInfo);
    expect(data.submissionType).toBe("Online text entry");
  });

  test("returns null fields when data is missing", () => {
    const doc = buildAssignmentDOM({ title: "Minimal" });
    const data = extractAssignmentData(doc, pageInfo);
    expect(data.title).toBe("Minimal");
    expect(data.dueDate).toBeNull();
    expect(data.pointsPossible).toBeNull();
    expect(data.submissionType).toBeNull();
    expect(data.rubric).toBeNull();
  });

  test("includes meta information", () => {
    const doc = buildAssignmentDOM({ title: "Test" });
    const data = extractAssignmentData(doc, pageInfo);
    expect(data.meta.courseId).toBe("101");
    expect(data.meta.assignmentId).toBe("202");
    expect(data.meta.url).toBe(pageInfo.url);
    expect(data.meta.extractedAt).toBeDefined();
  });

  test("extracts rubric with criteria and ratings", () => {
    const doc = buildAssignmentDOM({
      title: "Research Paper",
      rubric: {
        title: "Paper Rubric",
        criteria: [
          {
            description: "Thesis Quality",
            longDescription: "Clear, arguable thesis statement",
            ratings: [
              { description: "Excellent", points: "5" },
              { description: "Good", points: "3" },
              { description: "Poor", points: "1" },
            ],
            points: "5",
          },
          {
            description: "Evidence",
            longDescription: null,
            ratings: [
              { description: "Strong sources", points: "5" },
              { description: "Weak sources", points: "2" },
            ],
            points: "5",
          },
        ],
      },
    });
    const data = extractAssignmentData(doc, pageInfo);

    expect(data.rubric).not.toBeNull();
    expect(data.rubric.title).toBe("Paper Rubric");
    expect(data.rubric.criteria).toHaveLength(2);
    expect(data.rubric.criteria[0].description).toBe("Thesis Quality");
    expect(data.rubric.criteria[0].longDescription).toBe(
      "Clear, arguable thesis statement",
    );
    expect(data.rubric.criteria[0].ratings).toHaveLength(3);
    expect(data.rubric.criteria[0].ratings[0].description).toBe("Excellent");
    expect(data.rubric.criteria[0].points).toBe("5");
  });
});
