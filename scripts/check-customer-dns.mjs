import { PrismaClient } from "@prisma/client";
import { Resolver } from "node:dns/promises";

const domain = process.argv[2] ?? "lahorixsolutions.com";
const prisma = new PrismaClient();
const r = new Resolver();
r.setServers(["1.1.1.1", "8.8.8.8"]);

try {
  const rows = await prisma.senderDomainDnsEvidence.findMany({
    where: { senderDomainId: "1cd3f320-1c2f-4c93-9f82-28a23f45ea10", customerActionRequired: true },
    orderBy: { purpose: "asc" },
  });

  for (const row of rows) {
    console.log("\n===", row.purpose, "===");
    console.log("Velivoo expects:", row.recordType, row.name, "->", row.expectedValue);
    console.log("Velivoo status:", row.verificationStatus);
    try {
      if (row.recordType === "CNAME") {
        const cname = await r.resolveCname(row.name).catch(() => []);
        console.log("Public CNAME:", cname);
      }
      const txt = await r.resolveTxt(row.name).catch(() => []);
      if (txt.length) console.log("Public TXT:", txt.map(parts => parts.join("")));
    } catch (error) {
      console.log("DNS lookup error:", error.code ?? error.message);
    }
  }
} finally {
  await prisma.$disconnect();
}
