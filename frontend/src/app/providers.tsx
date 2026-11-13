"use client";

import type { ReactNode } from "react";
import { NearProvider } from "near-connect-hooks";

import { NEAR_NETWORK } from "@/lib/contracts";

export function Providers({ children }: { children: ReactNode }) {
  return <NearProvider config={{ network: NEAR_NETWORK }}>{children}</NearProvider>;
}
