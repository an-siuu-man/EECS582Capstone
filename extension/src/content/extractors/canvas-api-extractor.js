/**
 * Canvas REST API Assignment Extractor
 *
 * Fetches assignment data directly from Canvas's REST API instead of scraping the DOM.
 * This works because the content script runs on the Canvas domain (same-origin),
 * so the browser automatically sends session cookies with every fetch — no API token needed.
 *
 * API docs: https://canvas.instructure.com/doc/api/assignments.html
 */

import { createLogger } from "../../shared/logger.js";

const log = createLogger("APIExtractor");

/**
 * Fetch assignment data from the Canvas REST API.
 *
 * @param {string} courseId
 * @param {string} assignmentId
 * @returns {Promise<import('./assignment-extractor.js').AssignmentData|null>}
 *   Returns the assignment data or null if the API call fails.
 */
export async function fetchAssignmentFromAPI(courseId, assignmentId) {
  try {
    log.info(
      `Fetching via Canvas API: course=${courseId} assignment=${assignmentId}`,
    );

    // Fire all requests in parallel (assignment, course, user profile for timezone)
    const [assignmentResp, courseResp, profileResp] = await Promise.all([
      fetch(
        `/api/v1/courses/${courseId}/assignments/${assignmentId}?include[]=rubric_definition`,
        { credentials: "include" },
      ),
      fetch(`/api/v1/courses/${courseId}`, { credentials: "include" }),
      fetch(`/api/v1/users/self/profile`, { credentials: "include" }),
    ]);

    if (!assignmentResp.ok) {
      log.warn(
        `Assignment API returned ${assignmentResp.status} – cannot extract via API`,
      );
      return null;
    }

    const assignment = await assignmentResp.json();
    log.debug("Assignment API response keys:", Object.keys(assignment));

    // Course name is optional — don't fail if it doesn't work
    let courseName = "";
    if (courseResp.ok) {
      const course = await courseResp.json();
      courseName = course.name || "";
      log.debug("Course name from API:", courseName);
    } else {
      log.warn(
        `Course API returned ${courseResp.status} – skipping course name`,
      );
    }

    // Extract user timezone from profile (IANA string, e.g. "America/New_York")
    let userTimezone = null;
    if (profileResp.ok) {
      const profile = await profileResp.json();
      userTimezone = profile.time_zone || null;
      log.debug("User timezone from API:", userTimezone);
    } else {
      log.warn(
        `Profile API returned ${profileResp.status} – skipping timezone`,
      );
    }

    // Map API response → AssignmentData shape
    const descriptionHtml = assignment.description || "";
    const descriptionText = htmlToPlainText(descriptionHtml);

    const rubric = mapRubric(assignment);

    // Download any PDF attachments from the assignment
    // Sources: 1) assignment.attachments array  2) file links in description HTML
    const pdfAttachments = await collectPdfAttachments(assignment, courseId);

    const result = {
      title: assignment.name || "",
      courseName,
      descriptionHtml,
      descriptionText,
      dueDate: assignment.due_at || null,
      pointsPossible:
        assignment.points_possible != null
          ? String(assignment.points_possible)
          : null,
      submissionType: Array.isArray(assignment.submission_types)
        ? assignment.submission_types.join(", ")
        : null,
      rubric,
      pdfAttachments,
      userTimezone,
      meta: {
        courseId,
        assignmentId,
        url: window.location.href,
        extractedAt: new Date().toISOString(),
        source: "canvas-api",
      },
    };

    log.info(
      "API extraction succeeded:",
      `title="${result.title}"`,
      `| dueDate=${result.dueDate ?? "none"}`,
      `| points=${result.pointsPossible ?? "none"}`,
      `| rubric=${result.rubric ? result.rubric.criteria.length + " criteria" : "none"}`,
      `| descLen=${result.descriptionText.length}`,
      `| pdfs=${pdfAttachments.length}`,
    );

    return result;
  } catch (err) {
    log.error("API extraction failed:", err?.message || err);
    return null;
  }
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

/**
 * Convert HTML to plain text using a temporary DOM element.
 * Safe to call from a content script (runs in browser context).
 */
function htmlToPlainText(html) {
  if (!html) return "";
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.textContent.trim();
}

/**
 * Map the Canvas API rubric data to the shape used by the rest of the extension.
 *
 * Canvas API returns rubric as an array on the assignment object when
 * `include[]=rubric_definition` is used:
 *   assignment.rubric = [{ id, description, long_description, points, ratings: [...] }]
 *   assignment.rubric_settings = { title, ... }
 *
 * @param {object} assignment - The raw Canvas API assignment object
 * @returns {import('./rubric-extractor.js').Rubric|null}
 */
function mapRubric(assignment) {
  const apiRubric = assignment.rubric;
  if (!Array.isArray(apiRubric) || apiRubric.length === 0) {
    return null;
  }

  const title = assignment.rubric_settings?.title || "Rubric";

  const criteria = apiRubric.map((criterion) => ({
    description: criterion.description || "",
    longDescription: criterion.long_description || null,
    points: criterion.points != null ? String(criterion.points) : null,
    ratings: Array.isArray(criterion.ratings)
      ? criterion.ratings.map((r) => ({
          description: r.description || "",
          points: r.points != null ? String(r.points) : null,
        }))
      : [],
  }));

  return { title, criteria };
}

/**
 * Collect and download PDF files from all available sources:
 *   1. assignment.attachments[] — formal Canvas attachments
 *   2. Links in assignment.description HTML — instructors often embed file links
 *
 * @param {object} assignment - The raw Canvas API assignment object
 * @param {string} courseId - Used to resolve relative file URLs
 * @returns {Promise<Array<{filename: string, base64Data: string}>>}
 */
async function collectPdfAttachments(assignment, courseId) {
  const results = [];
  const seenUrls = new Set();

  // ── Source 1: assignment.attachments array ─────────────────
  const attachments = assignment.attachments;
  if (Array.isArray(attachments) && attachments.length > 0) {
    const pdfs = attachments.filter(
      (a) =>
        a["content-type"] === "application/pdf" || a.filename?.endsWith(".pdf"),
    );
    log.info(
      `attachments[]: ${attachments.length} total, ${pdfs.length} PDF(s)`,
    );

    for (const pdf of pdfs) {
      const downloaded = await downloadPdf(
        pdf.url,
        pdf.display_name || pdf.filename,
      );
      if (downloaded) {
        seenUrls.add(pdf.url);
        results.push(downloaded);
      }
    }
  } else {
    log.debug("No assignment.attachments array found");
  }

  // ── Source 2: PDF links in description HTML ────────────────
  const descHtml = assignment.description || "";
  if (descHtml) {
    const fileLinks = extractFileLinksFromHtml(descHtml, courseId);
    log.info(`Description HTML: found ${fileLinks.length} file link(s)`);

    for (const link of fileLinks) {
      if (seenUrls.has(link.downloadUrl)) continue;
      seenUrls.add(link.downloadUrl);

      const downloaded = await downloadPdf(link.downloadUrl, link.filename);
      if (downloaded) {
        results.push(downloaded);
      }
    }
  }

  log.info(`Total PDF attachments collected: ${results.length}`);
  return results;
}

/**
 * Download a single PDF from the given URL and return it as base64.
 *
 * Canvas API file endpoints return JSON metadata with a `url` field
 * pointing to the actual download location (often an S3 presigned URL).
 * This function detects JSON responses and follows the `url` automatically.
 *
 * @param {string} url
 * @param {string} filename
 * @returns {Promise<{filename: string, base64Data: string}|null>}
 */
async function downloadPdf(url, filename) {
  try {
    log.debug(`Downloading PDF: "${filename}" from ${url.slice(0, 120)}`);

    let resp = await fetch(url, { credentials: "include" });

    if (!resp.ok) {
      log.warn(`Failed to download "${filename}" – HTTP ${resp.status}`);
      return null;
    }

    const contentType = resp.headers.get("content-type") || "";
    log.debug(`"${filename}" content-type: "${contentType}"`);

    // Canvas API file endpoints return JSON metadata, not the file itself.
    // If we detect JSON, extract the real download URL from the `url` field.
    if (contentType.includes("application/json")) {
      const meta = await resp.json();
      const realUrl = meta.url;
      if (!realUrl) {
        log.warn(
          `"${filename}" API response has no url field:`,
          Object.keys(meta),
        );
        return null;
      }
      log.debug(
        `"${filename}" following real download URL: ${realUrl.slice(0, 120)}`,
      );

      // The real URL is typically an S3 presigned URL — no credentials needed
      resp = await fetch(realUrl);
      if (!resp.ok) {
        log.warn(
          `Failed to download "${filename}" from real URL – HTTP ${resp.status}`,
        );
        return null;
      }

      const realContentType = resp.headers.get("content-type") || "";
      log.debug(`"${filename}" real content-type: "${realContentType}"`);
    }

    const buffer = await resp.arrayBuffer();
    const base64Data = arrayBufferToBase64(buffer);

    log.debug(
      `Downloaded "${filename}" – ${buffer.byteLength} bytes, ${base64Data.length} chars base64`,
    );
    return { filename, base64Data };
  } catch (err) {
    log.warn(`Error downloading PDF "${filename}":`, err?.message || err);
    return null;
  }
}

/**
 * Parse the assignment description HTML and extract links to Canvas-hosted files.
 *
 * Canvas instructors embed files as links with class "instructure_file_link"
 * and a `data-api-endpoint` attribute pointing to the REST API:
 *   <a class="instructure_file_link"
 *      href="https://canvas.ku.edu/courses/176048/files/16754205?wrap=1"
 *      data-api-endpoint="https://canvas.ku.edu/api/v1/courses/176048/files/16754205"
 *      title="Ref_Ch05.pdf">Ref_Ch05.pdf</a>
 *
 * We use `data-api-endpoint` for reliable downloads (with ?download_frd=1),
 * falling back to constructing the REST API URL from the file ID.
 *
 * @param {string} html - The description HTML
 * @param {string} courseId - Used to resolve relative URLs if needed
 * @returns {Array<{filename: string, downloadUrl: string}>}
 */
function extractFileLinksFromHtml(html, courseId) {
  if (!html) return [];

  const div = document.createElement("div");
  div.innerHTML = html;

  const links = div.querySelectorAll("a[href]");
  const fileLinks = [];

  for (const anchor of links) {
    const href = anchor.getAttribute("href") || "";
    const linkText = anchor.textContent.trim();
    const title = anchor.getAttribute("title") || "";

    // Check if href contains a Canvas file ID
    const fileIdMatch = href.match(/\/files\/(\d+)/);
    if (!fileIdMatch) continue;

    // Only download files that look like PDFs (check link text, href, and title)
    const isPdf =
      linkText.toLowerCase().endsWith(".pdf") ||
      href.toLowerCase().includes(".pdf") ||
      title.toLowerCase().endsWith(".pdf");
    if (!isPdf) continue;

    const fileId = fileIdMatch[1];

    // Prefer data-api-endpoint (Canvas provides this on every file link)
    const apiEndpoint = anchor.getAttribute("data-api-endpoint");
    let downloadUrl;
    if (apiEndpoint) {
      downloadUrl = apiEndpoint + "?download_frd=1";
    } else {
      // Fallback: construct REST API download URL
      downloadUrl = `${window.location.origin}/api/v1/courses/${courseId}/files/${fileId}?download_frd=1`;
    }

    const filename = linkText.endsWith(".pdf")
      ? linkText
      : title.endsWith(".pdf")
        ? title
        : `file-${fileId}.pdf`;

    log.debug(`Found PDF link in description: "${filename}" → ${downloadUrl}`);
    fileLinks.push({ filename, downloadUrl });
  }

  return fileLinks;
}

/**
 * Convert an ArrayBuffer to a base64-encoded string.
 */
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
