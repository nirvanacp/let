// Servelet declarations (`servelet.json`) and the two shapes of an applet's service config.
// `SERVELET_FORMAT` and `SERVELET_ABI` are numbers of their own, outside `COMPAT`.

import { ENGINE_CHOICES, RUNTIME_CHOICES, SERVELET_CHOICES, requireImplemented, type Choice } from "./choices.js";
import type { ManifestError } from "./manifest.js";

/** The `servelet` format number of `servelet.json`. */
export const SERVELET_FORMAT = 1;
/** The interface between the host and a servelet module: the `let` imports and `let_*` exports. */
export const SERVELET_ABI = 1;

export interface ServeletDeclaration {
  servelet: typeof SERVELET_FORMAT;
  id: string;
  name: string;
  language: string;
  framework: string;
  runtime: string;
  engine: string;
  healthPath: string;
}

/** A service the applet reaches over HTTPS. A config without `runtime` is remote. */
export interface RemoteServiceConfig {
  serviceId: string;
  runtime?: "remote";
  entry: string;
  healthPath: string;
  port: number;
  environment: { token: string; database: string; port: string; certificate: string; key: string };
}

/** A service answered by a servelet that runs inside the host. */
export interface LocalServiceConfig {
  serviceId: string;
  runtime: "local";
  servelet: string;
}

export type ServiceConfig = RemoteServiceConfig | LocalServiceConfig;

export type Validation<T> = { value: T } | { errors: ManifestError[] };

const ID = /^[a-z0-9-]+$/;
const HEALTH_PATH = /^\/[a-z0-9/-]+$/;
const VARIABLE = /^[A-Z][A-Z0-9_]+$/;
const SERVELET_KEYS = ["servelet", "id", "name", "language", "framework", "runtime", "engine", "healthPath"];
const REMOTE_KEYS = ["serviceId", "entry", "healthPath", "port", "environment"];
const ENVIRONMENT_KEYS = ["token", "database", "port", "certificate", "key"];

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(json: Json, allowed: string[], fail: (path: string, message: string) => void): void {
  for (const key of Object.keys(json)) if (!allowed.includes(key)) fail(`/${key}`, "unknown key");
  for (const key of allowed) if (!Object.hasOwn(json, key)) fail(`/${key}`, "required");
}

function choice(tree: Choice[], path: string[], at: string, fail: (path: string, message: string) => void): void {
  try { requireImplemented(tree, path); } catch (error) { fail(at, (error as Error).message); }
}

/** Validates a `servelet.json` declaration. */
export function validateServelet(json: unknown): Validation<ServeletDeclaration> {
  if (!isObject(json)) return { errors: [{ path: "", message: "servelet.json must be an object" }] };
  const errors: ManifestError[] = [];
  const fail = (path: string, message: string) => { errors.push({ path, message }); };
  exactKeys(json, SERVELET_KEYS, fail);
  if (json.servelet !== SERVELET_FORMAT) fail("/servelet", `must be ${SERVELET_FORMAT}`);
  if (typeof json.id !== "string" || !ID.test(json.id)) fail("/id", "must match [a-z0-9-]+");
  if (typeof json.name !== "string" || json.name.trim() === "" || json.name.length > 80) fail("/name", "must be 1 to 80 characters");
  if (typeof json.healthPath !== "string" || !HEALTH_PATH.test(json.healthPath)) fail("/healthPath", "must be a path such as /health");
  if (typeof json.language === "string" && typeof json.framework === "string") choice(SERVELET_CHOICES, [json.language, json.framework], "/framework", fail);
  else fail("/language", "language and framework must be strings");
  if (typeof json.runtime === "string") choice(RUNTIME_CHOICES, [json.runtime], "/runtime", fail);
  else fail("/runtime", "must be a string");
  if (typeof json.engine === "string") choice(ENGINE_CHOICES, [json.engine], "/engine", fail);
  else fail("/engine", "must be a string");
  return errors.length > 0 ? { errors } : { value: json as unknown as ServeletDeclaration };
}

/** Validates a service config file in either shape. */
export function validateServiceConfig(json: unknown): Validation<ServiceConfig> {
  if (!isObject(json)) return { errors: [{ path: "", message: "service config must be an object" }] };
  const errors: ManifestError[] = [];
  const fail = (path: string, message: string) => { errors.push({ path, message }); };
  if (typeof json.serviceId !== "string" || !ID.test(json.serviceId)) fail("/serviceId", "must match [a-z0-9-]+");
  if (json.runtime === "local") {
    exactKeys(json, ["serviceId", "runtime", "servelet"], fail);
    if (typeof json.servelet !== "string" || !ID.test(json.servelet)) fail("/servelet", "must be a servelet id");
  } else if (json.runtime === undefined || json.runtime === "remote") {
    exactKeys(json, json.runtime === undefined ? REMOTE_KEYS : [...REMOTE_KEYS, "runtime"], fail);
    if (typeof json.entry !== "string" || json.entry === "") fail("/entry", "must be a file path");
    if (!Number.isInteger(json.port) || (json.port as number) < 1024 || (json.port as number) > 65535) fail("/port", "must be 1024-65535");
    if (typeof json.healthPath !== "string" || !HEALTH_PATH.test(json.healthPath)) fail("/healthPath", "invalid healthPath");
    const environment = json.environment;
    if (!isObject(environment) || Object.keys(environment).length !== ENVIRONMENT_KEYS.length
      || !ENVIRONMENT_KEYS.every(key => typeof environment[key] === "string" && VARIABLE.test(environment[key] as string))) {
      fail("/environment", `must name ${ENVIRONMENT_KEYS.join(", ")}`);
    }
  } else {
    choice(RUNTIME_CHOICES, [String(json.runtime)], "/runtime", fail);
    if (errors.length === 0) fail("/runtime", "must be local or remote");
  }
  return errors.length > 0 ? { errors } : { value: json as unknown as ServiceConfig };
}
