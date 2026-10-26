// Preloaded by the tests into the built script (bun --preload): requests to the FxEmbed API go
// to the fake server named by MARKET_TEST_API instead, so a real process can be tested offline.

const base = process.env.MARKET_TEST_API;
if (base) {
  const real = globalThis.fetch;
  const redirected = (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
      .replace("https://api.fxtwitter.com", `${base}/x`)
      .replace("https://api.fxbsky.app", `${base}/bluesky`);
    return real(url, init);
  };
  globalThis.fetch = Object.assign(redirected, { preconnect: real.preconnect }) as typeof fetch;
}
