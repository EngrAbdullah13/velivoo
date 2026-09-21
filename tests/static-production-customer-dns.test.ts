import test from "node:test";
import assert from "node:assert/strict";
import {
  buildStaticProductionCustomerRecords,
  pickDnsEvidenceForPurpose,
} from "../packages/domain/src/phase1/static-production-customer-dns.js";
import { staticProductionDnsRecordCount } from "../packages/domain/src/phase1/static-branded-dns.js";

test("static production DNS uses a fixed count per domain", () => {
  assert.equal(staticProductionDnsRecordCount(false), 5);
  assert.equal(staticProductionDnsRecordCount(true), 6);
});

test("buildStaticProductionCustomerRecords always returns the fixed production set", () => {
  const records = buildStaticProductionCustomerRecords({
    rootDomain: "velivoo.com",
    dmarcRequired: true,
    evidence: [
      { purpose: "ownership", recordType: "TXT", name: "velivoo.com", expectedValue: "velivoo-site-verification=abc", verificationStatus: "verified" },
      { purpose: "dkim_vm1", recordType: "CNAME", name: "vm1._domainkey.velivoo.com", expectedValue: "vm1.d_test.dkim.velivoo.com", verificationStatus: "verified" },
      { purpose: "dkim_vm2", recordType: "CNAME", name: "vm2._domainkey.velivoo.com", expectedValue: "vm2.d_test.dkim.velivoo.com", verificationStatus: "verified" },
      { purpose: "mail_from_mx", recordType: "MX", name: "bounce.velivoo.com", expectedValue: "10 feedback-smtp.eu-north-1.amazonses.com", verificationStatus: "verified" },
      { purpose: "mail_from_spf", recordType: "TXT", name: "bounce.velivoo.com", expectedValue: "v=spf1 include:amazonses.com ~all", verificationStatus: "verified" },
      { purpose: "dmarc_advisory", recordType: "TXT", name: "_dmarc.velivoo.com", expectedValue: "v=DMARC1; p=none", verificationStatus: "pending" },
      { purpose: "dmarc_advisory", recordType: "TXT", name: "_dmarc.velivoo.com", expectedValue: "v=DMARC1; p=quarantine", verificationStatus: "verified" },
      { purpose: "send_routing", recordType: "CNAME", name: "send.velivoo.com", expectedValue: "d_test.send.velivoo.com", verificationStatus: "nxdomain" },
    ],
  });
  assert.equal(records.length, 6);
  assert.equal(records.filter((record) => record.purpose === "send_routing").length, 0);
  assert.equal(records.find((record) => record.purpose === "dmarc_advisory")?.status, "verified");
  assert.equal(records.every((record) => record.presentation?.title), true);
});

test("pickDnsEvidenceForPurpose prefers verified rows", () => {
  const picked = pickDnsEvidenceForPurpose(
    [
      { purpose: "dmarc_advisory", recordType: "TXT", name: "_dmarc.example.com", expectedValue: "v=DMARC1; p=none", verificationStatus: "pending" },
      { purpose: "dmarc_advisory", recordType: "TXT", name: "_dmarc.example.com", expectedValue: "v=DMARC1; p=quarantine", verificationStatus: "verified" },
    ],
    "dmarc_advisory",
  );
  assert.equal(picked?.expectedValue, "v=DMARC1; p=quarantine");
});
