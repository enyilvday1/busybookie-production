// Loaded explicitly by fork, before tsx or any worker/application import.
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { syncBuiltinESMExports } from "node:module";

for (const key of ["GEMINI_API_KEY", "GOOGLE_API_KEY", "RUNWAYML_API_SECRET"]) process.env[key] = "";
process.env.DOTENV_CONFIG_QUIET = "true";
// Supplied by the parent for this child, never by an operator's shell.
const audit = process.env.B7D_NETWORK_AUDIT;
if (!audit) throw Error("B7D child requires its parent-owned audit path");
const loopback = value => ["localhost", "127.0.0.1", "::1", "[::1]"].includes(String(value).toLowerCase());
function check(kind, host) {
  if (loopback(host)) return;
  fs.appendFileSync(audit, JSON.stringify({ pid: process.pid, kind, host: String(host) }) + "\n");
  throw Object.assign(Error("B7D_NETWORK_BLOCKED"), { code: "B7D_NETWORK_BLOCKED" });
}
const fetchOriginal = globalThis.fetch;
globalThis.fetch = async function(input, ...args) {
  let host;
  try { host = new URL(typeof input === "string" || input instanceof URL ? input : input.url).hostname; } catch {}
  check("fetch", host); return fetchOriginal.call(this, input, ...args);
};
for (const [mod, label] of [[http, "http"], [https, "https"]]) for (const name of ["request", "get"]) {
  const original = mod[name];
  mod[name] = function(input, ...args) {
    const options = typeof input === "string" || input instanceof URL ? new URL(input) : input;
    check(label + "." + name, options?.hostname ?? options?.host ?? "localhost");
    if (args[0] && typeof args[0] === "object") check(label + ".override", args[0].hostname ?? args[0].host ?? options?.hostname ?? "localhost");
    return original.call(this, input, ...args);
  };
}
function socketHost(args) {
  const normalized = Array.isArray(args[0]) ? args[0] : args;
  const first = normalized[0];
  if (first && typeof first === "object") {
    if (first.path) return "localhost"; // local IPC pipe
    return first.host ?? first.hostname ?? "localhost";
  }
  // Match Node's numeric-port overload, including numeric strings.
  if (typeof first === "number" || (typeof first === "string" && Number(first) >= 0))
    return typeof normalized[1] === "string" ? normalized[1] : "localhost";
  return typeof first === "string" ? "localhost" : undefined; // IPC pipe overload
}
for (const name of ["connect", "createConnection"]) {
  const original = net[name];
  net[name] = function(...args) { check("net." + name, socketHost(args)); return original.apply(this, args); };
}
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function(...args) { check("Socket.connect", socketHost(args)); return connect.apply(this, args); };
syncBuiltinESMExports();
process.env.B7D_BOOTSTRAP_INSTALLED = "YES";
