// Shared vault state definitions for the keeper AND the frontend.
// No imports on purpose, so this file can be copied into frontend/src as-is.

export enum VaultState {
  ACTIVE = 0,
  GRACE = 1,
  CONFIRMED = 2,
  RELEASED = 3,
}

export const STATE_NAMES = ["ACTIVE", "GRACE", "CONFIRMED", "RELEASED"] as const;

export const STATE_INFO: Record<VaultState, { name: string; label: string; color: string; meaning: string }> = {
  [VaultState.ACTIVE]: {
    name: "ACTIVE",
    label: "Protected",
    color: "#16a34a", // green
    meaning: "Owner is checking in. Nothing will be released.",
  },
  [VaultState.GRACE]: {
    name: "GRACE",
    label: "Grace period",
    color: "#d97706", // amber
    meaning: "Check-in was missed. The owner can still respond before contacts may confirm.",
  },
  [VaultState.CONFIRMED]: {
    name: "CONFIRMED",
    label: "Death confirmed",
    color: "#dc2626", // red
    meaning: "2 of 3 trusted contacts confirmed. Release after a short safety delay.",
  },
  [VaultState.RELEASED]: {
    name: "RELEASED",
    label: "Released",
    color: "#4b5563", // slate
    meaning: "The vault has been released to the beneficiaries.",
  },
};

/** Which state changes the contract allows (and who triggers them). */
export const ALLOWED_TRANSITIONS: { from: VaultState; to: VaultState; by: string }[] = [
  { from: VaultState.ACTIVE, to: VaultState.GRACE, by: "anyone (keeper) after the check-in deadline" },
  { from: VaultState.GRACE, to: VaultState.CONFIRMED, by: "2nd trusted-contact confirmation after grace" },
  { from: VaultState.CONFIRMED, to: VaultState.RELEASED, by: "anyone (keeper) after the release delay" },
  { from: VaultState.GRACE, to: VaultState.ACTIVE, by: "owner check-in or cancel" },
  { from: VaultState.CONFIRMED, to: VaultState.ACTIVE, by: "owner check-in or cancel" },
  { from: VaultState.RELEASED, to: VaultState.ACTIVE, by: "owner resetDemo (demo mode only)" },
];

export function canTransition(from: VaultState, to: VaultState): boolean {
  return ALLOWED_TRANSITIONS.some((t) => t.from === from && t.to === to);
}

/** Plain-number view of getStatus() (convert bigints with Number() before calling describe). */
export interface StatusLite {
  state: number;
  checkInDeadline: number;
  graceDeadline: number;
  releaseAvailableAt: number;
  confirmationCount: number;
}

/**
 * Human summary of the vault at chain time `now` (seconds).
 * Used by the keeper logs and by the UI status badge.
 */
export function describe(s: StatusLite, now: number) {
  const info = STATE_INFO[s.state as VaultState];
  let headline = "";
  let nextAction = "";
  let secondsLeft: number | null = null;

  switch (s.state) {
    case VaultState.ACTIVE:
      secondsLeft = s.checkInDeadline - now;
      if (secondsLeft >= 0) {
        headline = `Next check-in due in ${secondsLeft}s`;
        nextAction = "Owner checks in";
      } else {
        headline = `Check-in missed ${-secondsLeft}s ago`;
        nextAction = "Keeper starts grace period";
      }
      break;
    case VaultState.GRACE:
      secondsLeft = s.graceDeadline - now;
      if (secondsLeft >= 0) {
        headline = `Grace period: ${secondsLeft}s left for the owner to respond`;
        nextAction = "Owner checks in, or wait for grace to end";
      } else {
        headline = `Grace over - ${s.confirmationCount} of 2 confirmations`;
        nextAction = "Trusted contacts confirm";
      }
      break;
    case VaultState.CONFIRMED:
      secondsLeft = s.releaseAvailableAt - now;
      headline =
        secondsLeft > 0 ? `Release available in ${secondsLeft}s` : "Release available now";
      nextAction = secondsLeft > 0 ? "Owner can still cancel" : "Keeper releases the vault";
      break;
    case VaultState.RELEASED:
      headline = "Vault released";
      nextAction = "Nothing (demo: owner can reset)";
      break;
  }

  return { ...info, headline, nextAction, secondsLeft };
}
