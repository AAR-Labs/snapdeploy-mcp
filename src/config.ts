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
  // Production by default (D4, 24 Sep 2026). SNAPDEPLOY_BASE_URL overrides for the
  // dev environment or self-testing.
  const baseUrl = (process.env.SNAPDEPLOY_BASE_URL ?? "https://snapdeploy.dev").replace(/\/+$/, "");
  const ro = process.env.SNAPDEPLOY_READ_ONLY ?? "";
  return { apiKey, baseUrl, readOnly: ro === "1" || /^true$/i.test(ro) };
}
