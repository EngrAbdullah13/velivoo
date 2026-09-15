import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient({
  log: process.env.EMAIL_PLATFORM_DB_QUERY_LOG === "true" ? ["warn", "error", "query"] : ["warn", "error"],
});

export async function closePrisma(): Promise<void> {
  await prisma.$disconnect();
}
