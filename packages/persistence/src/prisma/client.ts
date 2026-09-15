// Real PostgreSQL adapter composition root. Requires `npm install` + `npx prisma generate`.
import { PrismaClient } from "@prisma/client";
export const prisma = new PrismaClient({ log: ["warn", "error"] });
