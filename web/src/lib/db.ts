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
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // Conexiones por proceso (DB_POOL_MAX). Con una base que cobra o limita por conexion, mejor pocas.
    max: Number(process.env.DB_POOL_MAX) || 10,
    // Una base dormida (Neon) tarda en despertar: se espera, pero no para siempre.
    connectionTimeoutMillis: 20_000,
  });
  // Cada vez que la aplicacion toma una conexion para una consulta es senal de uso: /healthz solo pregunta a la base si hay uso (lib/salud.ts).
  pool.on("acquire", () => monitor.registrarUso());
  // Una conexion ociosa que la base cierra (Neon duerme las inactivas) no debe tumbar el proceso: la siguiente consulta abre otra.
  pool.on("error", (e) => console.error("[db] conexion ociosa perdida:", e.message));
  return new PrismaClient({ adapter: new PrismaPg(pool) });
}

export const db = globalParaPrisma.prisma ?? crearCliente();

if (process.env.NODE_ENV !== "production") globalParaPrisma.prisma = db;
