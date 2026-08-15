// Verify client.js loads under a mocked browser module loader with real react.
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const react = require("D:/Program Files/DeepSeek Harness/resources/app/node_modules/react");
const jsxRuntime = require("D:/Program Files/DeepSeek Harness/resources/app/node_modules/react/jsx-runtime");
const ReactDOMServer = require("D:/Program Files/DeepSeek Harness/resources/app/node_modules/react-dom/server");

let captured = null;
globalThis.window = {
  __ModuleLoader__: {
    load: (mod) => {
      captured = mod.factory((name) => {
        if (name === "react") return react;
        if (name === "react/jsx-runtime") return jsxRuntime;
        throw new Error("unknown module " + name);
      });
    }
  }
};

await import(pathToFileURL("D:/dsh-plugins/dsh-deepseek-quota/lib/client.js").href);
if (captured === null) throw new Error("module loader was not invoked");
if (typeof captured.apply !== "function" || !Array.isArray(captured.inject)) {
  throw new Error("exports shape wrong: " + JSON.stringify(Object.keys(captured)));
}
console.log("CLIENT MODULE LOAD OK (top-level + factory + exports shape)");
console.log("exports:", Object.keys(captured), "| inject:", JSON.stringify(captured.inject));
