/**
 * /jobs/new → /hire
 *
 * The old static "hire" mockup lived here (disabled form). The REAL on-chain
 * deposit product (faucet → hire → dashboard → settle / claim) ships at /hire; /app is
 * now the live trading floor. One canonical surface each, no stale duplicate.
 */

import { redirect } from "next/navigation";

export default function NewJobPage() {
  redirect("/hire");
}
