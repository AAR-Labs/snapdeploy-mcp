/** The model's context is not a safe place for secrets: every API reply passes
 *  through here before it reaches the assistant. Env-var maps keep their NAMES
 *  (that is useful signal) with values replaced by "(set)"; any key that looks
 *  like a credential is masked outright. */

const SECRET_KEY =
  /password|secret|token|credential|api[_-]?key|apikey|connection[_-]?string|conn[_-]?string|dsn|private[_-]?key|jwt|authorization/i;

const ENV_MAPS = new Set(["environmentVariables", "buildEnvVars", "envVars", "env"]);

export function redact(value: any, keyHint?: string): any {
  if (Array.isArray(value)) return value.map((v) => redact(v));
  if (value !== null && typeof value === "object") {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      if (ENV_MAPS.has(k) && v !== null && typeof v === "object" && !Array.isArray(v)) {
        const masked: Record<string, string> = {};
        for (const name of Object.keys(v)) masked[name] = "(set)";
        out[k] = masked;
      } else if (SECRET_KEY.test(k) && typeof v === "string" && v.length > 0) {
        out[k] = "(redacted)";
      } else {
        out[k] = redact(v, k);
      }
    }
    return out;
  }
  if (typeof value === "string" && keyHint && SECRET_KEY.test(keyHint) && value.length > 0) {
    return "(redacted)";
  }
  return value;
}

export function toJson(value: any): string {
  return JSON.stringify(redact(value), null, 2);
}
