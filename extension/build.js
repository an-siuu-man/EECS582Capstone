/**
 * esbuild configuration for Headstart AI Chrome Extension.
 *
 * Bundles ES-module source files into Chrome-compatible scripts:
 *  - Content script  → IIFE (Chrome content scripts don't support ES modules)
 *  - Service worker  → ESM  (MV3 service workers support "type": "module")
 *  - Popup script    → IIFE
 */

const esbuild = require("esbuild");
const path = require("path");

const isWatch = process.argv.includes("--watch");

/** @type {import('esbuild').BuildOptions} */
const commonOptions = {
  bundle: true,
  sourcemap: true,
  logLevel: "info",
  outdir: path.resolve(__dirname, "dist"),
};

// Content script – must be IIFE (no module support in content scripts)
const contentScript = {
  ...commonOptions,
  entryPoints: [path.resolve(__dirname, "src/content/index.js")],
  outdir: path.resolve(__dirname, "dist/content"),
  format: "iife",
  target: ["chrome110"],
};

// Service worker – ES module (MV3 supports "type": "module")
const serviceWorker = {
  ...commonOptions,
  entryPoints: [path.resolve(__dirname, "src/background/service-worker.js")],
  outdir: path.resolve(__dirname, "dist/background"),
  format: "esm",
  target: ["chrome110"],
};

// Popup script – IIFE
const popupScript = {
  ...commonOptions,
  entryPoints: [path.resolve(__dirname, "src/popup/popup.js")],
  outdir: path.resolve(__dirname, "dist/popup"),
  format: "iife",
  target: ["chrome110"],
};

async function build() {
  if (isWatch) {
    const contexts = await Promise.all([
      esbuild.context(contentScript),
      esbuild.context(serviceWorker),
      esbuild.context(popupScript),
    ]);
    await Promise.all(contexts.map((ctx) => ctx.watch()));
    console.log("Watching for changes...");
  } else {
    await Promise.all([
      esbuild.build(contentScript),
      esbuild.build(serviceWorker),
      esbuild.build(popupScript),
    ]);
    console.log("Build complete.");
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
