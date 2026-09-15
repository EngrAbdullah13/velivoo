import {
  afterGraceRetire,
  afterSelectorSwitch,
  canSwitchToStandby,
  normalizeStaticSelectors,
  rotationGraceExpired,
  type StaticDkimKeyMaterial,
  type StaticDkimRotationSnapshot,
} from "../../../domain/src/phase1/dkim-rotation.js";
import {
  STATIC_DKIM_SELECTOR_PRIMARY,
  STATIC_DKIM_SELECTOR_STANDBY,
  type DkimRotationState,
  type StaticDkimSelector,
  oppositeStaticSelector,
} from "../../../domain/src/phase1/static-branded-dns.js";
import {
  decryptDkimPrivateKey,
  dkimPublicKeyDnsTxt,
  encryptDkimPrivateKey,
  generateDkimKeyPair,
} from "../../../domain/src/phase1/dkim-key.js";

export interface StaticDkimDomainKeys {
  activeSelector: StaticDkimSelector;
  standbySelector: StaticDkimSelector;
  rotationState: DkimRotationState;
  rotationGraceUntil?: Date | null;
  activePublicKey: string;
  activePrivateKeyRef: string;
  standbyPublicKey: string;
  standbyPrivateKeyRef: string;
}

export class StaticDkimRotationService {
  constructor(private readonly encryptionSecret: string) {}

  readKeys(domain: Record<string, unknown>): StaticDkimDomainKeys {
    const { activeSelector, standbySelector } = normalizeStaticSelectors({
      activeSelector: domain.dkimSelector as string | null | undefined,
      standbySelector: domain.dkimStandbySelector as string | null | undefined,
    });
    const rotationState = (domain.dkimRotationState as DkimRotationState | null | undefined) ?? "stable";
    return {
      activeSelector,
      standbySelector,
      rotationState,
      rotationGraceUntil: (domain.dkimRotationGraceUntil as Date | null | undefined) ?? null,
      activePublicKey: String(domain.dkimPublicKey ?? ""),
      activePrivateKeyRef: String(domain.dkimPrivateKeySecretRef ?? ""),
      standbyPublicKey: String(domain.dkimStandbyPublicKey ?? ""),
      standbyPrivateKeyRef: String(domain.dkimStandbyPrivateKeySecretRef ?? ""),
    };
  }

  snapshot(domain: Record<string, unknown>): StaticDkimRotationSnapshot {
    const keys = this.readKeys(domain);
    return {
      activeSelector: keys.activeSelector,
      standbySelector: keys.standbySelector,
      rotationState: keys.rotationState,
      rotationGraceUntil: keys.rotationGraceUntil,
      active: this.material(keys.activeSelector, keys.activePublicKey, keys.activePrivateKeyRef),
      standby: this.material(keys.standbySelector, keys.standbyPublicKey, keys.standbyPrivateKeyRef),
    };
  }

  ensureInitialDualKeys(domain: Record<string, unknown>) {
    const keys = this.readKeys(domain);
    const patch: Record<string, unknown> = {
      dkimSelector: keys.activeSelector,
      dkimStandbySelector: keys.standbySelector,
      dkimRotationState: keys.rotationState || "stable",
    };
    if (!keys.activePublicKey || !keys.activePrivateKeyRef) {
      const pair = generateDkimKeyPair();
      patch.dkimPublicKey = dkimPublicKeyDnsTxt(pair.publicKey);
      patch.dkimPrivateKeySecretRef = encryptDkimPrivateKey(pair.privateKey, this.encryptionSecret);
    }
    if (!keys.standbyPublicKey || !keys.standbyPrivateKeyRef) {
      const pair = generateDkimKeyPair();
      patch.dkimStandbyPublicKey = dkimPublicKeyDnsTxt(pair.publicKey);
      patch.dkimStandbyPrivateKeySecretRef = encryptDkimPrivateKey(pair.privateKey, this.encryptionSecret);
    }
    return patch;
  }

  initiateRotation(domain: Record<string, unknown>) {
    const keys = this.readKeys(domain);
    if (keys.rotationState !== "stable") throw new Error("DKIM_ROTATION_IN_PROGRESS");
    const pair = generateDkimKeyPair();
    return {
      dkimStandbyPublicKey: dkimPublicKeyDnsTxt(pair.publicKey),
      dkimStandbyPrivateKeySecretRef: encryptDkimPrivateKey(pair.privateKey, this.encryptionSecret),
      dkimRotationState: "standby_verifying" as const,
      dkimRotationGraceUntil: null,
    };
  }

  completeGracePeriod(domain: Record<string, unknown>, retiredSelector: StaticDkimSelector) {
    const keys = this.readKeys(domain);
    const pair = generateDkimKeyPair();
    const retired = afterGraceRetire(retiredSelector);
    const patch: Record<string, unknown> = {
      dkimRotationState: retired.rotationState,
      dkimRotationGraceUntil: retired.rotationGraceUntil,
    };
    if (retiredSelector === keys.standbySelector) {
      patch.dkimStandbyPublicKey = dkimPublicKeyDnsTxt(pair.publicKey);
      patch.dkimStandbyPrivateKeySecretRef = encryptDkimPrivateKey(pair.privateKey, this.encryptionSecret);
    } else {
      patch.dkimPublicKey = dkimPublicKeyDnsTxt(pair.publicKey);
      patch.dkimPrivateKeySecretRef = encryptDkimPrivateKey(pair.privateKey, this.encryptionSecret);
    }
    return patch;
  }

  afterSuccessfulSwitch(previousActive: StaticDkimSelector, now = new Date()) {
    const switched = afterSelectorSwitch(previousActive, now);
    return {
      dkimSelector: switched.activeSelector,
      dkimStandbySelector: switched.standbySelector,
      dkimRotationState: switched.rotationState,
      dkimRotationGraceUntil: switched.rotationGraceUntil,
    };
  }

  privateKey(ref: string) {
    return decryptDkimPrivateKey(ref, this.encryptionSecret);
  }

  activePrivateKey(domain: Record<string, unknown>) {
    return this.privateKey(this.readKeys(domain).activePrivateKeyRef);
  }

  standbyPrivateKey(domain: Record<string, unknown>) {
    return this.privateKey(this.readKeys(domain).standbyPrivateKeyRef);
  }

  canSwitch(rotationState: DkimRotationState, standbyVerified: boolean, graceUntil?: Date | null, now = new Date()) {
    return canSwitchToStandby({ rotationState, standbyVerified, graceUntil, now });
  }

  graceExpired(graceUntil?: Date | null, now = new Date()) {
    return rotationGraceExpired(graceUntil, now);
  }

  defaultSelectors() {
    return { activeSelector: STATIC_DKIM_SELECTOR_PRIMARY, standbySelector: STATIC_DKIM_SELECTOR_STANDBY };
  }

  opposite(selector: string) {
    return oppositeStaticSelector(selector);
  }

  private material(selector: StaticDkimSelector, publicKeyTxt: string, privateKeySecretRef: string): StaticDkimKeyMaterial {
    return { selector, publicKeyTxt, privateKeySecretRef: privateKeySecretRef };
  }
}
