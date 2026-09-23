export interface Config {
  apiKey: string;
  baseUrl: string;
  readOnly: boolean;
}

export function loadConfig(): Config {
  const apiKey = process.env.SNAPDEPLOY_API_KEY;
  if (!apiKey) {
    console.error(
      "SNAPDEPLOY_API_KEY is not set. Find your key at " +
        "https://snapdeploy.dev/api-keys and add it to this server's env config."
    );
    process.exit(1);
  }
  // M0 containment: default to the dev environment until the prod go-ahead
  // (containment checklist item D4 flips this to https://snapdeploy.dev).
  const baseUrl = (process.env.SNAPDEPLOY_BASE_URL ?? "https://containers.somdip.dev").replace(/\/+$/, "");
  const ro = process.env.SNAPDEPLOY_READ_ONLY ?? "";
  return { apiKey, baseUrl, readOnly: ro === "1" || /^true$/i.test(ro) };
}
