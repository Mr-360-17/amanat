// Polling hooks (gentle on the RPC) + a hook for sending wallet txs with progress.
import { useCallback, useEffect, useRef, useState } from "react";
import { ethers } from "ethers";
import { ABI, API_URL, AGENT_POLL_MS, CONTRACT_ADDRESS, STATUS_POLL_MS, txUrl } from "../config";
import { explainError, fetchStatus, legacyOverrides, type VaultStatus } from "./vault";
import { useWallet } from "./wallet";

/** Vault status, refreshed every STATUS_POLL_MS. `refresh()` forces a reload (e.g. after a tx). */
export function useVaultStatus() {
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [chainTime, setChainTime] = useState(0);
  const [fetchedAt, setFetchedAt] = useState(0);
  const [block, setBlock] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetchStatus();
      setStatus(r.status);
      setChainTime(r.chainTime);
      setBlock(r.block);
      setFetchedAt(Date.now());
      setError(null);
    } catch (e: any) {
      setError(e?.shortMessage || e?.message || "Could not read the vault");
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, STATUS_POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  // Chain time ticking locally every second between polls (for smooth countdowns)
  const now = useTicker(chainTime, fetchedAt);
  return { status, now, block, error, refresh };
}

function useTicker(chainTime: number, fetchedAt: number) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
  if (!chainTime) return 0;
  return chainTime + Math.floor((Date.now() - fetchedAt) / 1000);
}

export interface AgentStatus {
  status: "ONLINE" | "OFFLINE";
  secondsSinceLastCheck: number | null;
  nextCheckMs?: number;
  network?: string;
  chainId?: number;
  contract?: string;
  keeper?: string;
  keeperBalance?: string;
  txPending?: boolean;
  lastError?: string | null;
}

/** Keeper heartbeat from the API. Unreachable API = OFFLINE. */
export function useAgentStatus() {
  const [agent, setAgent] = useState<AgentStatus | null>(null);
  const [reachable, setReachable] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(`${API_URL}/agent/status`);
        const data = await res.json();
        if (alive) {
          setAgent(data);
          setReachable(true);
        }
      } catch {
        if (alive) setReachable(false);
      }
    };
    load();
    const id = setInterval(load, AGENT_POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const online = reachable && agent?.status === "ONLINE";
  return { agent, online, reachable };
}

export type TxPhase = "idle" | "wallet" | "confirming" | "confirmed" | "failed";
export interface TxState {
  phase: TxPhase;
  label: string;
  hash?: string;
  explorerUrl?: string | null;
  block?: number;
  error?: string;
}

/**
 * Send a vault tx from the connected wallet and track it:
 * wallet (approve) -> confirming (submitted, have hash, waiting for block) -> confirmed / failed.
 * The UI shows this as Submitted -> Confirming -> Confirmed.
 */
export function useTx(onConfirmed?: () => void) {
  const { getSigner } = useWallet();
  const [tx, setTx] = useState<TxState>({ phase: "idle", label: "" });
  const busy = tx.phase === "wallet" || tx.phase === "confirming";
  const onConfirmedRef = useRef(onConfirmed);
  onConfirmedRef.current = onConfirmed;

  const run = useCallback(
    async (label: string, send: (vault: ethers.Contract, overrides: object) => Promise<ethers.TransactionResponse>) => {
      setTx({ phase: "wallet", label });
      try {
        const signer = await getSigner();
        const vault = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);
        const sent = await send(vault, await legacyOverrides());
        // Submitted (we have a hash) and now confirming (waiting for the block)
        const base = { label, hash: sent.hash, explorerUrl: txUrl(sent.hash) };
        setTx({ phase: "confirming", ...base });
        const receipt = await sent.wait();
        if (receipt?.status === 1) {
          setTx({ phase: "confirmed", ...base, block: receipt.blockNumber });
          onConfirmedRef.current?.();
        } else {
          setTx({ phase: "failed", ...base, error: "Transaction reverted" });
        }
      } catch (e: any) {
        setTx((prev) => ({ ...prev, phase: "failed", error: explainError(e) }));
      }
    },
    [getSigner]
  );

  return { tx, busy, run };
}
