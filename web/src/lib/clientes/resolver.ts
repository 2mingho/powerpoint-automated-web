import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { claveDeCliente, nombreLimpio } from "./nombre";

/*
 * Cliente de una tarea: del texto que escribe la persona al par que se guarda
 * (client, client_id). Si ya existe un cliente con la misma clave (mismo nombre
 * salvo mayusculas, acentos o espacios) se usa ese y su nombre canonico; si no,
 * se crea. Asi dos personas que escriben «claro» y «Claro» no abren dos clientes.
 *
 * Un texto vacio es "sin cliente": client = "" y client_id = null, como antes.
 */
export type ClienteGuardado = { client: string; client_id: number | null };

type Cliente = Prisma.TransactionClient | typeof db;

const SIN_CLIENTE: ClienteGuardado = { client: "", client_id: null };

async function buscarOCrear(tx: Cliente, nombre: string, clave: string): Promise<{ id: number; name: string }> {
  const hallado = await tx.clients.findUnique({ where: { name_key: clave }, select: { id: true, name: true } });
  if (hallado) return hallado;
  try {
    return await tx.clients.create({ data: { name: nombre, name_key: clave, created_at: new Date() }, select: { id: true, name: true } });
  } catch (e) {
    // Otra peticion lo creo justo antes (clave unica): se usa el suyo.
    if ((e as { code?: string }).code === "P2002") return tx.clients.findUniqueOrThrow({ where: { name_key: clave }, select: { id: true, name: true } });
    throw e;
  }
}

export async function resolverCliente(tx: Cliente, texto: unknown): Promise<ClienteGuardado> {
  const nombre = nombreLimpio(typeof texto === "string" ? texto : texto == null ? "" : String(texto)).slice(0, 100);
  const clave = claveDeCliente(nombre);
  if (!clave) return SIN_CLIENTE;
  const c = await buscarOCrear(tx, nombre, clave);
  return { client: c.name, client_id: c.id };
}

/* Varios textos de una vez (importar CSV): un solo cliente por clave, en el orden en que aparecen. */
export async function resolverClientes(tx: Cliente, textos: string[]): Promise<Map<string, ClienteGuardado>> {
  const porClave = new Map<string, ClienteGuardado>();
  const salida = new Map<string, ClienteGuardado>();
  for (const t of textos) {
    const nombre = nombreLimpio(t).slice(0, 100);
    const clave = claveDeCliente(nombre);
    if (!clave) { salida.set(t, SIN_CLIENTE); continue; }
    let r = porClave.get(clave);
    if (!r) {
      const c = await buscarOCrear(tx, nombre, clave);
      r = { client: c.name, client_id: c.id };
      porClave.set(clave, r);
    }
    salida.set(t, r);
  }
  return salida;
}
