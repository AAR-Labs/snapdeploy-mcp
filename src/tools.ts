import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ApiError, SnapDeployApi } from "./api.js";
import type { Config } from "./config.js";
import { apiErrorToText } from "./format.js";
import { redact, toJson } from "./redact.js";

type ToolResult = { content: Array<{ type: "text"; text: string }> };

const text = (t: string): ToolResult => ({ content: [{ type: "text", text: t }] });

/** Container ref by id or name — assistants usually know the name. */
async function resolveContainer(api: SnapDeployApi, ref: string): Promise<any | null> {
  const boot = await api.get("/api/mobile/bootstrap");
  const containers: any[] = boot.containers ?? [];
  return (
    containers.find((c) => (c.containerId ?? c.id) === ref) ??
    containers.find((c) => (c.name ?? "").toLowerCase() === ref.toLowerCase()) ??
    null
  );
}

const cid = (c: any): string => c.containerId ?? c.id;

function capLine(cap: any): string {
  if (!cap) return "";
  // capped:false / remaining:-1 is the server's "exempt" state: an active
  // Always-On or Sprint entitlement lifts the limit account-wide. dailyLimit
  // still reads 5 in that state — never quote it to an uncapped user.
  if (cap.capped === false || cap.remaining === -1 || cap.dailyLimit <= 0) {
    return "Deploy limit: NONE — this account has an active Always-On or Sprint entitlement, so the free tier's 5-per-12h limit does not apply. Deploy freely.";
  }
  const reset = cap.timeUntilReset ? ` (resets in ${cap.timeUntilReset})` : "";
  return `Deploy limit: ${cap.remaining} of ${cap.dailyLimit} left${reset} — failed attempts count too.`;
}

/** "FREE" alone misleads: Always-On is a per-container subscription, not a plan. */
function planLine(boot: any): string {
  const plan = boot.user?.plan ?? "?";
  const aoCount = (boot.containers ?? []).filter((c: any) => c.alwaysOn === true).length;
  const exempt = boot.deployCap && (boot.deployCap.capped === false || boot.deployCap.remaining === -1);
  if (aoCount > 0) return `${plan} plan + Always-On active on ${aoCount} container(s) (SnapDeploy sells per-container subscriptions, not account plans)`;
  if (exempt) return `${plan} plan + an active Always-On/Sprint entitlement`;
  return `${plan} plan`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function registerTools(server: McpServer, api: SnapDeployApi, cfg: Config): void {
  /** Wrap every handler: redaction happens in the reply builders; errors become
   *  actionable text (402/429 CTAs relayed, never retried). */
  const tool = (
    name: string,
    description: string,
    schema: z.ZodRawShape,
    write: boolean,
    handler: (args: any) => Promise<string>
  ) => {
    if (write && cfg.readOnly) return;
    server.registerTool(name, { description, inputSchema: schema }, async (args: any) => {
      try {
        return text(await handler(args));
      } catch (e) {
        return text(apiErrorToText(e, api));
      }
    });
  };

  // ---------- read tools ----------

  tool(
    "list_apps",
    "List the user's SnapDeploy containers with status and URL, plus plan, deploy-limit and free-hours state. Start here to find container ids/names.",
    {},
    false,
    async () => {
      const boot = await api.get("/api/mobile/bootstrap");
      const out = {
        plan: planLine(boot),
        deployLimit: capLine(boot.deployCap),
        containers: boot.containers,
        freeHours: boot.usage,
      };
      return toJson(out);
    }
  );

  tool(
    "get_status",
    "Full status of one container (by name or id): state, URL, port, detected technology, resources. Env-var VALUES are never returned — names only.",
    { container: z.string().describe("Container name or id") },
    false,
    async ({ container }) => {
      const c = await resolveContainer(api, container);
      if (!c) return `No container named or id'd "${container}". Call list_apps to see what exists.`;
      const full = await api.get(`/api/mobile/containers/${cid(c)}`);
      return toJson(full);
    }
  );

  tool(
    "get_logs",
    "Recent RUNTIME logs of a container (CloudWatch, up to 1000 lines). For BUILD logs of a deployment use get_deployments with a deployment_id.",
    {
      container: z.string().describe("Container name or id"),
      lines: z.number().int().min(1).max(1000).optional().describe("Line count, default 100"),
    },
    false,
    async ({ container, lines }) => {
      const c = await resolveContainer(api, container);
      if (!c) return `No container "${container}". Call list_apps first.`;
      const res = await api.get(`/api/mobile/containers/${cid(c)}/logs?lines=${lines ?? 100}`);
      return toJson(res);
    }
  );

  tool(
    "get_deployments",
    "Deployment history of a container, or one deployment in detail (status, error code/message and build-log tail — use this to diagnose a failed build).",
    {
      container: z.string().optional().describe("Container name or id (for the list)"),
      deployment_id: z.string().optional().describe("One deployment in detail"),
      limit: z.number().int().min(1).max(50).optional().describe("List size, default 10"),
    },
    false,
    async ({ container, deployment_id, limit }) => {
      if (deployment_id) {
        return toJson(await api.get(`/api/mobile/deployments/${deployment_id}`));
      }
      if (!container) return "Pass container (for the history) or deployment_id (for one deployment).";
      const c = await resolveContainer(api, container);
      if (!c) return `No container "${container}". Call list_apps first.`;
      return toJson(await api.get(`/api/mobile/containers/${cid(c)}/deployments?limit=${limit ?? 10}`));
    }
  );

  tool(
    "check_quota",
    "Can the user deploy and run apps right now? Merges the deploy limit (5 per rolling 12h — ONLY for accounts without an Always-On/Sprint entitlement; failed attempts count) and the free-hours cap (containers refuse to start at 402 when exhausted), plus any unassigned Always-On subscriptions.",
    {},
    false,
    async () => {
      const boot = await api.get("/api/mobile/bootstrap");
      const cap = await api.get("/api/mobile/deploy-cap").catch(() => boot.deployCap);
      let spares: any[] = [];
      try {
        const u = await api.get("/api/mobile/services/always-on/unassigned");
        spares = u?.subscriptions ?? u ?? [];
      } catch {
        /* non-fatal */
      }
      const usage = boot.usage ?? {};
      const lines = [
        `Plan: ${planLine(boot)}`,
        capLine(cap),
        usage.hoursLimit === -1
          ? "Free-hours cap: none (paid entitlement active)."
          : `Free hours: ${usage.hoursUsed?.toFixed?.(1) ?? usage.hoursUsed} used of ${usage.hoursLimit} (${usage.remainingHours?.toFixed?.(1) ?? usage.remainingHours} left).${usage.message ? " " + usage.message : ""}`,
        Array.isArray(spares) && spares.length > 0
          ? `Unassigned Always-On subscriptions: ${JSON.stringify(redact(spares))} — assign_always_on can attach one to a container.`
          : "",
        "When the deploy limit is hit, deploys return 429 with a $1 Sprint Pack link. When free hours run out, containers refuse to start with 402 and an Always-On link. Relay those messages; never retry past them.",
      ];
      return lines.filter(Boolean).join("\n");
    }
  );

  tool(
    "list_repos",
    "List (or search) the GitHub repositories connected to this SnapDeploy account. If GitHub is not connected yet, returns the connect link for the user.",
    {
      query: z.string().optional().describe("Search text; omit to list"),
      page: z.number().int().min(1).optional(),
    },
    false,
    async ({ query, page }) => {
      try {
        const path = query
          ? `/api/mobile/github/repos/search?q=${encodeURIComponent(query)}`
          : `/api/mobile/github/repos?page=${page ?? 1}&perPage=30`;
        return toJson(await api.get(path));
      } catch (e) {
        if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
          const st = await api.get("/api/mobile/github/status").catch(() => null);
          if (st && st.connected === false) {
            const cu = await api.get("/api/mobile/github/connect-url").catch(() => null);
            const url = cu?.url ?? cu?.connectUrl ?? api.absolute("/settings");
            return `GitHub is not connected to this SnapDeploy account. Ask the user to connect it in a browser: ${url}`;
          }
        }
        throw e;
      }
    }
  );

  tool(
    "detect_env_vars",
    "Scan a repo for the environment variables it needs (import.meta.env / process.env usage). For known keys (Supabase etc.) the reply says where the user finds the value. Do this BEFORE the first deploy of a Lovable/Bolt/v0 export.",
    {
      repo: z.string().describe("owner/name"),
      branch: z.string().optional(),
    },
    false,
    async ({ repo, branch }) => {
      const [owner, name] = repo.split("/");
      if (!owner || !name) return 'repo must be "owner/name".';
      const q = branch ? `?branch=${encodeURIComponent(branch)}` : "";
      return toJson(await api.get(`/api/mobile/github/repos/${owner}/${name}/detect-env-vars${q}`));
    }
  );

  // ---------- write tools ----------

  tool(
    "deploy",
    "Deploy a connected GitHub repo to SnapDeploy: creates the container if needed, links the repo, builds, and waits for the result. Reply includes the live URL or, on failure, the error and build-log tail. On accounts without an Always-On/Sprint entitlement this uses one unit of the deploy limit (failed attempts count); Always-On accounts are uncapped.",
    {
      repo: z.string().describe("owner/name of a repo on the user's connected GitHub"),
      container: z.string().optional().describe("Container name (default: repo name, lowercased)"),
      branch: z.string().optional().describe("Branch to deploy (default: repo default branch)"),
      env: z.record(z.string()).optional().describe("Environment variables to set before building (VITE_*/public-prefixed ones are applied at build time)"),
      port: z.number().int().optional().describe("App port if auto-detection needs an override"),
    },
    true,
    async ({ repo, container, branch, env, port }) => {
      const [owner, name] = repo.split("/");
      if (!owner || !name) return 'repo must be "owner/name".';

      const boot = await api.get("/api/mobile/bootstrap");
      const cap = boot.deployCap;
      if (cap?.capped && cap.remaining <= 0) {
        return `Deploy limit already used up (${cap.dailyLimit} per rolling 12h; failed attempts count). A $1 Sprint Pack lifts it for 24h: ${api.absolute("/store?buy=sd_sprint_pack")} — or Always-On removes it. Not deploying.`;
      }

      const st = await api.get("/api/mobile/github/status").catch(() => null);
      if (st && st.connected === false) {
        const cu = await api.get("/api/mobile/github/connect-url").catch(() => null);
        return `GitHub is not connected yet. Ask the user to connect it in a browser first: ${cu?.url ?? cu?.connectUrl ?? api.absolute("/settings")}`;
      }

      const wanted = (container ?? name).toLowerCase();
      let existing = (boot.containers ?? []).find(
        (c: any) => (c.name ?? "").toLowerCase() === wanted || cid(c) === container
      );

      let deploymentId: string | undefined;
      let containerId: string;

      if (existing) {
        containerId = cid(existing);
        if (env && Object.keys(env).length > 0) {
          await api.put(`/api/mobile/containers/${containerId}/env`, { environmentVariables: env });
        }
        const link = await api
          .get(`/api/mobile/github/link/container/${containerId}`)
          .catch(() => null);
        const linkId = link?.repoLinkId ?? link?.id ?? link?.linkId;
        if (linkId) {
          const trig = await api.post(`/api/mobile/github/link/${linkId}/deploy`);
          deploymentId = trig?.deploymentId;
        } else {
          const linked = await api.post(`/api/mobile/github/link`, {
            containerId,
            repoFullName: repo,
            deployBranch: branch,
            port,
          });
          deploymentId = linked?.deploymentId;
        }
      } else {
        const created = await api.post(`/api/mobile/containers`, {
          name: wanted,
          image: "pending", // GitHub-deploy placeholder — the build supplies the real image
          port,
          environmentVariables: env,
        });
        containerId = created.containerId ?? created.id;
        const linked = await api.post(`/api/mobile/github/link`, {
          containerId,
          repoFullName: repo,
          deployBranch: branch,
          port,
        });
        deploymentId = linked?.deploymentId; // /link triggers the initial build itself
      }

      // Linking triggers the initial build itself; find the deployment to watch.
      for (let i = 0; !deploymentId && i < 6; i++) {
        await sleep(3000);
        const list = await api
          .get(`/api/mobile/containers/${containerId}/deployments?limit=1`)
          .catch(() => null);
        const latest = Array.isArray(list) ? list[0] : list?.deployments?.[0] ?? list?.[0];
        deploymentId = latest?.deploymentId;
      }
      if (!deploymentId) {
        return `Build was triggered for ${repo} on container ${wanted}, but no deployment record appeared yet. Call get_deployments with container "${wanted}" in ~30s.`;
      }

      // Poll to a terminal state (builds usually take 2–6 minutes).
      const deadline = Date.now() + 7 * 60_000;
      let dep: any = null;
      while (Date.now() < deadline) {
        await sleep(5000);
        dep = await api.get(`/api/mobile/deployments/${deploymentId}`).catch(() => dep);
        const s = dep?.status;
        if (s && !["PENDING", "IN_PROGRESS"].includes(s)) break;
      }

      const capAfter = await api.get("/api/mobile/deploy-cap").catch(() => null);
      const status = dep?.status ?? "IN_PROGRESS";

      if (status === "COMPLETED") {
        const c = await api.get(`/api/mobile/containers/${containerId}`).catch(() => null);
        return [
          `Deployed. Live at: ${c?.url ?? "(fetch with get_status)"}`,
          capLine(capAfter),
          "Free plan note: the container sleeps after ~15 minutes idle — wake it with the wake tool, or Always-On keeps it running 24/7.",
        ]
          .filter(Boolean)
          .join("\n");
      }

      if (["FAILED", "CANCELLED", "ROLLED_BACK"].includes(status)) {
        const tail = (dep?.buildLogsTail ?? "").split("\n").slice(-40).join("\n");
        return [
          `Build ${status} for ${repo} (deployment ${deploymentId}).`,
          dep?.errorCode && `Error code: ${dep.errorCode}`,
          dep?.errorMessage && `Error: ${dep.errorMessage}`,
          tail && `Build log tail:\n${tail}`,
          capLine(capAfter),
          "You can fix the code and deploy again — but each attempt costs one deploy-limit unit, so diagnose before retrying.",
        ]
          .filter(Boolean)
          .join("\n");
      }

      return `Still building (deployment ${deploymentId}). Check with get_deployments deployment_id="${deploymentId}" — do not trigger another deploy meanwhile.`;
    }
  );

  tool(
    "set_env",
    "Set/replace a container's environment variables (rolling restart, no rebuild). Values are accepted but NEVER echoed back. Public build-time names (VITE_*, NEXT_PUBLIC_*, REACT_APP_*) only take effect in the bundle after the next deploy.",
    {
      container: z.string().describe("Container name or id"),
      env: z.record(z.string()).describe("Full desired map of env vars"),
    },
    true,
    async ({ container, env }) => {
      const c = await resolveContainer(api, container);
      if (!c) return `No container "${container}". Call list_apps first.`;
      const res = await api.put(`/api/mobile/containers/${cid(c)}/env`, { environmentVariables: env });
      const names = Object.keys(env).join(", ");
      const publicish = Object.keys(env).filter((k) => /^(VITE_|NEXT_PUBLIC_|REACT_APP_|PUBLIC_|EXPO_PUBLIC_|NUXT_PUBLIC_)/.test(k));
      return [
        `Set ${Object.keys(env).length} variable(s): ${names}`,
        res?.rollingRestart ? "A rolling restart is applying them to the running container." : "",
        publicish.length > 0
          ? `Note: ${publicish.join(", ")} are BUILD-time variables — run the deploy tool again so they reach the compiled bundle.`
          : "",
      ]
        .filter(Boolean)
        .join("\n");
    }
  );

  const simpleAction = (verb: "start" | "stop" | "wake", desc: string) =>
    tool(
      `${verb}_container`,
      desc,
      { container: z.string().describe("Container name or id") },
      true,
      async ({ container }: { container: string }) => {
        const c = await resolveContainer(api, container);
        if (!c) return `No container "${container}". Call list_apps first.`;
        const res = await api.post(`/api/mobile/containers/${cid(c)}/${verb}`);
        return `${verb} accepted for ${c.name}.\n${toJson(res)}`;
      }
    );
  simpleAction("start", "Start a stopped container. May answer 402 when free hours are exhausted — relay that message and link, do not retry.");
  simpleAction("stop", "Stop a running container (safe, reversible — deletion is NOT possible through this connector by design).");
  simpleAction("wake", "Wake a sleeping free-plan container so its URL serves again.");

  tool(
    "create_database",
    "Create a managed add-on: PostgreSQL, MySQL, MariaDB, MongoDB, Redis or RabbitMQ. Requires a purchased add-on subscription — without one this returns the purchase link (relay it, don't retry). Credentials are provisioned server-side and shown to the user in the SnapDeploy UI, never through this connector.",
    {
      type: z.enum(["POSTGRESQL", "MYSQL", "MARIADB", "MONGODB", "REDIS", "RABBITMQ"]),
      name: z.string().optional().describe("Add-on name"),
      container: z.string().optional().describe("Container to link it to (name or id)"),
      database_name: z.string().optional(),
    },
    true,
    async ({ type, name, container, database_name }) => {
      let linkedContainerId: string | undefined;
      if (container) {
        const c = await resolveContainer(api, container);
        if (!c) return `No container "${container}". Call list_apps first.`;
        linkedContainerId = cid(c);
      }
      const res = await api.post(`/api/mobile/services/addons`, {
        type,
        name,
        linkedContainerId,
        databaseName: database_name,
      });
      return (
        toJson(res) +
        "\nConnection credentials are NOT exposed here — the user finds them in SnapDeploy → Services → this add-on, and linked containers receive them as env vars automatically."
      );
    }
  );

  tool(
    "add_domain",
    "Attach a custom domain to a container. Returns the DNS records the user must create; verification then runs from the SnapDeploy UI.",
    {
      domain: z.string().describe("e.g. app.example.com"),
      container: z.string().describe("Container name or id"),
    },
    true,
    async ({ domain, container }) => {
      const c = await resolveContainer(api, container);
      if (!c) return `No container "${container}". Call list_apps first.`;
      const res = await api.post(`/api/mobile/services/domains`, { domain, containerId: cid(c) });
      const domainId = res?.domainId ?? res?.id;
      let dns: any = null;
      if (domainId) {
        dns = await api.get(`/api/mobile/services/domains/${domainId}/dns-records`).catch(() => null);
      }
      return [
        toJson(res),
        dns ? `DNS records to create:\n${toJson(dns)}` : "",
        "After the user adds these DNS records, they verify the domain in SnapDeploy → Domains (propagation can take a few minutes).",
      ]
        .filter(Boolean)
        .join("\n");
    }
  );

  tool(
    "assign_always_on",
    "Attach an UNASSIGNED Always-On subscription to a container (keeps it running 24/7 and lifts the deploy limit). Only call this after the user explicitly confirms — check_quota lists any unassigned subscriptions.",
    {
      subscription_id: z.string().describe("From check_quota or a 402 reply's spareSubscriptionId"),
      container: z.string().describe("Container name or id"),
    },
    true,
    async ({ subscription_id, container }) => {
      const c = await resolveContainer(api, container);
      if (!c) return `No container "${container}". Call list_apps first.`;
      const res = await api.post(`/api/mobile/services/always-on/assign`, {
        subscriptionId: subscription_id,
        containerId: cid(c),
      });
      return toJson(res);
    }
  );
}
