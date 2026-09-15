import test from "node:test";
import assert from "node:assert/strict";
import { CreateEmailIdentityCommand, DeleteEmailIdentityCommand, GetEmailIdentityCommand } from "@aws-sdk/client-sesv2";
import { loadEmailPlatformConfig, parseBoolean } from "../packages/config/src/env.js";
import { normalizeDomain } from "../packages/domain/src/phase1/dns.js";
import { RegionalSesSenderDomainProvider, SesSenderDomainProvider } from "../packages/provider-email/src/ses/ses-domain-provider.js";

test("SES configuration prefers AWS_SES_REGION and preserves IAM role credential mode", () => {
  const config = loadEmailPlatformConfig({
    EMAIL_PROVIDER: "ses",
    EMAIL_PLATFORM_RUNTIME_MODE: "production",
    EMAIL_PLATFORM_EMAIL_SEND_ENABLED: "true",
    EMAIL_PLATFORM_SES_DOMAIN_SETUP_ENABLED: "true",
    AWS_SES_REGION: "us-east-1",
    AWS_REGION: "eu-west-1",
    EMAIL_PLATFORM_SES_SUPPORTED_REGIONS: "us-east-1,eu-west-1",
  });
  assert.equal(config.emailProvider, "ses");
  assert.equal(config.awsSesRegion, "us-east-1");
  assert.equal(config.hasExplicitAwsCredentials, false);
  assert.equal(config.credentialSource, "default_provider_chain");
  assert.equal(config.sesFromEmail, undefined);
  assert.equal(config.sesConfigurationSet, undefined);
  assert.deepEqual(config.sesSupportedRegions, ["us-east-1", "eu-west-1"]);
});

test("boolean parsing never treats the string false as enabled", () => {
  assert.equal(parseBoolean("true"), true);
  assert.equal(parseBoolean("false"), false);
  assert.equal(parseBoolean(undefined), false);
});

test("domain validation accepts a domain but rejects sender email and URL input", () => {
  assert.equal(normalizeDomain(" HOLLAPIC.COM. "), "hollapic.com");
  assert.throws(() => normalizeDomain("info@hollapic.com"), /EMAIL_USED_INSTEAD_OF_DOMAIN/);
  assert.throws(() => normalizeDomain("https:\/\/hollapic.com"), /URL_USED_INSTEAD_OF_DOMAIN/);
});

test("SES provisioning creates an identity once and persists real DKIM evidence", async () => {
  let lookupCount = 0;
  const calls: unknown[] = [];
  const client = {
    async send(command: unknown) {
      calls.push(command);
      if (command instanceof GetEmailIdentityCommand) {
        lookupCount += 1;
        if (lookupCount === 1) {
          const error = new Error("missing");
          error.name = "NotFoundException";
          throw error;
        }
        return { VerifiedForSendingStatus: false, DkimAttributes: { Status: "PENDING", Tokens: ["dkim-token"] } };
      }
      assert.ok(command instanceof CreateEmailIdentityCommand);
      return {};
    },
  };
  const provider = new SesSenderDomainProvider("us-east-1", { client });
  const result = await provider.provision({ workspaceId: "workspace-a", domain: "hollapic.com" });
  assert.equal(result.providerReference, "hollapic.com");
  assert.equal(result.providerRegion, "us-east-1");
  assert.equal(result.providerStatus, "pending");
  assert.deepEqual(result.expectedRecords, [{ type: "CNAME", host: "dkim-token._domainkey.hollapic.com", value: "dkim-token.dkim.amazonses.com", required: true }]);
  assert.equal(calls.filter(call => call instanceof CreateEmailIdentityCommand).length, 1);
});

test("SES adapter separates access denial from missing provider configuration", async () => {
  const client = { async send() { const error = new Error("denied"); error.name = "AccessDeniedException"; throw error; } };
  const provider = new SesSenderDomainProvider("us-east-1", { client });
  await assert.rejects(() => provider.provision({ workspaceId: "workspace-a", domain: "hollapic.com" }), /SES_ACCESS_DENIED/);
});

test("SES verification remains authoritative when a supplemental DNS lookup is stale", async () => {
  const provider = new SesSenderDomainProvider("us-east-1", {
    client: { async send() { return { VerifiedForSendingStatus: true, DkimAttributes: { Status: "SUCCESS", Tokens: ["dkim-token"] } }; } },
    dns: { async resolve() { return []; } } as any,
  });
  const result = await provider.check({ workspaceId: "workspace-a", domain: "hollapic.com", providerReference: "hollapic.com" }, [{ type: "CNAME", host: "dkim-token._domainkey.hollapic.com", value: "dkim-token.dkim.amazonses.com", required: true }]);
  assert.equal(result.status, "verified");
  assert.deepEqual(result.observedRecords, []);
});

test("SES adapter removes the provider identity using the domain's pinned region", async () => {
  const calls: unknown[] = [];
  const provider = new SesSenderDomainProvider("us-east-1", { client: { async send(command: unknown) { calls.push(command); return {}; } } });
  await provider.remove({ workspaceId: "workspace-a", domain: "hollapic.com", providerReference: "hollapic.com" });
  assert.equal(calls.length, 1);
  assert.ok(calls[0] instanceof DeleteEmailIdentityCommand);
});

test("regional SES provisioning rejects a browser-selected region outside the platform allowlist", () => {
  const provider = new RegionalSesSenderDomainProvider("us-east-1", ["us-east-1"]);
  assert.throws(() => provider.provision({ workspaceId: "workspace-a", domain: "hollapic.com", providerRegion: "eu-west-1" }), /SES_REGION_NOT_SUPPORTED/);
});
