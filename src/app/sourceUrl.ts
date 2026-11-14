const developmentProxyByHost: Record<string, string> = {
  'portal.amfiindia.com': '/__fundscope_source/amfi-portal',
  'www.amfiindia.com': '/__fundscope_source/amfi-www',
  'amfiindia.com': '/__fundscope_source/amfi-root',
  'api.mfapi.in': '/__fundscope_source/mfapi',
};

/** Routes public-source requests through Vite only for browser-based development. */
export function routePublicSourceUrl(url: string, isDevelopment: boolean, isTauri: boolean): string {
  if (!isDevelopment || isTauri || url.startsWith('/')) return url;

  try {
    const parsed = new URL(url);
    const proxyPrefix = developmentProxyByHost[parsed.hostname.toLowerCase()];
    if (!proxyPrefix) return url;
    return `${proxyPrefix}${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return url;
  }
}
