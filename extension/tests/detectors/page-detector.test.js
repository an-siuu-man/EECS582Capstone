/**
 * Tests for Canvas page detection logic.
 */

import { detectCanvasPage } from "../../src/content/detectors/page-detector.js";

describe("detectCanvasPage", () => {
  test("detects a single assignment page", () => {
    const result = detectCanvasPage(
      "https://umich.instructure.com/courses/123/assignments/456",
    );
    expect(result).toEqual({
      type: "single_assignment",
      courseId: "123",
      assignmentId: "456",
      url: "https://umich.instructure.com/courses/123/assignments/456",
    });
  });

  test("detects assignment page with trailing slash", () => {
    const result = detectCanvasPage(
      "https://canvas.instructure.com/courses/999/assignments/111/",
    );
    // The single assignment regex will still match because it doesn't require end-of-string
    expect(result).not.toBeNull();
    expect(result.type).toBe("single_assignment");
    expect(result.courseId).toBe("999");
    expect(result.assignmentId).toBe("111");
  });

  test("detects the assignment list page", () => {
    const result = detectCanvasPage(
      "https://umich.instructure.com/courses/123/assignments",
    );
    expect(result).toEqual({
      type: "assignment_list",
      courseId: "123",
      assignmentId: null,
      url: "https://umich.instructure.com/courses/123/assignments",
    });
  });

  test("detects assignment list page with trailing slash", () => {
    const result = detectCanvasPage(
      "https://umich.instructure.com/courses/123/assignments/",
    );
    expect(result).toEqual({
      type: "assignment_list",
      courseId: "123",
      assignmentId: null,
      url: "https://umich.instructure.com/courses/123/assignments/",
    });
  });

  test("returns null for unrelated Canvas pages", () => {
    expect(
      detectCanvasPage("https://umich.instructure.com/courses/123/modules"),
    ).toBeNull();
    expect(
      detectCanvasPage("https://umich.instructure.com/courses/123/grades"),
    ).toBeNull();
  });

  test("returns null for non-Canvas URLs without assignment paths", () => {
    expect(detectCanvasPage("https://google.com")).toBeNull();
    expect(detectCanvasPage("https://example.com/some/other/page")).toBeNull();
  });

  test("matches assignment path pattern regardless of domain (manifest restricts host)", () => {
    // The detector is URL-path-based; host restriction is enforced by manifest content_scripts matches
    const result = detectCanvasPage(
      "https://example.com/courses/1/assignments/2",
    );
    expect(result).not.toBeNull();
    expect(result.courseId).toBe("1");
    expect(result.assignmentId).toBe("2");
  });

  test("handles various instructure subdomains", () => {
    const result = detectCanvasPage(
      "https://school.test.instructure.com/courses/42/assignments/7",
    );
    expect(result).not.toBeNull();
    expect(result.courseId).toBe("42");
    expect(result.assignmentId).toBe("7");
  });

  test("detects assignments on custom Canvas domains like canvas.ku.edu", () => {
    const result = detectCanvasPage(
      "https://canvas.ku.edu/courses/185114/assignments/1261395",
    );
    expect(result).toEqual({
      type: "single_assignment",
      courseId: "185114",
      assignmentId: "1261395",
      url: "https://canvas.ku.edu/courses/185114/assignments/1261395",
    });
  });
});
