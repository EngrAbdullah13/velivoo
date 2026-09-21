import { PrismaClient } from "@prisma/client";

const domainId = process.argv[2] ?? "3dc8c2c7-b44c-4cec-a566-36f80e47cb47";
const db = new PrismaClient();
const domain = await db.senderDomain.findUnique({ where: { id: domainId } });
console.log(JSON.stringify({
  id: domain?.id,
  lifecycleState: domain?.lifecycleState,
  status: domain?.status,
  authenticationStatus: domain?.authenticationStatus,
  readinessStatus: domain?.readinessStatus,
  readinessReasons: domain?.readinessReasons,
  verificationStatus: domain?.verificationStatus,
  dkimStatus: domain?.dkimStatus,
  mailFromStatus: domain?.mailFromStatus,
}, null, 2));
await db.$disconnect();
