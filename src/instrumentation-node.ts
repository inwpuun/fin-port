import { setDefaultAutoSelectFamilyAttemptTimeout } from "node:net";

// See instrumentation.ts for why: 250 ms per address is shorter than a cold
// IPv4 handshake from the Pi to Yahoo.
setDefaultAutoSelectFamilyAttemptTimeout(2500);
