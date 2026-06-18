// Dev-only Node module loader for running project TS scripts OUTSIDE Next.js.
//
// Next provides `server-only` / `client-only` as virtual modules at build time;
// they are not installed as real packages, so a plain `node script.ts` run can't
// resolve them. This loader maps them to an empty module so server-tagged helpers
// (e.g. lib/seller/password.ts) can be imported by one-off scripts.
//
// This affects ONLY scripts launched with `node --import ./scripts/_dev-ts-loader.mjs`.
// It is never part of the app build or runtime.
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only" || specifier === "client-only") {
      return { url: "data:text/javascript,export{}", shortCircuit: true };
    }
    return next(specifier, context);
  },
});
