import { PrismaClient } from "@prisma/client";
import { buildStaticProductionCustomerRecords } from "../packages/domain/src/phase1/static-production-customer-dns.js";
import { staticProductionDnsRecordCount } from "../packages/domain/src/phase1/static-branded-dns.js";
import { loadEmailPlatformConfig } from "../packages/config/src/env.js";

const workspaceId = process.argv[2] ?? "81a81c08-d7b5-4d49-bc64-d0caf2d36a32";
const domainId = process.argv[3] ?? "3dc8c2c7-b44c-4cec-a566-36f80e47cb47";
const config = loadEmailPlatformConfig();
const dmarcRequired = Boolean(config.dmarcRequired);
const db = new PrismaClient();

const domain = await db.senderDomain.findUnique({ where: { id: domainId } });
if (!domain || domain.workspaceId !== workspaceId) throw new Error("DOMAIN_NOT_FOUND");

const evidence = await db.senderDomainDnsEvidence.findMany({
  where: { workspaceId, senderDomainId: domainId },
  orderBy: [{ purpose: "asc" }, { name: "asc" }],
});

const customerRecords = buildStaticProductionCustomerRecords({
  rootDomain: domain.rootDomain ?? domain.domain,
  dmarcRequired,
  evidence: evidence.map((row) => ({
    purpose: row.purpose,
    recordType: row.recordType,
    name: row.name,
    expectedValue: row.expectedValue,
    verificationStatus: row.verificationStatus,
    observedValues: row.observedValues,
    lastCheckedAt: row.lastCheckedAt,
  })),
});

const expectedCount = staticProductionDnsRecordCount(dmarcRequired);
const sendRoutingRows = evidence.filter((row) => row.purpose === "send_routing");
const duplicatePurposes = [...new Set(
  evidence
    .filter((row) => row.verificationStatus !== "archived")
    .map((row) => row.purpose)
    .filter((purpose, index, all) => all.indexOf(purpose) !== index),
)];

console.log(JSON.stringify({
  domain: domain.rootDomain ?? domain.domain,
  lifecycleState: domain.lifecycleState,
  authenticationStatus: domain.authenticationStatus,
  readinessStatus: domain.readinessStatus,
  readinessReasons: domain.readinessReasons,
  expectedProductionRecordCount: expectedCount,
  uiProductionRecordCount: customerRecords.length,
  verifiedProductionRecords: customerRecords.filter((row) => row.status === "verified").length,
  customerRecords: customerRecords.map((row) => ({
    purpose: row.purpose,
    host: row.presentation.host.value,
    status: row.status,
  })),
  sendRoutingRowsInDb: sendRoutingRows.length,
  duplicateActivePurposes: duplicatePurposes,
  senderIdentityEligible: domain.authenticationStatus === "verified" || String(domain.lifecycleState ?? "").toUpperCase() === "READY",
  ok:
    customerRecords.length === expectedCount &&
    sendRoutingRows.every((row) => row.customerActionRequired === false) &&
    duplicatePurposes.length === 0 &&
    (domain.authenticationStatus === "verified" || String(domain.lifecycleState ?? "").toUpperCase() === "READY"),
}, null, 2));

await db.$disconnect();
