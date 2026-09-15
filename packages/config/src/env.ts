import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadLocalEnv(): void {
  for (const file of [resolve(".env.local"), resolve(".env")]) {
    if (!existsSync(file)) continue;
    for (const rawLine of readFileSync(file, "utf8").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("\'") && value.endsWith("\'"))) value = value.slice(1, -1);
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}

loadLocalEnv();

type Env = Record<string, string | undefined>;

export type EmailPlatformRuntimeMode = "development" | "proof" | "production";
export type EmailProviderName = "ses" | "disabled";

export function parseBoolean(value: string | undefined, fallback = false): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  return value.trim().toLowerCase() === "true";
}

function int(name: string, fallback: number, env: Env = process.env): number {
  const raw = env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) throw new Error(`${name} must be a valid TCP port.`);
  return parsed;
}

function runtimeMode(value: string | undefined): EmailPlatformRuntimeMode {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return "proof";
  if (normalized === "development" || normalized === "proof" || normalized === "production") return normalized;
  throw new Error("EMAIL_PLATFORM_RUNTIME_MODE_INVALID");
}

export interface EmailPlatformConfig {
  emailProvider: EmailProviderName;
  runtimeMode: EmailPlatformRuntimeMode;
  emailSendEnabled: boolean;
  sesDomainSetupEnabled: boolean;
  sesTenantMappingEnabled: boolean;
  deliveryQueueEnabled: boolean;
  awsSesRegion?: string;
  sesSupportedRegions: string[];
  awsRegion?: string;
  hasExplicitAwsCredentials: boolean;
  credentialSource: "explicit_environment" | "default_provider_chain";
  sesConfigurationSet?: string;
  sesFromEmail?: string;
  dnsProvider:"route53"|"disabled";
  route53DnsEnabled:boolean;
  route53BrandedNsDomain?:string;
  route53DelegationSetId?:string;
  route53ExpectedNameservers:string[];
  route53VanityNsMapping:Array<{vanity:string;provider:string}>;
  sendingDomainPrefix:string;
  sesMailFromPrefix:string;
  trackingDomainPrefix:string;
  trackingDomainMode:"cloudfront_saas"|"platform"|"standard_staging_fallback";
  cloudFrontMultiTenantDistributionId?:string;
  cloudFrontConnectionGroupId?:string;
  trackingOriginDomain?:string;
  dmarcPolicy:string;
  dmarcRequired:boolean;
  velivooStaticDnsDomain?:string;
  velivooStaticDnsZoneId?:string;
  velivooStaticSendDnsDomain?:string;
  velivooStaticSendDnsZoneId?:string;
  velivooStaticSendRoutingTarget?:string;
  velivooDkimKeyEncryptionSecret?:string;
  staticBrandedDnsEnabled:boolean;
  staticBrandedDkimDeliveryMode:"cname"|"txt";
}

function names(value:string|undefined){return [...new Set((value??"").split(",").map(item=>item.trim().toLowerCase().replace(/\.$/,"")).filter(Boolean))]}
function vanityMapping(value:string|undefined):Array<{vanity:string;provider:string}>{
  if(!value?.trim())return [];
  try{const parsed=JSON.parse(value) as Record<string,string>|Array<{vanity:string;provider:string}>;return (Array.isArray(parsed)?parsed:Object.entries(parsed).map(([vanity,provider])=>({vanity,provider}))).map(item=>({vanity:item.vanity.trim().toLowerCase().replace(/\.$/,""),provider:item.provider.trim().toLowerCase().replace(/\.$/,"")})).filter(item=>item.vanity&&item.provider)}catch{return value.split(",").map(item=>item.split("=")).filter(parts=>parts.length===2).map(([vanity,provider])=>({vanity:vanity!.trim().toLowerCase().replace(/\.$/,""),provider:provider!.trim().toLowerCase().replace(/\.$/,"")}))}
}

/** Server-only email configuration. This module must never be imported by browser code. */
export function loadEmailPlatformConfig(env: Env = process.env): EmailPlatformConfig {
  const configuredProvider = env.EMAIL_PROVIDER?.trim().toLowerCase();
  const emailProvider: EmailProviderName = configuredProvider === "ses" ? "ses" : "disabled";
  const explicitKey = env.AWS_ACCESS_KEY_ID?.trim();
  const explicitSecret = env.AWS_SECRET_ACCESS_KEY?.trim();
  const awsSesRegion = env.AWS_SES_REGION?.trim() || env.AWS_REGION?.trim() || undefined;
  const sesSupportedRegions = [...new Set((env.EMAIL_PLATFORM_SES_SUPPORTED_REGIONS ?? "").split(",").map(value => value.trim()).filter(Boolean))];
  if (sesSupportedRegions.some(region => !/^[a-z0-9-]{3,64}$/i.test(region))) throw new Error("EMAIL_PLATFORM_SES_SUPPORTED_REGIONS_INVALID");
  if (awsSesRegion && !sesSupportedRegions.includes(awsSesRegion)) sesSupportedRegions.unshift(awsSesRegion);
  const mode = runtimeMode(env.EMAIL_PLATFORM_RUNTIME_MODE);
  const trackingModeRaw=env.TRACKING_DOMAIN_MODE?.trim().toLowerCase();
  const trackingDomainMode:EmailPlatformConfig["trackingDomainMode"]=trackingModeRaw==="cloudfront_saas"||trackingModeRaw==="standard_staging_fallback"||trackingModeRaw==="platform"?trackingModeRaw:(mode==="production"?"cloudfront_saas":"platform");
  return {
    emailProvider,
    runtimeMode: mode,
    emailSendEnabled: parseBoolean(env.EMAIL_PLATFORM_EMAIL_SEND_ENABLED),
    sesDomainSetupEnabled: parseBoolean(env.EMAIL_PLATFORM_SES_DOMAIN_SETUP_ENABLED),
    sesTenantMappingEnabled: parseBoolean(env.EMAIL_PLATFORM_SES_TENANT_MAPPING_ENABLED),
    deliveryQueueEnabled: parseBoolean(env.EMAIL_PLATFORM_DELIVERY_QUEUE_ENABLED, mode === "production"),
    awsSesRegion,
    sesSupportedRegions,
    awsRegion: awsSesRegion,
    hasExplicitAwsCredentials: Boolean(explicitKey && explicitSecret),
    credentialSource: explicitKey && explicitSecret ? "explicit_environment" : "default_provider_chain",
    sesConfigurationSet: env.SES_CONFIGURATION_SET?.trim() || undefined,
    sesFromEmail: env.SES_FROM_EMAIL?.trim() || undefined,
    dnsProvider:env.DNS_PROVIDER?.trim().toLowerCase()==="route53"?"route53":"disabled",
    route53DnsEnabled:parseBoolean(env.ROUTE53_DNS_ENABLED),
    route53BrandedNsDomain:env.ROUTE53_BRANDED_NS_DOMAIN?.trim()||undefined,
    route53DelegationSetId:env.ROUTE53_DELEGATION_SET_ID?.trim()||undefined,
    route53ExpectedNameservers:names(env.ROUTE53_EXPECTED_NAME_SERVERS),
    route53VanityNsMapping:vanityMapping(env.ROUTE53_VANITY_NS_MAPPING),
    sendingDomainPrefix:env.SENDING_DOMAIN_PREFIX?.trim()||"send",
    sesMailFromPrefix:env.SES_DEFAULT_MAIL_FROM_PREFIX?.trim()||"bounce",
    trackingDomainPrefix:env.TRACKING_DOMAIN_PREFIX?.trim()||"click",
    trackingDomainMode,
    cloudFrontMultiTenantDistributionId:env.CLOUDFRONT_MULTI_TENANT_DISTRIBUTION_ID?.trim()||undefined,
    cloudFrontConnectionGroupId:env.CLOUDFRONT_CONNECTION_GROUP_ID?.trim()||undefined,
    trackingOriginDomain:env.TRACKING_ORIGIN_DOMAIN?.trim()||undefined,
    dmarcPolicy:env.MANAGED_DMARC_POLICY?.trim()||"v=DMARC1; p=none",
    dmarcRequired:parseBoolean(env.MANAGED_DMARC_REQUIRED),
    velivooStaticDnsDomain:env.VELIVOO_STATIC_DNS_DOMAIN?.trim()||undefined,
    velivooStaticDnsZoneId:env.VELIVOO_STATIC_DNS_ZONE_ID?.trim()||undefined,
    velivooStaticSendDnsDomain:env.VELIVOO_STATIC_SEND_DNS_DOMAIN?.trim()||undefined,
    velivooStaticSendDnsZoneId:env.VELIVOO_STATIC_SEND_DNS_ZONE_ID?.trim()||undefined,
    velivooStaticSendRoutingTarget:env.VELIVOO_STATIC_SEND_ROUTING_TARGET?.trim()||env.TRACKING_ORIGIN_DOMAIN?.trim()||undefined,
    velivooDkimKeyEncryptionSecret:env.VELIVOO_DKIM_KEY_ENCRYPTION_SECRET?.trim()||undefined,
    staticBrandedDnsEnabled:parseBoolean(env.VELIVOO_STATIC_BRANDED_DNS_ENABLED),
    staticBrandedDkimDeliveryMode:env.VELIVOO_STATIC_DKIM_DELIVERY_MODE?.trim().toLowerCase()==="txt"?"txt":"cname",
  };
}

const email = loadEmailPlatformConfig();

export const config = {
  apiPort: int("EMAIL_PLATFORM_API_PORT", 4000),
  publicApiPort: int("EMAIL_PLATFORM_PUBLIC_API_PORT", 4001),
  storePath: resolve(process.env.EMAIL_PLATFORM_PHASE0_STORE_PATH ?? ".local/phase0-store.json"),
  queuePath: resolve(process.env.EMAIL_PLATFORM_PHASE0_QUEUE_PATH ?? ".local/phase0-queue.ndjson"),
  publicBaseUrl: process.env.EMAIL_PLATFORM_PUBLIC_BASE_URL ?? "http://localhost:4001",
  unsubscribeSecret: process.env.EMAIL_PLATFORM_UNSUBSCRIBE_SIGNING_SECRET ?? "phase0-local-only-secret-change-before-real-send-123456",
  ...email,
  // Legacy Phase 0 callers use this value; production domain provisioning uses
  // the explicit optional awsSesRegion above and fails clearly if it is absent.
  awsRegion: email.awsSesRegion ?? "us-east-1",
  phase0Recipient: process.env.EMAIL_PLATFORM_PHASE0_RECIPIENT || undefined,
  phase0DelayMs: Number(process.env.EMAIL_PLATFORM_PHASE0_DELAY_MS ?? "3000"),
  snsTopicArn: process.env.EMAIL_PLATFORM_SNS_TOPIC_ARN || undefined,
  databaseUrl: process.env.DATABASE_URL,
  redisUrl: process.env.REDIS_URL,
};
