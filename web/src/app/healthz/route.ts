import { connection, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { estadoDelEsquema } from "@/lib/esquema";
import { monitor } from "@/lib/salud";

/*
 * Sonda del orquestador: sin sesion, sin base de datos en cada llamada (ver lib/salud.ts).
 * 200 si el proceso atiende, la base responde y el esquema es el que espera este codigo;
 * 503 si la base no responde o falta migrar. No expone version ni detalles del error.
 */
export async function GET() {
  // Dato de peticion: con Cache Components, sin esto la respuesta se calcularia una vez al construir.
  await connection();
  const r = await monitor.comprobar(async () => {
    const v = await db.alembic_version.findFirst({ select: { version_num: true } });
    const e = estadoDelEsquema(v?.version_num);
    return { schema: e === "atrasado" ? "atrasado" : e === "sin_migrar" ? "sin_migrar" : "ok" } as const;
  });
  return NextResponse.json(r.cuerpo, { status: r.codigo, headers: { "Cache-Control": "no-store" } });
}
