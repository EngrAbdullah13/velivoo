import type { EmailDeliveryProvider, ProviderLookupResult, ProviderSubmitInput, ProviderSubmitResult } from "../../application/src/ports/email-delivery-provider.js";

/**
 * Safe local/production fallback: sending is explicitly unavailable and no
 * provider acceptance, delivery, or feedback fact is fabricated.
 */
export class DisabledEmailProvider implements EmailDeliveryProvider {
  readonly name = "disabled";

  async submit(_input: ProviderSubmitInput): Promise<ProviderSubmitResult> {
    return { status: "failed", code: "EMAIL_SENDING_DISABLED", retryable: false };
  }

  async lookupSubmission(_requestFingerprint: string): Promise<ProviderLookupResult> {
    return { status: "not_found" };
  }
}
