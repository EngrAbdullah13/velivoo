import { CreateEmailIdentityCommand, DeleteEmailIdentityCommand, GetEmailIdentityCommand, SESv2Client } from "@aws-sdk/client-sesv2";
import type { DomainProviderContext, SenderDomainCheck, SenderDomainProvider, SenderDomainProvision } from "../../../application/src/ports/sender-domain-provider.js";
import type { ExpectedDnsRecord } from "../../../domain/src/phase1/dns.js";
import { NodeDnsResolver } from "../dns/node-dns-resolver.js";

type SesClient = Pick<SESv2Client, "send">;

function providerError(error: unknown, operation: "create" | "lookup" | "delete"): Error {
  const name = error && typeof error === "object" && "name" in error ? String((error as { name?: unknown }).name) : "";
  const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
  const message = error instanceof Error ? error.message : "";
  const status = error && typeof error === "object" && "$metadata" in error
    ? Number(((error as { $metadata?: { httpStatusCode?: unknown } }).$metadata?.httpStatusCode)) : undefined;
  if (name === "AccessDeniedException" || status === 403) return new Error("SES_ACCESS_DENIED");
  if (["UnrecognizedClientException", "InvalidClientTokenId", "SignatureDoesNotMatch", "CredentialsProviderError"].includes(name)) return new Error("SES_AUTHENTICATION_FAILED");
  if (["TooManyRequestsException", "ThrottlingException", "LimitExceededException"].includes(name) || status === 429) return new Error("SES_RATE_LIMITED");
  if (["ServiceUnavailableException", "TimeoutError", "NetworkingError"].includes(name) || ["EACCES", "ECONNREFUSED", "ECONNRESET", "ENETUNREACH", "ENOTFOUND", "ETIMEDOUT"].includes(code) || /^(connect|socket|network)\b/i.test(message) || [500, 502, 503, 504].includes(status ?? 0)) return new Error("SES_PROVIDER_UNAVAILABLE");
  return new Error(operation === "create" ? "SES_IDENTITY_CREATE_FAILED" : operation === "delete" ? "SES_IDENTITY_DELETE_FAILED" : "SES_IDENTITY_LOOKUP_FAILED");
}

function isIdentityMissing(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "name" in error && String((error as { name?: unknown }).name) === "NotFoundException");
}

function evidence(identity: any) {
  return {
    verifiedForSending: identity?.VerifiedForSendingStatus === true,
    dkimStatus: identity?.DkimAttributes?.Status ?? "PENDING",
    mailFromStatus: identity?.MailFromAttributes?.MailFromDomainStatus ?? "NOT_CONFIGURED",
  };
}

function records(domain: string, identity: any): ExpectedDnsRecord[] {
  const tokens = Array.isArray(identity?.DkimAttributes?.Tokens) ? identity.DkimAttributes.Tokens.filter((value: unknown): value is string => typeof value === "string" && value.length > 0) : [];
  return tokens.map((token: string) => ({ type: "CNAME" as const, host: `${token}._domainkey.${domain}`, value: `${token}.dkim.amazonses.com`, required: true }));
}

/** Server-only SES adapter. AWS uses the SDK default credential provider chain, including IAM roles. */
export class SesSenderDomainProvider implements SenderDomainProvider {
  readonly provider = "ses";
  private readonly client: SesClient;
  private readonly dns: NodeDnsResolver;

  constructor(readonly region: string, options: { client?: SesClient; dns?: NodeDnsResolver } = {}) {
    if (!region.trim()) throw new Error("SES_REGION_NOT_CONFIGURED");
    this.client = options.client ?? new SESv2Client({ region });
    this.dns = options.dns ?? new NodeDnsResolver();
  }

  private async get(domain: string): Promise<any> {
    try {
      return await this.client.send(new GetEmailIdentityCommand({ EmailIdentity: domain }));
    } catch (error) {
      throw error;
    }
  }

  async provision(context: DomainProviderContext): Promise<SenderDomainProvision> {
    const domain = context.domain;
    let identity: any;
    try {
      identity = await this.get(context.providerReference || domain);
    } catch (error) {
      if (!isIdentityMissing(error)) throw providerError(error, "lookup");
      try {
        await this.client.send(new CreateEmailIdentityCommand({ EmailIdentity: domain }));
      } catch (createError) {
        throw providerError(createError, "create");
      }
      try {
        identity = await this.get(domain);
      } catch (lookupError) {
        // SES can take a moment to surface DKIM tokens. Persist a genuine pending
        // provider identity and let Recheck obtain the real evidence later.
        if (!isIdentityMissing(lookupError)) throw providerError(lookupError, "lookup");
        identity = undefined;
      }
    }
    const state = evidence(identity);
    return {
      expectedRecords: records(domain, identity),
      providerReference: domain,
      providerRegion: this.region,
      providerStatus: state.verifiedForSending ? "verified" : "pending",
      providerEvidence: state,
      dkimStatus: state.dkimStatus,
      mailFromStatus: state.mailFromStatus,
    };
  }

  async check(context: DomainProviderContext, expectedRecords: ExpectedDnsRecord[]): Promise<SenderDomainCheck> {
    let identity: any;
    try {
      identity = await this.get(context.providerReference || context.domain);
    } catch (error) {
      throw providerError(error, "lookup");
    }
    const state = evidence(identity);
    const currentExpected = records(context.domain, identity);
    const recordsToCheck = currentExpected.length ? currentExpected : expectedRecords;
    const observedRecords = await this.dns.resolve(recordsToCheck);
    return {
      // SES is the authoritative verifier. The independent resolver below is
      // useful operational evidence, but resolver caches, split DNS, or DNS
      // provider behavior must not override a successful SES verification.
      status: state.verifiedForSending && state.dkimStatus === "SUCCESS" ? "verified" : "pending",
      observedRecords,
      providerStatus: state.verifiedForSending ? "verified" : "pending",
      providerEvidence: state,
      dkimStatus: state.dkimStatus,
      mailFromStatus: state.mailFromStatus,
    };
  }

  async remove(context: DomainProviderContext): Promise<void> {
    try {
      await this.client.send(new DeleteEmailIdentityCommand({ EmailIdentity: context.providerReference || context.domain }));
    } catch (error) {
      if (isIdentityMissing(error)) return;
      throw providerError(error, "delete");
    }
  }
}

/**
 * Server-side regional router for SES domain identities. The browser may select
 * only a platform allowlisted region; each domain remains pinned to that region.
 */
export class RegionalSesSenderDomainProvider implements SenderDomainProvider {
  readonly provider = "ses";
  private readonly providers = new Map<string, SesSenderDomainProvider>();
  readonly supportedRegions: readonly string[];

  constructor(readonly region: string, supportedRegions: readonly string[] = [region]) {
    if (!region.trim()) throw new Error("SES_REGION_NOT_CONFIGURED");
    this.supportedRegions = [...new Set(supportedRegions.filter(Boolean))];
    if (!this.supportedRegions.includes(region)) this.supportedRegions = [region, ...this.supportedRegions];
  }

  private forRegion(requested?: string | null): SesSenderDomainProvider {
    const selected = requested?.trim() || this.region;
    if (!this.supportedRegions.includes(selected)) throw new Error("SES_REGION_NOT_SUPPORTED");
    let provider = this.providers.get(selected);
    if (!provider) {
      provider = new SesSenderDomainProvider(selected);
      this.providers.set(selected, provider);
    }
    return provider;
  }

  /** Existing identities are pinned in trusted server persistence. They remain
   * manageable even if an operator later narrows the new-domain allowlist. */
  private forExistingRegion(requested?: string | null): SesSenderDomainProvider {
    const selected = requested?.trim() || this.region;
    let provider = this.providers.get(selected);
    if (!provider) {
      provider = new SesSenderDomainProvider(selected);
      this.providers.set(selected, provider);
    }
    return provider;
  }

  provision(context: DomainProviderContext): Promise<SenderDomainProvision> {
    return this.forRegion(context.providerRegion).provision(context);
  }

  check(context: DomainProviderContext, expectedRecords: ExpectedDnsRecord[]): Promise<SenderDomainCheck> {
    return this.forExistingRegion(context.providerRegion).check(context, expectedRecords);
  }

  remove(context: DomainProviderContext): Promise<void> {
    return this.forExistingRegion(context.providerRegion).remove(context);
  }
}
