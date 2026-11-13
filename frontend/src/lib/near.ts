/**
 * Read-only NEAR helpers (JSON-RPC views, no wallet or login needed). Env and types live in contracts.ts.
 */

import {
  NEAR_CORE,
  NEAR_DEX,
  NEAR_DEX_POOL_ID,
  NEAR_RPC_URL,
  NEAR_TOKEN,
  type JobBalanceView,
  type JobView,
} from "./contracts";

// ───────────────────────────── read-only views over JSON-RPC ─────────────────────────────
function toBase64(json: unknown): string {
  const text = JSON.stringify(json ?? {});
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Call a view method. Throws on RPC error. Works without a wallet or login. */
export async function viewCall<T = unknown>(contractId: string, method: string, args: object = {}): Promise<T> {
  if (!NEAR_RPC_URL) throw new Error("NEXT_PUBLIC_NEAR_RPC_URL is not set");
  const res = await fetch(NEAR_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "hq",
      method: "query",
      params: {
        request_type: "call_function",
        finality: "optimistic",
        account_id: contractId,
        method_name: method,
        args_base64: toBase64(args),
      },
    }),
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  const j = (await res.json()) as { result?: { result?: number[]; error?: string }; error?: { message?: string; data?: string } };
  if (j.error) throw new Error(j.error.data || j.error.message || "RPC error");
  if (j.result?.error) throw new Error(j.result.error);
  const bytes = new Uint8Array(j.result?.result ?? []);
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

export const tokenBalance = async (account: string): Promise<bigint> =>
  BigInt(await viewCall<string>(NEAR_TOKEN, "ft_balance_of", { account_id: account }));

/** NEP-145: `null` when the account is not registered on the token. */
export const tokenRegistered = async (account: string): Promise<boolean> =>
  (await viewCall<unknown>(NEAR_TOKEN, "storage_balance_of", { account_id: account })) !== null;

export const jobsByClient = (client: string, limit = 50): Promise<JobView[]> =>
  viewCall<JobView[]>(NEAR_CORE, "jobs_by_client", { client, from_index: "0", limit });

export const jobBalance = (jobId: string): Promise<JobBalanceView> =>
  viewCall<JobBalanceView>(NEAR_CORE, "get_job_balance", { job_id: jobId });

export const claimableOf = async (account: string, token: string): Promise<bigint> =>
  BigInt(await viewCall<string>(NEAR_CORE, "claimable_of", { account_id: account, token }));

/** Rhea `get_return`: expected output for selling `amountIn` of `tokenIn` into `tokenOut` on `poolId`. */
export const dexReturn = async (poolId: number, tokenIn: string, amountIn: bigint, tokenOut: string): Promise<bigint> =>
  BigInt(
    await viewCall<string>(NEAR_DEX, "get_return", {
      pool_id: poolId,
      token_in: tokenIn,
      amount_in: amountIn.toString(),
      token_out: tokenOut,
    }),
  );

/** Last pool the job traded in (from the vault), falling back to the configured pool. */
export const defaultPoolId = (): number | undefined => NEAR_DEX_POOL_ID;
