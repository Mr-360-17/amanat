// Read-only chain access + helpers for sending txs from the connected wallet.
import { ethers } from "ethers";
import { ABI, CONTRACT_ADDRESS, NETWORK } from "../config";

// Read-only provider: works without any wallet. cacheTimeout -1 = always fresh data.
export const readProvider = new ethers.JsonRpcProvider(NETWORK.rpcUrl, NETWORK.chainId, {
  staticNetwork: true,
  cacheTimeout: -1,
});

export const readVault = new ethers.Contract(CONTRACT_ADDRESS, ABI, readProvider);
export const vaultInterface = readVault.interface;

/** getStatus() converted to plain numbers/strings for React. */
export interface VaultStatus {
  owner: string;
  keeper: string;
  state: number;
  checkInPeriod: number;
  gracePeriod: number;
  releaseDelay: number;
  lastCheckIn: number;
  checkInDeadline: number;
  graceDeadline: number;
  confirmedAt: number;
  releaseAvailableAt: number;
  trustedContacts: string[];
  confirmationCount: number;
  beneficiaries: string[];
  vaultHash: string;
  demoMode: boolean;
  round: number;
  confirmedBy: boolean[]; // per trusted contact, this round
  contactAccepted: boolean[]; // Trusted Circle: accepted the role on-chain
}

export async function fetchStatus(): Promise<{ status: VaultStatus; chainTime: number; block: number }> {
  const [s, block] = await Promise.all([readVault.getStatus(), readProvider.getBlock("latest")]);
  const contacts: string[] = [...s.trustedContacts];
  const confirmedBy: boolean[] = await Promise.all(
    contacts.map((c) => (c === ethers.ZeroAddress ? false : readVault.hasConfirmedThisRound(c)))
  );
  return {
    status: {
      owner: s.owner,
      keeper: s.keeper,
      state: Number(s.state),
      checkInPeriod: Number(s.checkInPeriod),
      gracePeriod: Number(s.gracePeriod),
      releaseDelay: Number(s.releaseDelay),
      lastCheckIn: Number(s.lastCheckIn),
      checkInDeadline: Number(s.checkInDeadline),
      graceDeadline: Number(s.graceDeadline),
      confirmedAt: Number(s.confirmedAt),
      releaseAvailableAt: Number(s.releaseAvailableAt),
      trustedContacts: contacts,
      confirmedBy,
      contactAccepted: [...s.contactAccepted],
      confirmationCount: Number(s.confirmationCount),
      beneficiaries: [...s.beneficiaries],
      vaultHash: s.vaultHash,
      demoMode: s.demoMode,
      round: Number(s.round),
    },
    chainTime: block!.timestamp,
    block: block!.number,
  };
}

/**
 * Legacy (type 0) tx settings, same as the scripts: MST reports baseFee 0 and
 * no EIP-1559 fee data, so we always send an explicit gasPrice.
 */
export async function legacyOverrides() {
  const fee = await readProvider.getFeeData();
  return { type: 0, gasPrice: fee.gasPrice ?? ethers.parseUnits("1", "gwei") };
}

/** Friendly error text: user rejection, contract custom error, or the raw message. */
export function explainError(e: any): string {
  if (e?.code === "ACTION_REJECTED" || e?.info?.error?.code === 4001) return "You rejected the request in your wallet.";
  const data = e?.data ?? e?.info?.error?.data ?? e?.error?.data;
  if (typeof data === "string" && data.length >= 10) {
    try {
      const parsed = vaultInterface.parseError(data);
      if (parsed) return ERROR_TEXT[parsed.name] ?? `Contract refused: ${parsed.name}`;
    } catch {
      /* not ours */
    }
  }
  if (e?.revert?.name) return ERROR_TEXT[e.revert.name] ?? `Contract refused: ${e.revert.name}`;
  return e?.shortMessage || e?.message || "Transaction failed";
}

const ERROR_TEXT: Record<string, string> = {
  NotOwner: "Only the vault owner can do this.",
  NotTrustedContact: "This wallet is not one of the 3 trusted contacts.",
  ContactNotAccepted: "Accept the trusted-contact role first.",
  InvalidState: "Not allowed in the vault's current state.",
  GraceNotOver: "The grace period has not ended yet.",
  AlreadyConfirmed: "This contact already confirmed in this round.",
  ReleaseDelayNotPassed: "The release safety delay has not passed yet.",
  NotDemoMode: "Reset is only available in demo mode.",
  DeadlineNotPassed: "The check-in deadline has not passed yet.",
};

export const short = (addr: string) => (addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "-");
export const sameAddr = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
