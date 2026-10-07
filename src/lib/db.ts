import { PrismaClient } from "@prisma/client";

/**
 * One shared Prisma client for the web app AND the worker.
 * (In dev, Next.js reloads modules often; keeping it on globalThis avoids opening hundreds of connections.)
 */
const g = globalThis as unknown as { __prisma?: PrismaClient };

export const db: PrismaClient = g.__prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") g.__prisma = db;
