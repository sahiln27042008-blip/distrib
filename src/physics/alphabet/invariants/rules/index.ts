export { evaluateChannelCascade, channelCascadeRule } from "./channel-cascade.ts";
export { evaluateCostBurn, costBurnRule } from "./cost-burn.ts";
export { evaluateLeaseEpochExpired, leaseEpochExpiredRule } from "./lease-epoch-expired.ts";
export { evaluateLeasePanicCrash, leasePanicCrashRule } from "./lease-panic-crash.ts";
export { evaluateLeaseRejected, leaseRejectedRule } from "./lease-rejected.ts";
export { evaluateNetworkIdempotency, networkIdempotencyRule } from "./network-idempotency.ts";

import { channelCascadeRule } from "./channel-cascade.ts";
import { costBurnRule } from "./cost-burn.ts";
import { leaseEpochExpiredRule } from "./lease-epoch-expired.ts";
import { leasePanicCrashRule } from "./lease-panic-crash.ts";
import { leaseRejectedRule } from "./lease-rejected.ts";
import { networkIdempotencyRule } from "./network-idempotency.ts";
import type { NativeRule } from "../types.ts";

export const ALL_NATIVE_RULES: NativeRule[] = [
  leasePanicCrashRule,
  leaseEpochExpiredRule,
  channelCascadeRule,
  costBurnRule,
  leaseRejectedRule,
  networkIdempotencyRule,
];