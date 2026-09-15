import { randomUUID } from "node:crypto";
import type { EmailDeliveryProvider, ProviderLookupResult, ProviderSubmitInput, ProviderSubmitResult } from "../../../application/src/ports/email-delivery-provider.js";

export class FakeEmailProvider implements EmailDeliveryProvider {
  readonly name = "fake-ses";
  submitCalls = 0;
  private accepted = new Map<string,string>();
  mode: "success" | "accept-then-unknown" | "fail" = "success";

  async submit(input: ProviderSubmitInput): Promise<ProviderSubmitResult> {
    this.submitCalls += 1;
    if (this.mode === "fail") return { status: "failed", code: "PROVIDER_REJECTED", retryable: false };
    const providerMessageId = `ses-proof-${randomUUID()}`;
    this.accepted.set(input.requestFingerprint, providerMessageId);
    if (this.mode === "accept-then-unknown") return { status: "unknown" };
    return { status: "submitted", providerMessageId };
  }
  async lookupSubmission(requestFingerprint: string): Promise<ProviderLookupResult> {
    const id = this.accepted.get(requestFingerprint);
    return id ? { status: "submitted", providerMessageId: id } : { status: "not_found" };
  }
}
