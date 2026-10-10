import { conUsuario, cuerpo, ok } from "@/lib/api";
import { SOLO_ADMIN } from "@/lib/admin/api";
import { crearCliente, leerFiltrosClientes, listarClientes } from "@/lib/clientes/admin";

export const GET = conUsuario(async (req) => ok(await listarClientes(leerFiltrosClientes(new URL(req.url).searchParams))), SOLO_ADMIN);

export const POST = conUsuario(async (req, u) => ok({ id: await crearCliente(u.id, await cuerpo(req)) }, 201), SOLO_ADMIN);
