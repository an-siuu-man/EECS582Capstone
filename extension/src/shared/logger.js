/**
 * Headstart Logger
 *
 * Creates a scoped logger instance for a specific module. Each logger prefixes
 * all output with `[Headstart:<context>]` and maps to the appropriate console
 * method so DevTools' log-level filters work correctly.
 *
 * Usage:
 *   import { createLogger } from "../shared/logger.js";
 *   const log = createLogger("SW");       // service worker
 *   const log = createLogger("Content");  // content script
 *   const log = createLogger("Widget");   // widget injector
 *
 *   log.debug("variable:", value);  // verbose / DevTools "Verbose" level
 *   log.info("message");            // normal / DevTools "Info" level
 *   log.warn("something odd");      // DevTools "Warning" level
 *   log.error("failure:", err);     // DevTools "Error" level
 */
export function createLogger(context) {
  const prefix = `[Headstart:${context}]`;
  return {
    debug: (...args) => console.debug(prefix, ...args),
    info: (...args) => console.log(prefix, ...args),
    warn: (...args) => console.warn(prefix, ...args),
    error: (...args) => console.error(prefix, ...args),
  };
}
