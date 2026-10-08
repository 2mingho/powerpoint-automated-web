import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/*
 * Un solo cliente por proceso. En desarrollo el recargado en caliente vuelve a
 * evaluar este modulo; sin guardarlo en globalThis cada guardado abriria un
 * pool nuevo hasta agotar las conexiones de PostgreSQL.
 */
const globalParaPrisma = globalThis as unknown as { prisma?: PrismaClient };

function crearCliente() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  return new PrismaClient({ adapter });
}

export const db = globalParaPrisma.prisma ?? crearCliente();

if (process.env.NODE_ENV !== "production") globalParaPrisma.prisma = db;
