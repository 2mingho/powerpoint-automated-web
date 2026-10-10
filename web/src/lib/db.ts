import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { monitor } from "@/lib/salud";
import { PrismaClient } from "@/generated/prisma/client";

/*
 * Un solo cliente por proceso. En desarrollo el recargado en caliente vuelve a
 * evaluar este modulo; sin guardarlo en globalThis cada guardado abriria un
 * pool nuevo hasta agotar las conexiones de PostgreSQL.
 */
const globalParaPrisma = globalThis as unknown as { prisma?: PrismaClient };

function crearCliente() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  // Cada vez que la aplicacion toma una conexion para una consulta es senal de uso: /healthz solo pregunta a la base si hay uso (lib/salud.ts).
  pool.on("acquire", () => monitor.registrarUso());
  // Una conexion ociosa que la base cierra (Neon duerme las inactivas) no debe tumbar el proceso: la siguiente consulta abre otra.
  pool.on("error", (e) => console.error("[db] conexion ociosa perdida:", e.message));
  return new PrismaClient({ adapter: new PrismaPg(pool) });
}

export const db = globalParaPrisma.prisma ?? crearCliente();

if (process.env.NODE_ENV !== "production") globalParaPrisma.prisma = db;
