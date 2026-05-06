# Extension Architecture

## Purpose

The Chrome Manifest V3 extension integrates Headstart with Canvas LMS. It detects Canvas assignment pages, extracts assignment context through Canvas APIs and DOM fallbacks, stores normalized assignment records in `chrome.storage.local`, injects an in-page Headstart sidebar, and hands authenticated guide generation off to the local web app dashboard.

The extension does not call the Python agent service directly. It talks to web app API routes on `http://localhost:3000` by default, and the web app owns chat-session creation, guide generation, persistence, and dashboard rendering.

## Runtime Components

- `manifest.json`: MV3 manifest, permissions, host permissions, content script matches, background service worker, popup, icons, and widget CSS registration.
- `build.js`: esbuild bundling for the content script, background service worker, and popup script.
- `src/content/index.js`: Canvas content-script entrypoint. Detects page type and dispatches to the right content workflow.
- `src/content/detectors/page-detector.js`: URL-based Canvas assignment/list classifier.
- `src/content/workflows/single-assignment-workflow.js`: Single-assignment extraction, module resource lookup, storage messaging, and widget injection flow.
- `src/content/workflows/assignment-list-workflow.js`: Assignment-list scrape and course-overview widget flow.
- `src/content/extractors/assignment-extractor.js`: Assignment extractor that prefers Canvas REST API data and falls back to DOM scraping.
- `src/content/extractors/canvas-api-extractor.js`: Same-origin Canvas API extraction for assignment, course, user profile timezone, rubric, and PDF attachments.
- `src/content/extractors/modules-extractor.js`: Canvas modules API lookup for resources attached through modules, including PDF file downloads.
- `src/content/extractors/assignment-list-extractor.js`: DOM scraper for assignment-list rows.
- `src/content/extractors/rubric-extractor.js`: DOM fallback rubric parser.
- `src/content/injectors/widget-injector.js`: In-page sidebar/toggle UI, guide-status preflight, login/dashboard actions, and background message handling.
- `src/content/ui/widget-injector.js`: Backward-compatible re-export of the injector.
- `src/background/service-worker.js`: MV3 service-worker entry module.
- `src/background/index.js`: Background runtime message router and install/update logging.
- `src/background/handlers/assignment-handlers.js`: Storage synchronization for assignment detection and extraction messages.
- `src/background/workflows/headstart-run-workflow.js`: Guide-status checks and chat-session handoff workflow.
- `src/background/workflows/headstart-payload.js`: Normalized Headstart payload builder from stored assignment records.
- `src/storage/assignment-store.js`: `chrome.storage.local` access layer.
- `src/clients/webapp-client.js`: HTTP client for web app routes used by the extension.
- `src/popup/*`: Popup UI that lists locally detected assignments.
- `src/shared/*`: Message contracts, Canvas selectors/patterns, date/time helpers, logging, and compatibility barrels.
- `src/styles/headstart-widget.css`: Sidebar and toggle styles loaded by the manifest.

## Browser Surface

Manifest permissions:

- `storage`
- `activeTab`
- `alarms` (declared, but not currently used by source code)

Host permissions:

- `https://*.instructure.com/*`
- `https://canvas.ku.edu/*`
- `http://localhost:3000/*`

Content script matches:

- Canvas single-assignment pages: `/courses/*/assignments/*`
- Canvas assignment-list pages: `/courses/*/assignments`
- Both generic `*.instructure.com` and `canvas.ku.edu` hosts

Build outputs:

- `dist/content/index.js`: IIFE content script
- `dist/background/service-worker.js`: ESM MV3 service worker
- `dist/popup/popup.js`: IIFE popup script

## Module Boundaries

- `content/detectors`: URL/page classification only.
- `content/extractors`: Canvas API and DOM extraction only.
- `content/workflows`: Content-script orchestration for page-specific flows.
- `content/injectors` and `content/ui`: In-page Headstart UI and user interactions.
- `background/index.js`: Message routing and lifecycle listener registration.
- `background/handlers`: Message-specific storage updates.
- `background/workflows`: Multi-step background orchestration and web app handoff.
- `storage`: All `chrome.storage.local` key construction and reads/writes.
- `clients`: All extension-to-webapp HTTP calls.
- `shared`: Cross-context constants, contracts, logging, and date helpers.

## Runtime Messages

Defined message types:

- `ASSIGNMENT_DETECTED`
- `ASSIGNMENT_DATA`
- `REQUEST_EXTRACTION` (defined for compatibility, not currently routed)
- `CHECK_ASSIGNMENT_GUIDE_STATUS`
- `START_HEADSTART_RUN`
- `HEADSTART_RESULT`
- `HEADSTART_AUTH_REQUIRED`
- `HEADSTART_ERROR`

Background-routed messages:

- `ASSIGNMENT_DETECTED`: Upserts a detected assignment shell in storage.
- `ASSIGNMENT_DATA`: Merges extracted assignment details into storage.
- `CHECK_ASSIGNMENT_GUIDE_STATUS`: Calls the web app to determine whether a guide already exists and whether authentication is required.
- `START_HEADSTART_RUN`: Builds a normalized payload and creates a webapp chat session.

Widget-received messages:

- `HEADSTART_RESULT`: Stores dashboard redirect state in the sidebar and changes the CTA to open the dashboard guide view.
- `HEADSTART_AUTH_REQUIRED`: Changes the CTA to open the web app login page.
- `HEADSTART_ERROR`: Re-enables the CTA and displays a user-facing error.

Unknown background messages are acknowledged with `{ status: "unknown" }`.

## Stored Assignment Model

Assignment storage keys use:

- `assignment::<courseId>::<assignmentId>`

Stored records are plain objects containing the best-known assignment state:

- `courseId`
- `assignmentId`
- `url`
- `detectedAt`
- `status: "detected" | "extracted"`
- `title`
- `courseName`
- `dueDate`
- `pointsPossible`
- `descriptionText`
- `rubric`
- `userTimezone`
- `pdfs`
- `pdfAttachments`
- `moduleResources`
- `moduleResourcesMeta`

Detection upserts preserve existing extracted data where possible. Extraction merges preserve earlier values when a later partial extraction is missing a field.

## Extracted Assignment Data

Primary extraction path:

1. Fetch Canvas assignment data from `/api/v1/courses/{courseId}/assignments/{assignmentId}?include[]=rubric_definition` with `credentials: "include"`.
2. Fetch Canvas course metadata from `/api/v1/courses/{courseId}`.
3. Fetch user profile metadata from `/api/v1/users/self/profile` to capture `time_zone`.
4. Map Canvas assignment fields to the extension `AssignmentData` shape.
5. Map Canvas API rubric data when available.
6. Collect PDF attachments from `assignment.attachments`.
7. Collect PDF links embedded in the assignment description.
8. Download PDF bytes and encode them as base64 for the downstream payload.

Fallback extraction path:

1. Scrape title, course name, description HTML/text, due date, points, submission type, and rubric from Canvas DOM selectors.
2. Return the same normalized shape with `meta.source = "dom-scraping"`.
3. Leave `userTimezone` null because it is only available from the API path.

Module-resource path:

1. Fetch modules from `/api/v1/courses/{courseId}/modules?include[]=items&per_page=100`.
2. Select modules containing the current assignment item.
3. Collect non-SubHeader module resources.
4. Resolve Canvas file metadata for `File` items.
5. Download PDF files and encode them as base64.
6. Attach `moduleResources` and `moduleResourcesMeta` to the assignment data before persistence.

Assignment-list pages scrape assignment rows from the DOM, send `ASSIGNMENT_DETECTED` for each assignment with an id, and inject a course-overview sidebar list.

## Widget Behavior

The content widget injects a floating toggle button and a sidebar once per page.

Single-assignment pages:

- Show course, title, due date, points, and rubric count when available.
- Immediately check guide status through `CHECK_ASSIGNMENT_GUIDE_STATUS`.
- Display "Generate Guide" when no guide exists.
- Display "Generate New Guide" when a guide already exists.
- Display "Log in to Headstart" when the web app returns an auth error.
- Re-check status when the tab regains focus or visibility, which helps recover after a login tab flow.
- Send `START_HEADSTART_RUN` when the student starts generation.
- Change to "View Guide in Dashboard" after the web app chat session is created.

Assignment-list pages:

- Show a course overview list of scraped assignments.
- Use the CTA to open `/dashboard` in the web app.

The widget uses the `motion` package for sidebar/button animations and falls back to direct style updates if animation fails.

## Web App Integration

Base URL:

- `http://localhost:3000`

Routes called by the extension:

- `GET /api/assignment-guide-status?course_id=<id>&assignment_id=<id>&instance_domain=<host>`
- `POST /api/chat-session`

Guide-status request:

- Sent from the background workflow with Canvas course id, assignment id, and Canvas instance hostname.
- Uses `credentials: "include"` so web app auth cookies are sent.
- `401` or `403` is interpreted as authentication required.

Chat-session request:

- Builds a normalized payload from storage with `buildHeadstartPayload()`.
- Sends `{ payload }` and optional `user_id`.
- Expects a response containing `session_id`.
- Converts `session_id` to `/dashboard/chat?session=<session_id>`.
- Sends `HEADSTART_RESULT` back to the Canvas tab with `status`, `sessionId`, and `redirectUrl`.

The extension intentionally avoids streaming or polling agent output. It creates the dashboard-backed session and lets the web app show generation progress.

## Normalized Headstart Payload

`buildHeadstartPayload()` derives:

- Canvas identifiers: `courseId`, `courseName`, `assignmentId`
- Assignment identity: `title`, `url`, `detectedAt`, `status`
- Due-date fields: `dueDateRaw`, `dueAtISO`, `dueDateFormatted`, `userTimezone`
- User id passthrough: `userId`
- Flags: `daysToDue`, `isOverdue`, `isDueSoon`
- Assignment context: `descriptionText`, `rubric`
- File/resource context: `pdfs`, `pdfAttachments`, `moduleResources`, `moduleResourcesMeta`

Due dates are parsed from ISO strings or common Canvas text such as `Mar 5 at 11:59pm`. Parsed dates are formatted with the Canvas profile timezone when available.

## Popup Behavior

The popup reads all `chrome.storage.local` entries whose keys start with `assignment::`, sorts them by `detectedAt` descending, and renders course/title/due-date/status summaries. It does not initiate extraction or guide generation.

## Failure And Recovery Behavior

- Unrecognized Canvas URLs cause the content script to exit without side effects.
- Canvas API assignment extraction failures return `null` and trigger DOM fallback.
- Course/profile API failures do not fail assignment extraction.
- Canvas module API or file-download failures are logged and skipped; successful resources are still kept.
- PDF download failures are logged and omitted from `pdfAttachments` or `moduleResources`.
- Missing Canvas ids or missing stored assignment records produce `HEADSTART_ERROR`.
- Web app `401`/`403` responses produce `HEADSTART_AUTH_REQUIRED` and a login URL.
- Other non-2xx web app responses throw `WebappHttpError` and surface as `HEADSTART_ERROR`.
- Guide-status lookup failures that are not auth errors are logged and treated as "no known guide" so the widget remains usable.
- One-way `chrome.tabs.sendMessage` "message port closed" warnings are treated as delivered because the widget does not send responses for every inbound message.
- Widget animation/rendering errors are caught and logged without blocking core actions.

## External Dependencies

- Chrome Extension APIs: `runtime`, `tabs`, `storage`, `action`.
- Canvas LMS URL patterns, DOM selectors, and same-origin REST APIs.
- Local Headstart web app API at `http://localhost:3000` by default.
- NPM runtime dependencies: `motion` for widget animation. `marked` is installed but not used by current source code.
- Development/build dependencies: esbuild, Jest, Babel/Jest tooling, and jsdom-based tests.
