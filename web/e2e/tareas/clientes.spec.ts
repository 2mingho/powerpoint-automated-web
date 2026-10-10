import { expect, test } from "@playwright/test";
import { BASE, entrarComo, escenario, HOY, sql, sumarDias, updatedAt } from "./apoyo";

/*
 * Cliente como entidad: al crear o cambiar una tarea el texto se resuelve a un
 * cliente por su clave (mayusculas, acentos y espacios no cuentan) y la tarea
 * guarda su nombre canonico. Cada prueba usa nombres propios.
 */

test.beforeEach(({}, info) => { test.skip(info.project.name !== "escritorio", "La API se prueba una vez, en escritorio."); });

const cliente = async (clave: string) => (await sql<{ id: number; name: string }>("SELECT id, name FROM clients WHERE name_key = $1", [clave]))[0];
const filas = async (clave: string) => Number((await sql<{ n: string }>("SELECT count(*) n FROM clients WHERE name_key = $1", [clave]))[0].n);
const tarea = async (id: number) => (await sql<{ client: string; client_id: number | null }>("SELECT client, client_id FROM tasks WHERE id = $1", [id]))[0];

test.describe("crear y cambiar tareas", () => {
  test("un cliente nuevo se crea y las variantes reutilizan el mismo, con su nombre canonico", async ({ context }) => {
    const e = await escenario("cli");
    const marca = `Cervecería ${e.sufijo}`; // con acento y mayuscula
    const clave = `cerveceria ${e.sufijo}`.toLowerCase();
    await entrarComo(context, e.empleado);
    const crear = async (client: string) => {
      const r = await context.request.post(`${BASE}/api/tareas`, { data: { title: `T ${client}`, assignee_id: e.empleado, due_date: sumarDias(HOY, 3), client } });
      expect(r.status(), await r.text()).toBe(201);
      return (await r.json()).tarea as { id: number; cliente: string; clienteId: number };
    };

    const primera = await crear(marca);
    expect(primera.cliente).toBe(marca);
    expect(await filas(clave)).toBe(1);
    const c = await cliente(clave);
    expect(primera.clienteId).toBe(c.id);

    for (const variante of [marca.toUpperCase(), `  ${marca.toLowerCase()}  `, marca.replace("í", "i").replace(" ", "   ")]) {
      const t = await crear(variante);
      expect(t.clienteId, variante).toBe(c.id);
      expect(t.cliente, variante).toBe(marca);
      expect(await tarea(t.id)).toEqual({ client: marca, client_id: c.id });
    }
    expect(await filas(clave)).toBe(1);

    // Lo que solo se parece NO se une.
    const otro = await crear(`${marca}.`);
    expect(otro.clienteId).not.toBe(c.id);
  });

  test("editar el cliente cambia el enlace; vaciarlo lo quita", async ({ context }) => {
    const e = await escenario("cli-edit");
    const a = `Alfa Cliente ${e.sufijo}`;
    const b = `Beta Cliente ${e.sufijo}`;
    const id = await e.tarea("Con cliente", e.alfa, e.empleado, e.empleado);
    await entrarComo(context, e.empleado);
    const poner = async (client: string) => {
      const r = await context.request.put(`${BASE}/api/tareas/${id}`, { data: { client, expected_updated_at: await updatedAt(id) } });
      expect(r.status(), await r.text()).toBe(200);
      return (await r.json()).tarea as { cliente: string; clienteId: number | null };
    };
    const ta = await poner(a.toLowerCase());
    expect(ta.cliente).toBe(a.toLowerCase()); // era nuevo: se queda con como se escribio
    const tb = await poner(b);
    expect(tb.clienteId).not.toBe(ta.clienteId);
    const vacio = await poner("  ");
    expect(vacio).toMatchObject({ cliente: "", clienteId: null });
    expect(await tarea(id)).toEqual({ client: "", client_id: null });
  });

  test("la plantilla usa el cliente existente aunque lo escriba distinto", async ({ context }) => {
    const e = await escenario("cli-plan");
    const nombre = `Plantilla Cliente ${e.sufijo}`;
    const clave = nombre.toLowerCase();
    const idCliente = (await sql<{ id: number }>("INSERT INTO clients (name, name_key, is_active, created_at) VALUES ($1, $2, true, now()) RETURNING id", [nombre, clave]))[0].id;
    const plantilla = (await sql<{ id: number }>("INSERT INTO task_templates (area_id, created_by_id, name, payload_json, created_at) VALUES ($1, $2, $3, $4, now()) RETURNING id",
      [e.alfa, e.empleado, `Plantilla ${e.sufijo}`, JSON.stringify({ title: "Desde plantilla", client: nombre.toUpperCase(), priority: "Media", due_offset_days: 2, checklist: [] })]))[0].id;
    await entrarComo(context, e.empleado);
    const r = await context.request.post(`${BASE}/api/tareas/plantillas/${plantilla}/usar`, { data: { assignee_id: e.empleado } });
    expect(r.status(), await r.text()).toBe(201);
    const creada = (await r.json()).tarea as { id: number };
    expect(await tarea(creada.id)).toEqual({ client: nombre, client_id: idCliente });
    expect(await filas(clave)).toBe(1);
  });

  test("aceptar una solicitud usa el cliente existente aunque venga escrito distinto", async ({ context }) => {
    const e = await escenario("cli-sol");
    const nombre = `Solicitud Cliente ${e.sufijo}`;
    const idCliente = (await sql<{ id: number }>("INSERT INTO clients (name, name_key, is_active, created_at) VALUES ($1, $2, true, now()) RETURNING id", [nombre, nombre.toLowerCase()]))[0].id;
    await sql("INSERT INTO unit_leads (user_id, area_id) VALUES ($1, $2)", [e.empleado, e.alfa]);
    const sol = (await sql<{ id: number }>(
      `INSERT INTO task_requests (title, description, client, due_date, priority, requester_id, from_area_id, to_area_id, status, created_at)
       VALUES ('Pedido', '', $1, $2, 'Media', $3, $4, $5, 'Pendiente', now()) RETURNING id`,
      [`  ${nombre.toUpperCase()} `, sumarDias(HOY, 3), e.ajeno, e.beta, e.alfa]))[0].id;
    await entrarComo(context, e.empleado);
    const r = await context.request.post(`${BASE}/api/solicitudes/${sol}/aceptar`, { data: { responsableId: e.companero } });
    expect(r.status(), await r.text()).toBe(200);
    const t = (await sql<{ client: string; client_id: number }>("SELECT client, client_id FROM tasks WHERE title = 'Pedido' AND assignee_id = $1 ORDER BY id DESC LIMIT 1", [e.companero]))[0];
    expect(t).toEqual({ client: nombre, client_id: idCliente });
  });

  test("importar un CSV con variantes crea un solo cliente", async ({ context }) => {
    const e = await escenario("cli-csv");
    await sql("INSERT INTO unit_leads (user_id, area_id) VALUES ($1, $2)", [e.empleado, e.alfa]);
    const nombre = `Importado ${e.sufijo}`;
    const clave = nombre.toLowerCase();
    await entrarComo(context, e.empleado);
    const fila = (n: number, client: string) => ({
      row_number: n,
      fields: { start_date: "", end_date: "", due_date: sumarDias(HOY, 4), directorate: "", client, title: `Fila ${n}`, requested_by: "", assignee: `empleado.${e.sufijo}@e2e.test`, description: "", budget_type: "", priority: "Media", recurrence: "" },
    });
    const r = await context.request.post(`${BASE}/api/tareas/csv/importar`, { data: { rows: [fila(2, nombre), fila(3, nombre.toUpperCase()), fila(4, `  ${nombre.toLowerCase()} `)] } });
    expect(r.status(), await r.text()).toBe(200);
    expect(await filas(clave)).toBe(1);
    const c = await cliente(clave);
    const importadas = await sql<{ client: string; client_id: number }>("SELECT client, client_id FROM tasks WHERE title LIKE 'Fila %' AND assignee_id = $1 AND client_id = $2", [e.empleado, c.id]);
    expect(importadas).toHaveLength(3);
    expect(new Set(importadas.map((t) => t.client))).toEqual(new Set([nombre]));
  });
});
