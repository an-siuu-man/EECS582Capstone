# Headstart AI – Chrome Extension

Chrome Manifest V3 extension that integrates with Canvas LMS to detect assignments and extract their data for AI-powered guide generation.

## Features (Sprint 1)

- **Canvas page detection** – Identifies single assignment pages and assignment list pages on `*.instructure.com`.
- **Assignment data extraction** – Scrapes title, description (HTML + text), due date, points, submission type, and rubric (criteria + ratings).
- **Content injection** – Injects a lightweight widget into the Canvas sidebar showing detected assignment info.
- **Service worker** – Deduplicates assignment events via `chrome.storage.local` and manages badge notifications.

## Project Structure

```
extension/
├── manifest.json                         # MV3 manifest
├── package.json                          # Dev dependencies (Jest)
├── jest.config.js
├── assets/icons/                         # Extension icons (placeholder)
├── src/
│   ├── background/
│   │   └── service-worker.js             # MV3 service worker
│   ├── content/
│   │   ├── index.js                      # Content script entry point
│   │   ├── detectors/
│   │   │   └── page-detector.js          # URL-based Canvas page detection
│   │   ├── extractors/
│   │   │   ├── assignment-extractor.js   # Assignment field extraction
│   │   │   └── rubric-extractor.js       # Rubric-specific extraction
│   │   ├── ui/
│   │   │   └── widget-injector.js        # In-page widget injection
│   │   └── styles/
│   │       └── headstart-widget.css      # Widget styles
│   ├── popup/
│   │   ├── popup.html                    # Popup UI
│   │   └── popup.js                      # Popup logic
│   └── shared/
│       └── constants.js                  # Shared constants, selectors, message types
└── tests/
    ├── detectors/
    │   └── page-detector.test.js
    └── extractors/
        └── assignment-extractor.test.js
```

## Getting Started

### Prerequisites

- Node.js 18+
- Chrome browser

### Install dev dependencies

```bash
cd extension
npm install
```

### Run tests

```bash
npm test
```

### Load the extension in Chrome

1. Generate PNG icons (16×16, 48×48, 128×128) and place them in `assets/icons/`.
2. Open `chrome://extensions/` in Chrome.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the `extension/` directory.
5. Navigate to a Canvas assignment page to see the widget in action.

> **Note:** The content script uses ES module imports. Chrome MV3 supports `"type": "module"` for the service worker but **not** for content scripts by default. For development/testing the content script works via the test harness. For production, a bundler (e.g., Vite, Rollup, or esbuild) will be added in a future sprint to bundle content scripts into a single IIFE.

## Architecture Notes

- **Page detection** is purely URL-based for reliability – no dependency on Canvas DOM for determining page type.
- **Data extraction** uses a resilient selector strategy with multiple fallback selectors for each data field, since Canvas themes and versions can vary across institutions.
- **Widget injection** targets Canvas' `#right-side` sidebar as the primary mount point, with fallback targets.
- **Deduplication** in the service worker prevents re-processing the same assignment when a student revisits the page.
