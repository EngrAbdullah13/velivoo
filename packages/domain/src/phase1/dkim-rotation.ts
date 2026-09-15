import {
  DKIM_ROTATION_GRACE_MS,
  STATIC_DKIM_SELECTOR_PRIMARY,
  STATIC_DKIM_SELECTOR_STANDBY,
  type DkimRotationState,
  type StaticDkimSelector,
  isStaticDkimSelector,
  oppositeStaticSelector,
} from "./static-branded-dns.js";

export interface StaticDkimKeyMaterial {
  selector: StaticDkimSelector;
  publicKeyTxt: string;
  privateKeySecretRef: string;
}

export interface StaticDkimRotationSnapshot {
  activeSelector: StaticDkimSelector;
  standbySelector: StaticDkimSelector;
  rotationState: DkimRotationState;
  rotationGraceUntil?: Date | null;
  active: StaticDkimKeyMaterial;
  standby: StaticDkimKeyMaterial;
}

export function normalizeStaticSelectors(input: {
  activeSelector?: string | null;
  standbySelector?: string | null;
}): { activeSelector: StaticDkimSelector; standbySelector: StaticDkimSelector } {
  const active = isStaticDkimSelector(String(input.activeSelector ?? ""))
    ? (input.activeSelector as StaticDkimSelector)
    : STATIC_DKIM_SELECTOR_PRIMARY;
  const standby = isStaticDkimSelector(String(input.standbySelector ?? ""))
    ? (input.standbySelector as StaticDkimSelector)
    : oppositeStaticSelector(active);
  if (active === standby) return { activeSelector: STATIC_DKIM_SELECTOR_PRIMARY, standbySelector: STATIC_DKIM_SELECTOR_STANDBY };
  return { activeSelector: active, standbySelector: standby };
}

export function rotationGraceExpired(graceUntil?: Date | null, now = new Date()) {
  return Boolean(graceUntil && graceUntil.getTime() <= now.getTime());
}

export function canSwitchToStandby(input: {
  rotationState: DkimRotationState;
  standbyVerified: boolean;
  graceUntil?: Date | null;
  now?: Date;
}) {
  if (!input.standbyVerified) return false;
  if (input.rotationState === "switching") return true;
  if (input.rotationState === "grace_period" && !rotationGraceExpired(input.graceUntil, input.now)) return false;
  return input.rotationState === "stable" || input.rotationState === "standby_verifying";
}

export function afterSelectorSwitch(previousActive: StaticDkimSelector, now = new Date()) {
  return {
    activeSelector: oppositeStaticSelector(previousActive) as StaticDkimSelector,
    standbySelector: previousActive,
    rotationState: "grace_period" as const,
    rotationGraceUntil: new Date(now.getTime() + DKIM_ROTATION_GRACE_MS),
  };
}

export function afterGraceRetire(previousStandby: StaticDkimSelector) {
  return {
    rotationState: "stable" as const,
    rotationGraceUntil: null as Date | null,
    retiredSelector: previousStandby,
  };
}
