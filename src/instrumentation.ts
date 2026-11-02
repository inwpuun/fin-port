/**
 * Runs once when the server starts.
 *
 * Node 20+ connects with "happy eyeballs": it tries each address Yahoo's DNS
 * returns and gives each attempt 250 ms before moving on. Docker's default
 * network has no IPv6, so every IPv6 address fails at once, and from the Pi a
 * cold IPv4 handshake to Yahoo measured ~290 ms -- so every attempt was cut
 * off and fetch() threw "fetch failed", which /api/market reported as a 502.
 * curl on the same host never saw it because it has no such cutoff.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // A separate module, so the Edge bundle of this file never sees node:net.
  await import("./instrumentation-node");
}
