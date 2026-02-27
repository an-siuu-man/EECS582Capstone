/**
 * Artifact: extension/src/background/service-worker.js
 * Purpose: MV3 service worker entry module that loads the background runtime router.
 * Author: Ansuman 'Sharma'
 * Created: 2026-02-27
 * Revised:
 * - 2026-02-27: Refactored service worker into modular background entrypoint wiring. (Ansuman 'Sharma')
 * Preconditions:
 * - Extension is loaded in a Chrome MV3 runtime with service_worker type module enabled.
 * Inputs:
 * - Acceptable: Chrome service worker lifecycle events and runtime messages.
 * - Unacceptable: Direct invocation outside Chrome extension runtime APIs.
 * Postconditions:
 * - Background message/event handlers are registered by importing the background index module.
 * Returns:
 * - No return value; module side effects register listeners.
 * Errors/Exceptions:
 * - Import/runtime errors if dependent modules fail to load.
 */

import "./index.js";
