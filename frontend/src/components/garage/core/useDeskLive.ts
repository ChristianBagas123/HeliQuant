"use client";

/**
 * Live per-desk data for the inspect panel, read from the firm's engine (same base URL as the rest
 * of the live floor): /desks (reliability weight, samples, align rate), /agents (on-chain identity
 * and reputation), /decisions (the PM's latest calls) and /status (cycle count). Polls while the
 * section is on screen. Fails soft: a missing field stays null and the panel says so.
 */

import { useEffect, useState } from "react";

import { getEngineUrl } from "@/lib/engine";
import { fetchDecisions, fetchStatus, type Decision, type OrgStatus } from "@/lib/live";

export type DeskDetail = { weight: number; samples: number; align_rate: number | null };
export type Reputation = { credentials?: number; total_jobs?: number; successful_jobs?: number; cum_pnl_usd?: number; win_rate_bps?: number };
export type Agent = { name: string; kind?: string; tokenId?: string; ml?: boolean; account?: string; weight?: number | null; reputation?: Reputation | null };

export type DeskLive = {
  desks: { names: string[]; detail: Record<string, DeskDetail>; bounds: [number, number] | null; minSamples: number | null } | null;
  agents: { list: Agent[]; network: string | null; explorer: string | null } | null;
  decisions: Decision[] | null;
  status: OrgStatus | null;
  /** epoch ms of the last successful pull */
  at: number | null;
  reached: boolean | null;
};

const POLL_MS = 30000;

async function getJSON<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(`${getEngineUrl()}${path}?cb=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

type DesksRes = { desks?: string[]; detail?: Record<string, DeskDetail>; bounds?: [number, number]; min_samples?: number };
type AgentsRes = { agents?: Agent[]; network?: string; explorer?: string };

export function useDeskLive(active: boolean): DeskLive {
  const [data, setData] = useState<DeskLive>({ desks: null, agents: null, decisions: null, status: null, at: null, reached: null });

  useEffect(() => {
    if (!active) return;
    let alive = true;
    const pull = async () => {
      const [d, a, dec, s] = await Promise.all([getJSON<DesksRes>("/desks"), getJSON<AgentsRes>("/agents"), fetchDecisions(), fetchStatus()]);
      if (!alive) return;
      setData((prev) => ({
        desks: d?.desks ? { names: d.desks, detail: d.detail ?? {}, bounds: d.bounds ?? null, minSamples: d.min_samples ?? null } : prev.desks,
        agents: a?.agents ? { list: a.agents, network: a.network ?? null, explorer: a.explorer ?? null } : prev.agents,
        decisions: dec ?? prev.decisions,
        status: s ?? prev.status,
        at: d || a || dec || s ? Date.now() : prev.at,
        reached: Boolean(d || a || dec || s),
      }));
    };
    pull();
    const id = window.setInterval(pull, POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [active]);

  return data;
}
