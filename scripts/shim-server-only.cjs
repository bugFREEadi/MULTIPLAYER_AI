/**
 * Allows Node/tsx scripts to import modules that use `import "server-only"`.
 * Next.js already stubs this for the App Router bundler; bare Node does not.
 *
 * Usage: npx tsx -r ./scripts/shim-server-only.cjs scripts/verify-step21.ts
 */
const Module = require("module");
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "server-only") {
    return {};
  }
  return originalLoad.apply(this, arguments);
};
