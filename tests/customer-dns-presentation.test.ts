import test from "node:test";
import assert from "node:assert/strict";
import {
  dnsHostForProvider,
  parseMxExpectedValue,
  presentCustomerDnsRecord,
} from "../packages/domain/src/phase1/customer-dns-presentation.js";

test("parseMxExpectedValue splits priority and mail server", () => {
  assert.deepEqual(parseMxExpectedValue("10 feedback-smtp.eu-north-1.amazonses.com"), {
    priority: 10,
    mailServer: "feedback-smtp.eu-north-1.amazonses.com",
  });
});

test("dnsHostForProvider returns short host labels for registrar panels", () => {
  assert.deepEqual(dnsHostForProvider("bounce.lahorixsolutions.com", "lahorixsolutions.com"), {
    value: "bounce",
    fullName: "bounce.lahorixsolutions.com",
  });
  assert.deepEqual(dnsHostForProvider("lahorixsolutions.com", "lahorixsolutions.com"), {
    value: "@",
    fullName: "lahorixsolutions.com",
  });
});

test("presentCustomerDnsRecord exposes DMARC copy fields", () => {
  const presentation = presentCustomerDnsRecord({
    type: "TXT",
    name: "_dmarc.lahorixsolutions.com",
    value: "v=DMARC1; p=none",
    purpose: "dmarc_advisory",
    rootDomain: "lahorixsolutions.com",
  });
  assert.equal(presentation.title, "DMARC policy (TXT)");
  assert.equal(presentation.host.value, "_dmarc");
  assert.equal(presentation.fields[0]?.value, "v=DMARC1; p=none");
  assert.match(presentation.instructions, /never creates or overwrites/i);
});

test("presentCustomerDnsRecord exposes separate MX copy fields", () => {
  const presentation = presentCustomerDnsRecord({
    type: "MX",
    name: "bounce.lahorixsolutions.com",
    value: "10 feedback-smtp.eu-north-1.amazonses.com",
    purpose: "mail_from_mx",
    rootDomain: "lahorixsolutions.com",
  });
  assert.equal(presentation.host.value, "bounce");
  assert.equal(presentation.fields[0]?.value, "10");
  assert.equal(presentation.fields[1]?.value, "feedback-smtp.eu-north-1.amazonses.com");
  assert.match(presentation.instructions, /separate Priority and Mail server/i);
});
