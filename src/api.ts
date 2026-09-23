import type { Config } from "./config.js";

/** Non-2xx API reply, carrying the parsed body so tools can speak the
 *  platform's own CTAs (402 hour gate, 429 deploy cap, 403 interactive-only). */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: any,
    public readonly path: string
  ) {
    super(`SnapDeploy API ${status} on ${path}`);
  }
}

export class SnapDeployApi {
  /** Assistant name from the MCP initialize handshake — sent on every call so
   *  the platform can attribute connector traffic (initiatedBy = mcp:<client>). */
  clientName = "unknown";

  constructor(private readonly cfg: Config) {}

  get baseUrl(): string {
    return this.cfg.baseUrl;
  }

  /** Absolute URL for the actionUrl paths the platform returns ("/billing…"). */
  absolute(pathOrUrl: string): string {
    if (!pathOrUrl) return this.cfg.baseUrl;
    return /^https?:/i.test(pathOrUrl) ? pathOrUrl : this.cfg.baseUrl + pathOrUrl;
  }

  async get(path: string): Promise<any> {
    return this.request("GET", path);
  }
  async post(path: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<any> {
    return this.request("POST", path, body, extraHeaders);
  }
  async put(path: string, body?: unknown): Promise<any> {
    return this.request("PUT", path, body);
  }

  private async request(method: string, path: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<any> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await fetch(this.cfg.baseUrl + path, {
        method,
        headers: {
          "X-API-Key": this.cfg.apiKey,
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-SnapDeploy-Client": `mcp/${this.clientName}`,
          ...(extraHeaders ?? {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await res.text();
      let data: any = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = { raw: text.slice(0, 2000) };
      }
      if (!res.ok) throw new ApiError(res.status, data, path);
      return data;
    } finally {
      clearTimeout(timer);
    }
  }
}
