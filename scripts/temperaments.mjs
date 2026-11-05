/**
 * Offline temperaments for the 12 built-in profiles.
 *
 * These coefficients are teacher-policy knobs, not runtime config: the trainer
 * uses them to label synthetic run windows, and the resulting GRU weights are
 * what ships. Each set gives a profile a distinct reaction shape — how much an
 * outcome moves it, how strongly conflict and tool failures hurt, and how hard
 * the current mood is pulled back toward baseline.
 */
export const TEMPERAMENTS = {
  gentle: { vGain: 0.90, vConflict: 0.30, vError: 0.20, vPull: 0.90, aError: 0.40, aConflict: 0.30, aEffort: 0.30, aPull: 0.90, seed: 1101 },
  cold: { vGain: 0.40, vConflict: 0.15, vError: 0.10, vPull: 0.50, aError: 0.15, aConflict: 0.15, aEffort: 0.10, aPull: 0.50, seed: 1102 },
  passionate: { vGain: 1.50, vConflict: 0.50, vError: 0.40, vPull: 1.20, aError: 0.90, aConflict: 0.70, aEffort: 0.70, aPull: 1.10, seed: 1103 },
  joyful: { vGain: 1.30, vConflict: 0.25, vError: 0.15, vPull: 1.00, aError: 0.35, aConflict: 0.25, aEffort: 0.45, aPull: 0.80, seed: 1104 },
  sad: { vGain: 1.20, vConflict: 0.50, vError: 0.50, vPull: 0.55, aError: 0.30, aConflict: 0.35, aEffort: 0.20, aPull: 0.55, seed: 1105 },
  angry: { vGain: 1.40, vConflict: 0.95, vError: 0.85, vPull: 0.45, aError: 1.00, aConflict: 1.05, aEffort: 0.60, aPull: 0.45, seed: 1106 },
  anxious: { vGain: 0.95, vConflict: 0.60, vError: 0.70, vPull: 0.70, aError: 1.10, aConflict: 0.80, aEffort: 0.85, aPull: 0.70, seed: 1107 },
  calm: { vGain: 0.50, vConflict: 0.20, vError: 0.15, vPull: 1.20, aError: 0.20, aConflict: 0.20, aEffort: 0.20, aPull: 1.20, seed: 1108 },
  playful: { vGain: 1.10, vConflict: 0.20, vError: 0.15, vPull: 0.85, aError: 0.30, aConflict: 0.25, aEffort: 0.60, aPull: 0.75, seed: 1109 },
  tender: { vGain: 0.90, vConflict: 0.40, vError: 0.35, vPull: 0.85, aError: 0.35, aConflict: 0.35, aEffort: 0.25, aPull: 0.85, seed: 1110 },
  proud: { vGain: 1.20, vConflict: 0.60, vError: 0.40, vPull: 0.60, aError: 0.40, aConflict: 0.55, aEffort: 0.40, aPull: 0.60, seed: 1111 },
  curious: { vGain: 0.90, vConflict: 0.30, vError: 0.25, vPull: 0.80, aError: 0.45, aConflict: 0.30, aEffort: 0.70, aPull: 0.80, seed: 1112 },
}

export const PROFILE_IDS = Object.keys(TEMPERAMENTS)
