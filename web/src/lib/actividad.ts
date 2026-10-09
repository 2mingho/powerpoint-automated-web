import "server-only";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { ipCliente } from "@/lib/ip";

/* Registro en activity_logs, como log_activity() de Flask. Nunca rompe la peticion que lo llama. */
export async function registrarActividad(
  userId: number,
  action: string,
  detail = "",
  entidad?: { tipo: string; id: number | null },
) {
  try {
    const h = await headers();
    const ip = ipCliente(h);
    await db.activity_logs.create({
      data: {
        user_id: userId,
        action: action.slice(0, 100),
        detail,
        ip_address: ip,
        timestamp: new Date(),
        entity_type: entidad?.tipo ?? null,
        entity_id: entidad?.id ?? null,
      },
    });
  } catch (e) {
    console.error("[actividad] no se pudo registrar", e);
  }
}
