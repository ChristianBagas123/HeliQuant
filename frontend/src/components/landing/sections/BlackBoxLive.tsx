"use client";

/**
 * THE BLACK BOX — the on-chain ledger as a flight recorder.
 *
 * The feed is LIVE from the firm's decision log (the engine's GET /decisions — every cycle's call, the
 * restraint included); the public Supabase table is the fallback when the engine cannot be reached.
 * Each seal dot stamps only when real rows actually arrive; if neither source answers the recorder says
 * so and stays still — no placeholder rows, no pretend activity. The anchor plaque is the deploy smoke
 * test (FIRST_ANCHOR in lib/heliquant.ts).
 */

import { useEffect, useState } from "react";

import { fetchDecisions as fetchEngineDecisions } from "@/lib/live";
import { fetchDecisions } from "@/lib/supabase";
import { nearblocksTx } from "@/lib/contracts";
import { FIRST_ANCHOR } from "@/lib/heliquant";

import { Magnetic, TiltPlate } from "../interactive";
import { Eyebrow, LineHeading, Odometer, vars } from "../primitives";

const ANCHOR = {
  block: FIRST_ANCHOR.block.toLocaleString("en-US"),
  tx: `${FIRST_ANCHOR.txHash.slice(0, 10)}…${FIRST_ANCHOR.txHash.slice(-8)}`,
  href: nearblocksTx(FIRST_ANCHOR.txHash),
};

function stanceColor(d: string) {
  if (d === "ENTER") return "text-chartreuse";
  if (d === "ABSTAIN") return "text-bone/80";
  return "text-signal2";
}

/** one lap-log row, whichever source it came from */
type Lap = { ts: string; ticker: string; decision: string; direction: string | null };
type Source = "engine" | "table";

/** the engine's decision log first (newest first, 9 rows), the public table only if the engine is unreachable */
async function readLaps(): Promise<{ rows: Lap[]; source: Source }> {
  const eng = await fetchEngineDecisions();
  if (eng && eng.length) {
    const rows = [...eng]
      .sort((a, b) => (a.utc < b.utc ? 1 : -1))
      .slice(0, 9)
      .map((d) => ({ ts: d.utc, ticker: d.asset, decision: d.decision, direction: d.direction ?? null }));
    return { rows, source: "engine" };
  }
  const tab = await fetchDecisions(9);
  return { rows: tab.map((d) => ({ ts: d.ts, ticker: d.ticker, decision: String(d.decision), direction: d.direction ?? null })), source: "table" };
}

export default function BlackBox() {
  const [rows, setRows] = useState<Lap[] | null>(null);
  const [source, setSource] = useState<Source>("engine");

  useEffect(() => {
    let alive = true;
    void readLaps().then((r) => {
      if (!alive) return;
      setRows(r.rows);
      setSource(r.source);
    });
    return () => {
      alive = false;
    };
  }, []);

  const live = rows !== null && rows.length > 0;
  const feed = live ? rows! : null;

  return (
    <section id="blackbox" data-scene="blackbox" data-loop className="relative bg-carbon px-6 py-24 sm:px-10">
      <div className="ld-content mx-auto max-w-[1280px] xl:px-4">
        <Eyebrow>VERIFIABILITY · NEAR · PUBLIC READ</Eyebrow>
        <LineHeading
          className="mt-4 max-w-3xl font-display font-extrabold uppercase leading-[0.9] text-bone"
          style={{ fontSize: "clamp(2.6rem, 5.6vw, 4.6rem)" }}
          lines={[
            <>
              The black box <span className="text-chartreuse">is public</span>
            </>,
          ]}
        />
        <p data-reveal="rise" className="mt-4 max-w-xl text-base leading-relaxed text-bone/65">
          Flight recorders survive the crash — that&apos;s the point. Every cycle&apos;s decision, even the restraint, lands in a public table and anchors to NEAR.
        </p>

        <div className="mt-12 grid gap-8 lg:grid-cols-[0.95fr_1.05fr]">
          {/* ── the anchor plaque ── */}
          <div data-reveal="rise">
            <TiltPlate shadow="var(--color-chartreuse)" className="flex h-full flex-col justify-between border-2 border-bone bg-pitch p-7">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.26em] text-steel">first anchor · proof-stone</p>
                <p className="mt-4 font-display text-6xl font-extrabold leading-none text-bone">
                  BLOCK
                  <br />
                  <Odometer value={ANCHOR.block} className="text-chartreuse" />
                </p>
                <p className="mt-5 font-mono text-sm tracking-wide text-bone/75">{ANCHOR.tx}</p>
                <p className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-steel">core.anchor · deploy smoke test · sealed on NEAR</p>
              </div>
              <div className="mt-8">
                <Magnetic>
                  <a href={ANCHOR.href} target="_blank" rel="noreferrer" data-cursor="press" data-cursor-label="verify" className="ld-press border-2 border-bone bg-chartreuse px-5 py-2.5 font-display text-base font-bold uppercase tracking-wide text-pitch">
                    Verify on NearBlocks ↗
                  </a>
                </Magnetic>
              </div>
            </TiltPlate>
          </div>

          {/* ── the lap log (live feed) ── */}
          <div data-reveal="rise" style={vars({ "--i": 1 })} data-cursor="inspect" className="border-2 border-bone/25 bg-pitch">
            <div className="flex items-center justify-between border-b-2 border-bone/15 px-5 py-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-steel">lap log · {source === "engine" ? "live decision log" : "decisions_hq"}</p>
              <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em]" aria-live="polite">
                <span className={`inline-block h-2 w-2 ${live ? "gr-spark bg-chartreuse" : "bg-steel"}`} />
                <span className={live ? "text-chartreuse" : "text-steel"}>{live ? "live" : "no data yet"}</span>
              </p>
            </div>

            <div className="divide-y divide-bone/10">
              {(feed ?? []).map((r, i) => (
                <div key={i} style={vars({ "--i": i })} className="ld-lap grid grid-cols-[1fr_auto_auto] items-baseline gap-4 px-5 py-3 sm:grid-cols-[auto_1fr_auto_auto]">
                  <span className="hidden font-mono text-[10px] uppercase tracking-[0.14em] text-steel sm:block">{String(r.ts).slice(0, 16).replace("T", " ")}</span>
                  <span className="font-mono text-[12px] uppercase tracking-[0.18em] text-bone/80">{r.ticker}USDT</span>
                  <span className={`font-display text-base font-bold uppercase tracking-wide ${stanceColor(String(r.decision))}`}>
                    {r.decision}
                    {r.direction && r.direction !== "NONE" ? ` · ${r.direction}` : ""}
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-chartreuse/80">
                    sealed{" "}
                    <span className="ld-seal" style={vars({ "--i": i })}>
                      ▮
                    </span>
                  </span>
                </div>
              ))}
            </div>

            <p className="border-t-2 border-bone/15 px-5 py-3 font-mono text-[10px] uppercase tracking-[0.18em] text-steel">
              {live ? (
                <>
                  {source === "engine" ? "reading the firm's decision log live — every call, the restraint included" : "reading the public table directly — no middleman"}
                  <span className="gr-blink text-chartreuse">_</span>
                </>
              ) : (
                <>live feed unreachable here — the anchor plaque is the documented record</>
              )}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
