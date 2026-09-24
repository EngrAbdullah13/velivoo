export const phasePorts = {
  phase1: Number(process.env.EMAIL_PLATFORM_PHASE1_API_PORT ?? 4101),
  phase2: Number(process.env.EMAIL_PLATFORM_PHASE2_API_PORT ?? 4102),
  phase3: Number(process.env.EMAIL_PLATFORM_PHASE3_API_PORT ?? 4103),
  phase4: Number(process.env.EMAIL_PLATFORM_PHASE4_API_PORT ?? 4104),
} as const;

export function phaseFor(path: string) {
  if (path.includes("/phase4/")) return phasePorts.phase4;
  if (/\/(segments|flows|events|event-schemas|api-keys|dead-letters|flow-runs)(\/|$)/.test(path)) return phasePorts.phase3;
  // These reports are composed by Phase 1, including recipient CSV exports.
  if (/\/analytics\/(dashboard|export|recipients)(\/|$)/.test(path)) return phasePorts.phase1;
  if (/\/deliverability(\/|$)/.test(path)) return phasePorts.phase1;
  if (/\/(content|emails|email-versions|messages|send-policy|holds|analytics)(\/|$)/.test(path)) return phasePorts.phase2;
  if (/^\/api\/v1\/public\/content-assets\//.test(path)) return phasePorts.phase2;
  return phasePorts.phase1;
}
