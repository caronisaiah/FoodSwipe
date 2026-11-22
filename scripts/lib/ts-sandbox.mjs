// Runs the app's real TypeScript modules in an isolated vm context without a bundler, network,
// database or browser. Dependencies are replaced with fakes through `overrides`.
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve, join } from "node:path";
import { runInNewContext } from "node:vm";

const require = createRequire(import.meta.url);

export function createSandbox({ root, overrides = {}, env = {} }) {
  const ts = require(join(root, "node_modules/typescript"));
  const cache = new Map();
  const processObj = { env };

  function resolveFile(from, name) {
    let base;
    if (name.startsWith("@/")) base = resolve(root, name.slice(2));
    else base = resolve(dirname(resolve(root, from)), name);
    for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), base]) {
      if (existsSync(candidate) && /\.(ts|tsx)$/.test(candidate)) return candidate.slice(root.length + 1);
    }
    throw new Error(`Cannot resolve ${name} from ${from}`);
  }

  function load(relative) {
    if (cache.has(relative)) return cache.get(relative).exports;
    const mod = { exports: {} };
    cache.set(relative, mod);
    const source = readFileSync(resolve(root, relative), "utf8");
    const output = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const localRequire = (name) => {
      if (name in overrides) return typeof overrides[name] === "function" && overrides[name].__lazy ? overrides[name]() : overrides[name];
      const keyed = name.startsWith(".") ? `${relative}::${name}` : null;
      if (keyed && keyed in overrides) return overrides[keyed];
      if (name === "server-only") return {};
      if (name.startsWith("node:")) return require(name);
      if (name.startsWith("@/") || name.startsWith(".")) {
        const target = resolveFile(relative, name);
        // A path override matches on the resolved file too (e.g. "@/lib/db/candidates" or "lib/db/candidates.ts").
        if (target in overrides) return overrides[target];
        return load(target);
      }
      return require(join(root, "node_modules", name));
    };
    runInNewContext(output, {
      module: mod, exports: mod.exports, require: localRequire, process: processObj,
      console: { info() {}, warn() {}, error() {}, log() {} },
      Request, Response, Headers, URL, URLSearchParams, Date, Buffer, TextEncoder, TextDecoder,
      crypto: globalThis.crypto, setTimeout, clearTimeout, AbortSignal, fetch: async () => { throw new Error("network blocked in tests"); },
    }, { filename: relative });
    return mod.exports;
  }
  return { load, env, ts };
}

/** A module whose every export records the call and throws: proves a denied request never reached it. */
export function trapModule(name, calls, extra = {}) {
  return new Proxy({ __esModule: true, ...extra }, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (typeof prop === "symbol" || prop === "then") return undefined;
      return () => { calls.push(`${name}.${String(prop)}`); throw new Error(`trap: ${name}.${String(prop)} was called`); };
    },
  });
}
