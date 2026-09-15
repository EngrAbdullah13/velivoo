export interface ProviderSubmitInput { messageId: string; rawMime: string; requestFingerprint: string; configurationSetName?: string; providerRegion?: string; workspaceId?:string; senderDomainId?:string; routeId?:string; }
export type ProviderSubmitResult = { status: "submitted"; providerMessageId: string } | { status: "unknown" } | { status: "failed"; code: string; retryable: boolean };
export interface ProviderLookupResult { status: "submitted" | "not_found" | "unknown"; providerMessageId?: string; }
export interface EmailDeliveryProvider {
  readonly name: string;
  submit(input: ProviderSubmitInput): Promise<ProviderSubmitResult>;
  lookupSubmission(requestFingerprint: string): Promise<ProviderLookupResult>;
}
