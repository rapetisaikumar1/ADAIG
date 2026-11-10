import { createPrismaClient, type PrismaClient } from "@/lib/prisma";
import { runtimeDatabaseUrl } from "@/lib/env";
/** App-wide Prisma client on the pooled connection. Kept on globalThis in development so hot reloads reuse one pool. */
const g = globalThis as unknown as { prisma?: PrismaClient };
export const db = g.prisma ?? createPrismaClient(runtimeDatabaseUrl());
if (process.env.NODE_ENV !== "production") g.prisma = db;
