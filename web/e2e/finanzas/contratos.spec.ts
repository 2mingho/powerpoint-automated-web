import { expect, test, type BrowserContext } from "@playwright/test";
import { escenario, entrarComo, sql } from "../tareas/apoyo";
import { ADMIN, contextoCon } from "../admin/ayuda";

/*
 * Contratos y metas de ingresos. Lo sensible es el dinero: cada persona ve solo
 * las unidades que supervisa o que puede editar, edita solo las concedidas por
 * tipo (contratos / metas), y lo que no ve responde como si no existiera.
 */
test.beforeEach(() => {
  test.skip(test.info().project.name !== "escritorio", "contrato de API: una pasada basta");
  test.setTimeout(120_000);
});

type Escenario = Awaited<ReturnType<typeof escenario>>;
type Dto = { id: number; cliente: { id: number; nombre: string }; unidad: { id: number; nombre: string }; tipo: string; monto: number; inicio: string; fin: string; meses: number; porMes: number; puedeEditar: boolean; anio?: { total: number; meses: number[] } };

const conceder = (user: number, area: number, kind: "contracts" | "goals") =>
  sql("INSERT INTO finance_grants (user_id, area_id, kind, created_at) VALUES ($1, $2, $3, now()) ON CONFLICT DO NOTHING", [user, area, kind]);
const lidera = (user: number, area: number) => sql("INSERT INTO unit_leads (user_id, area_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [user, area]);
const cliente = async (e: Escenario, nombre = "Altice") => {
  const n = `${nombre} ${e.sufijo}`;
  return { nombre: n, id: (await sql<{ id: number }>("INSERT INTO clients (name, name_key, is_active, created_at) VALUES ($1, $2, true, now()) ON CONFLICT (name_key) DO UPDATE SET name = excluded.name RETURNING id", [n, n.toLowerCase()]))[0].id };
};
const contrato = (clienteId: number, unidadId: number, extra: Record<string, unknown> = {}) =>
  ({ clienteId, unidadId, tipo: "Fee", monto: 15000, inicio: "2026-01-01", fin: "2026-12-31", ...extra });
const cuantos = async (area: number) => Number((await sql<{ n: string }>("SELECT count(*) n FROM contracts WHERE area_id = $1", [area]))[0].n);
const fila = async (id: number) => (await sql<{ amount: string; area_id: number; client_id: number; contract_type: string; start_date: Date; created_by: number | null; note: string | null; from_area_id: number | null }>("SELECT * FROM contracts WHERE id = $1", [id]))[0];
const adminId = async () => (await sql<{ id: number }>("SELECT id FROM users WHERE email = $1", [ADMIN]))[0].id;
const crear = (ctx: BrowserContext, cuerpo: Record<string, unknown>) => ctx.request.post("/api/finanzas/contratos", { data: cuerpo });
const lista = async (ctx: BrowserContext, q = "") => (await (await ctx.request.get(`/api/finanzas/contratos${q}`)).json()) as { contratos: Dto[]; truncado: boolean };

test.describe("crear", () => {
  test("con la concesion de contratos de esa unidad: crea, confirma el prorrateo y deja registro", async ({ context }) => {
    const e = await escenario("con-crear");
    await conceder(e.empleado, e.alfa, "contracts");
    const c = await cliente(e);
    await entrarComo(context, e.empleado);
    const r = await crear(context, contrato(c.id, e.alfa, { nota: "Renovación" }));
    expect(r.status(), await r.text()).toBe(201);
    const { id, prorrateo } = await r.json();
    expect(prorrateo).toBe("US$1,250 por mes durante 12 meses");
    expect(await fila(id)).toMatchObject({ amount: "15000.00", area_id: e.alfa, client_id: c.id, contract_type: "Fee", created_by: e.empleado, note: "Renovación" });
    const [log] = await sql<{ detail: string }>("SELECT detail FROM activity_logs WHERE action = 'contract_create' AND entity_id = $1", [id]);
    expect(log.detail).toContain(c.nombre);
    expect(log.detail).toContain("US$15,000");
  });

  test("sin sesion es 401", async ({ request }) => {
    expect((await request.post("/api/finanzas/contratos", { data: {} })).status()).toBe(401);
    expect((await request.get("/api/finanzas/contratos")).status()).toBe(401);
  });

  test("sin concesion: 404 si no ve la unidad, 403 si la ve", async ({ context }) => {
    const e = await escenario("con-sin");
    const c = await cliente(e);
    await entrarComo(context, e.empleado);
    expect((await crear(context, contrato(c.id, e.alfa))).status()).toBe(404);
    await lidera(e.empleado, e.alfa); // ahora la supervisa: la ve, pero no la edita
    expect((await crear(context, contrato(c.id, e.alfa))).status()).toBe(403);
    expect(await cuantos(e.alfa)).toBe(0);
  });

  test("la concesion de metas no sirve para contratos: son permisos separados", async ({ context }) => {
    const e = await escenario("con-separado");
    await conceder(e.empleado, e.alfa, "goals");
    const c = await cliente(e);
    await entrarComo(context, e.empleado);
    expect((await crear(context, contrato(c.id, e.alfa))).status()).toBe(403);
    expect(await cuantos(e.alfa)).toBe(0);
  });

  test("la concesion de una unidad no sirve en otra", async ({ context }) => {
    const e = await escenario("con-otra");
    await conceder(e.empleado, e.alfa, "contracts");
    const c = await cliente(e);
    await entrarComo(context, e.empleado);
    expect((await crear(context, contrato(c.id, e.beta))).status()).toBe(404);
    expect(await cuantos(e.beta)).toBe(0);
  });

  test("la misma respuesta para una unidad ajena y para una que no existe", async ({ context }) => {
    const e = await escenario("con-igual");
    const c = await cliente(e);
    await entrarComo(context, e.empleado);
    const ajena = await crear(context, contrato(c.id, e.beta));
    const inexistente = await crear(context, contrato(c.id, 99999999));
    expect(ajena.status()).toBe(404);
    expect(inexistente.status()).toBe(404);
    expect(await ajena.json()).toEqual(await inexistente.json());
  });

  test("administracion crea en cualquier unidad", async ({ browser }) => {
    const { ctx } = await contextoCon(browser, ADMIN);
    const e = await escenario("con-admin");
    const c = await cliente(e);
    const r = await crear(ctx, contrato(c.id, e.beta));
    expect(r.status(), await r.text()).toBe(201);
    expect((await fila((await r.json()).id)).created_by).toBe(await adminId());
  });

  test("rechaza lo invalido sin crear nada", async ({ context }) => {
    const e = await escenario("con-invalido");
    await conceder(e.empleado, e.alfa, "contracts");
    const c = await cliente(e);
    await entrarComo(context, e.empleado);
    const ok = contrato(c.id, e.alfa);
    for (const [motivo, cambio] of Object.entries({
      "sin cliente": { clienteId: null }, "cliente inexistente": { clienteId: 99999999 },
      "tipo": { tipo: "Mensual" }, "monto 0": { monto: 0 }, "monto negativo": { monto: -1 }, "monto texto": { monto: "mucho" }, "monto con miles": { monto: "15,000" }, "monto con 3 decimales": { monto: 10.123 },
      "fin antes del inicio": { fin: "2025-12-31" }, "fin igual al inicio": { fin: "2026-01-01" }, "fecha imposible": { inicio: "2026-02-30" },
      "nota larga": { nota: "x".repeat(501) }, "asigna sin ser asignacion": { asignaId: e.beta }, "asigna inexistente": { tipo: "Asignación", asignaId: 99999999 }, "asigna la misma": { tipo: "Asignación", asignaId: e.alfa },
    })) {
      const r = await crear(context, { ...ok, ...cambio });
      expect(r.status(), motivo).toBe(400);
    }
    expect(await cuantos(e.alfa)).toBe(0);
  });

  test("una Asignacion guarda la unidad que asigna", async ({ context }) => {
    const e = await escenario("con-asigna");
    await conceder(e.empleado, e.alfa, "contracts");
    const c = await cliente(e);
    await entrarComo(context, e.empleado);
    const r = await crear(context, contrato(c.id, e.alfa, { tipo: "Asignación", asignaId: e.beta, monto: "1200,50" }));
    expect(r.status(), await r.text()).toBe(201);
    expect(await fila((await r.json()).id)).toMatchObject({ contract_type: "Asignación", from_area_id: e.beta, amount: "1200.50" });
  });
});

test.describe("editar y borrar", () => {
  async function conContrato(prefijo: string) {
    const e = await escenario(prefijo);
    const c = await cliente(e);
    const [{ id }] = await sql<{ id: number }>("INSERT INTO contracts (client_id, area_id, contract_type, amount, start_date, end_date, created_at, updated_at) VALUES ($1, $2, 'Fee', 12000, '2026-01-01', '2026-12-31', now(), now()) RETURNING id", [c.id, e.alfa]);
    return { e, c, id };
  }

  test("edicion parcial: cambia solo lo que llega y confirma el nuevo prorrateo", async ({ context }) => {
    const { e, id } = await conContrato("con-edit");
    await conceder(e.empleado, e.alfa, "contracts");
    await entrarComo(context, e.empleado);
    const r = await context.request.patch(`/api/finanzas/contratos/${id}`, { data: { monto: 6000, fin: "2026-06-30" } });
    expect(r.status(), await r.text()).toBe(200);
    expect((await r.json()).prorrateo).toBe("US$1,000 por mes durante 6 meses");
    expect(await fila(id)).toMatchObject({ amount: "6000.00", area_id: e.alfa, contract_type: "Fee" });
    const [log] = await sql<{ detail: string }>("SELECT detail FROM activity_logs WHERE action = 'contract_update' AND entity_id = $1", [id]);
    expect(log.detail).toContain("antes US$12,000");
  });

  test("una edicion invalida no cambia nada", async ({ context }) => {
    const { e, id } = await conContrato("con-edit-mal");
    await conceder(e.empleado, e.alfa, "contracts");
    await entrarComo(context, e.empleado);
    for (const cambio of [{ monto: 0 }, { fin: "2025-01-01" }, { tipo: "x" }, { clienteId: 99999999 }, { inicio: "2027-01-01" }]) {
      expect((await context.request.patch(`/api/finanzas/contratos/${id}`, { data: cambio })).status(), JSON.stringify(cambio)).toBe(400);
    }
    expect(await fila(id)).toMatchObject({ amount: "12000.00" });
  });

  test("sin ver la unidad es 404; viendola sin concesion es 403; y nada cambia", async ({ context }) => {
    const { e, id } = await conContrato("con-edit-perm");
    await entrarComo(context, e.ajeno); // de Beta
    const ajeno = await context.request.patch(`/api/finanzas/contratos/${id}`, { data: { monto: 1 } });
    const inexistente = await context.request.patch("/api/finanzas/contratos/99999999", { data: { monto: 1 } });
    expect(ajeno.status()).toBe(404);
    expect(await ajeno.json()).toEqual(await inexistente.json());
    expect((await context.request.delete(`/api/finanzas/contratos/${id}`)).status()).toBe(404);

    await lidera(e.ajeno, e.alfa);
    expect((await context.request.patch(`/api/finanzas/contratos/${id}`, { data: { monto: 1 } })).status()).toBe(403);
    expect((await context.request.delete(`/api/finanzas/contratos/${id}`)).status()).toBe(403);
    await conceder(e.ajeno, e.alfa, "goals"); // otro tipo: tampoco
    expect((await context.request.patch(`/api/finanzas/contratos/${id}`, { data: { monto: 1 } })).status()).toBe(403);
    expect(await fila(id)).toMatchObject({ amount: "12000.00" });
  });

  test("mover un contrato a otra unidad exige poder editar las dos", async ({ context }) => {
    const { e, id } = await conContrato("con-mover");
    await conceder(e.empleado, e.alfa, "contracts");
    await entrarComo(context, e.empleado);
    expect((await context.request.patch(`/api/finanzas/contratos/${id}`, { data: { unidadId: e.beta } })).status()).toBe(404); // no ve Beta
    await lidera(e.empleado, e.beta);
    expect((await context.request.patch(`/api/finanzas/contratos/${id}`, { data: { unidadId: e.beta } })).status()).toBe(403); // la ve, no la edita
    await conceder(e.empleado, e.beta, "contracts");
    expect((await context.request.patch(`/api/finanzas/contratos/${id}`, { data: { unidadId: e.beta } })).status()).toBe(200);
    expect((await fila(id)).area_id).toBe(e.beta);
  });

  test("al dejar de ser Asignacion se olvida la unidad que asigna", async ({ context }) => {
    const e = await escenario("con-tipo");
    await conceder(e.empleado, e.alfa, "contracts");
    const c = await cliente(e);
    await entrarComo(context, e.empleado);
    const { id } = await (await crear(context, contrato(c.id, e.alfa, { tipo: "Asignación", asignaId: e.beta }))).json();
    expect((await context.request.patch(`/api/finanzas/contratos/${id}`, { data: { tipo: "Proyecto" } })).status()).toBe(200);
    expect(await fila(id)).toMatchObject({ contract_type: "Proyecto", from_area_id: null });
  });

  test("borrar: con la concesion lo quita y lo registra", async ({ context }) => {
    const { e, id } = await conContrato("con-borrar");
    await conceder(e.empleado, e.alfa, "contracts");
    await entrarComo(context, e.empleado);
    expect((await context.request.delete(`/api/finanzas/contratos/${id}`)).status()).toBe(200);
    expect(await fila(id)).toBeUndefined();
    const [log] = await sql<{ detail: string }>("SELECT detail FROM activity_logs WHERE action = 'contract_delete' AND entity_id = $1", [id]);
    expect(log.detail).toContain("US$12,000");
    expect((await context.request.delete(`/api/finanzas/contratos/${id}`)).status()).toBe(404);
  });
});

test.describe("lo que se ve", () => {
  test("cada persona ve solo las unidades que supervisa o puede editar", async ({ context }) => {
    const e = await escenario("con-ver");
    const c = await cliente(e);
    const nuevo = async (area: number, monto: number) => (await sql<{ id: number }>("INSERT INTO contracts (client_id, area_id, contract_type, amount, start_date, end_date, created_at, updated_at) VALUES ($1, $2, 'Fee', $3, '2026-01-01', '2026-12-31', now(), now()) RETURNING id", [c.id, area, monto]))[0].id;
    const enAlfa = await nuevo(e.alfa, 1000);
    const enBeta = await nuevo(e.beta, 2000);

    await entrarComo(context, e.empleado); // sin mando ni concesiones
    expect((await lista(context)).contratos).toEqual([]);

    await lidera(e.companero, e.alfa);
    await entrarComo(context, e.companero);
    let l = await lista(context);
    expect(l.contratos.map((x) => x.id)).toEqual([enAlfa]);
    expect(l.contratos[0].puedeEditar).toBe(false); // lidera, pero no tiene la concesion
    expect(JSON.stringify(l)).not.toContain(`Beta ${e.sufijo}`);
    expect((await context.request.get(`/api/finanzas/contratos/${enBeta}`)).status()).toBe(404);

    await conceder(e.companero, e.beta, "contracts"); // editar Beta tambien la hace visible
    l = await lista(context);
    expect(l.contratos.map((x) => x.id).sort()).toEqual([enAlfa, enBeta].sort());
    expect(l.contratos.find((x) => x.id === enBeta)?.puedeEditar).toBe(true);
    expect(l.contratos.find((x) => x.id === enAlfa)?.puedeEditar).toBe(false);

    // Pedir una unidad que no ve no la revela: lista vacia.
    await entrarComo(context, e.ajeno);
    expect((await lista(context, `?unidad=${e.alfa}`)).contratos).toEqual([]);
  });

  test("un lider de gerentes ve lo de su cadena", async ({ context }) => {
    const e = await escenario("con-cadena");
    const c = await cliente(e);
    await sql("INSERT INTO contracts (client_id, area_id, contract_type, amount, start_date, end_date, created_at, updated_at) VALUES ($1, $2, 'Fee', 500, '2026-01-01', '2026-12-31', now(), now())", [c.id, e.alfa]);
    await lidera(e.companero, e.alfa);
    await sql("UPDATE users SET manager_id = $1 WHERE id = $2", [e.empleado, e.companero]);
    await entrarComo(context, e.empleado);
    expect((await lista(context)).contratos).toHaveLength(1);
  });

  test("por año: solo los contratos que lo tocan, con su aporte mes a mes", async ({ browser }) => {
    const { ctx } = await contextoCon(browser, ADMIN);
    const e = await escenario("con-anio");
    const c = await cliente(e);
    const nuevo = (monto: number, ini: string, fin: string, tipo = "Fee") => sql("INSERT INTO contracts (client_id, area_id, contract_type, amount, start_date, end_date, created_at, updated_at) VALUES ($1, $2, $5, $3, $4::date, $6::date, now(), now())", [c.id, e.alfa, monto, ini, tipo, fin]);
    await nuevo(12000, "2025-10-01", "2026-09-30"); // 12 meses: 9 en 2026, 3 en 2025
    await nuevo(600, "2024-01-01", "2024-12-31"); // no toca 2026
    await nuevo(300, "2026-03-15", "2026-05-02", "Proyecto"); // marzo a mayo: 3 meses
    const url = `?anio=2026&unidad=${e.alfa}`;
    const l = await lista(ctx, url);
    expect(l.contratos).toHaveLength(2);
    const largo = l.contratos.find((x) => x.monto === 12000)!;
    expect(largo.anio?.total).toBe(9000);
    expect(largo.anio?.meses).toEqual([1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 0, 0, 0].map((x, i) => (i < 9 ? x : 0)));
    expect(largo.meses).toBe(12);
    expect(largo.porMes).toBe(1000);
    const corto = l.contratos.find((x) => x.monto === 300)!;
    expect(corto.anio?.meses).toEqual([0, 0, 100, 100, 100, 0, 0, 0, 0, 0, 0, 0]);
    expect(await lista(ctx, `${url}&tipo=Proyecto`).then((r) => r.contratos.map((x) => x.monto))).toEqual([300]);
    expect((await lista(ctx, `?anio=2025&unidad=${e.alfa}`)).contratos.map((x) => x.anio?.total).sort()).toEqual([3000]);
    expect((await ctx.request.get("/api/finanzas/contratos?anio=1900")).status()).toBe(400);
  });
});

test.describe("clientes y unidades con contratos", () => {
  test("no se puede borrar un cliente ni una unidad con contratos; unir clientes los lleva", async ({ browser }) => {
    const { ctx } = await contextoCon(browser, ADMIN);
    const e = await escenario("con-borrado");
    const a = await cliente(e, "Origen");
    const b = await cliente(e, "Destino");
    const [{ id }] = await sql<{ id: number }>("INSERT INTO contracts (client_id, area_id, contract_type, amount, start_date, end_date, created_at, updated_at) VALUES ($1, $2, 'Fee', 100, '2026-01-01', '2026-06-30', now(), now()) RETURNING id", [a.id, e.alfa]);

    const sinCliente = await ctx.request.delete(`/api/admin/clientes/${a.id}`);
    expect(sinCliente.status()).toBe(409);
    expect((await sinCliente.json()).error).toContain("contrato");

    // Alfa tiene personas y tareas ademas: la unidad se protege igual, y se nombran los contratos.
    const unidadSola = (await sql<{ id: number }>("INSERT INTO areas (name, description, created_at) VALUES ($1, '', now()) RETURNING id", [`Sola ${e.sufijo}`]))[0].id;
    await sql("INSERT INTO contracts (client_id, area_id, contract_type, amount, start_date, end_date, created_at, updated_at) VALUES ($1, $2, 'Fee', 100, '2026-01-01', '2026-06-30', now(), now())", [a.id, unidadSola]);
    const sinUnidad = await ctx.request.delete(`/api/admin/unidades/${unidadSola}`);
    expect(sinUnidad.status()).toBe(409);
    expect((await sinUnidad.json()).error).toContain("1 contrato(s)");

    const unir = await ctx.request.post(`/api/admin/clientes/${a.id}/unir`, { data: { destinoId: b.id } });
    expect(unir.status(), await unir.text()).toBe(200);
    expect((await fila(id)).client_id).toBe(b.id);
    expect((await sql("SELECT 1 FROM clients WHERE id = $1", [a.id])).length).toBe(0);
  });
});

test.describe("metas", () => {
  type Metas = { anio: number; sumaUnidades: number; total: { monto: number; calculada: boolean }; direccion: { monto: number; puedeEditar: boolean } | null; unidades: { unidadId: number; nombre: string; monto: number; puedeEditar: boolean }[] };
  const metas = async (ctx: BrowserContext, anio = 2026) => (await (await ctx.request.get(`/api/finanzas/metas?anio=${anio}`)).json()) as Metas;
  const poner = (ctx: BrowserContext, cuerpo: Record<string, unknown>) => ctx.request.put("/api/finanzas/metas", { data: cuerpo });
  const guardada = async (anio: number, area: number | null) => (await sql<{ amount: string }>(area === null ? "SELECT amount FROM goals WHERE year = $1 AND area_id IS NULL" : "SELECT amount FROM goals WHERE year = $1 AND area_id = $2", area === null ? [anio] : [anio, area]))[0]?.amount;

  test("con la concesion de metas de esa unidad: fija, actualiza y quita", async ({ context }) => {
    const e = await escenario("met-fijar");
    await conceder(e.empleado, e.alfa, "goals");
    await entrarComo(context, e.empleado);
    expect((await poner(context, { anio: 2026, unidadId: e.alfa, monto: 250000 })).status()).toBe(200);
    expect(await guardada(2026, e.alfa)).toBe("250000.00");
    expect((await poner(context, { anio: 2026, unidadId: e.alfa, monto: "300000,50" })).status()).toBe(200);
    expect(await guardada(2026, e.alfa)).toBe("300000.50");
    expect(Number((await sql<{ n: string }>("SELECT count(*) n FROM goals WHERE year = 2026 AND area_id = $1", [e.alfa]))[0].n)).toBe(1);
    expect(await guardada(2027, e.alfa)).toBeUndefined(); // otro año, otra meta
    const m = await metas(context);
    expect(m.unidades.find((u) => u.unidadId === e.alfa)).toMatchObject({ monto: 300000.5, puedeEditar: true });
    expect((await poner(context, { anio: 2026, unidadId: e.alfa, monto: 0 })).status()).toBe(200);
    expect(await guardada(2026, e.alfa)).toBeUndefined();
    const [log] = await sql<{ detail: string }>("SELECT detail FROM activity_logs WHERE action = 'goal_set' AND user_id = $1 ORDER BY id DESC LIMIT 1", [e.empleado]);
    expect(log.detail).toContain("US$0");
  });

  test("la concesion de contratos no sirve para metas, ni la de una unidad para otra", async ({ context }) => {
    const e = await escenario("met-permiso");
    await conceder(e.empleado, e.alfa, "contracts");
    await conceder(e.empleado, e.beta, "goals");
    await entrarComo(context, e.empleado);
    expect((await poner(context, { anio: 2026, unidadId: e.alfa, monto: 1 })).status()).toBe(403); // la ve (edita contratos) pero no sus metas
    expect(await guardada(2026, e.alfa)).toBeUndefined();
    expect((await poner(context, { anio: 2026, unidadId: e.beta, monto: 1 })).status()).toBe(200);
    await entrarComo(context, e.ajeno);
    expect((await poner(context, { anio: 2026, unidadId: e.alfa, monto: 1 })).status()).toBe(404);
    expect((await poner(context, { anio: 2026, unidadId: 99999999, monto: 1 })).status()).toBe(404);
  });

  test("rechaza lo invalido", async ({ context }) => {
    const e = await escenario("met-invalido");
    await conceder(e.empleado, e.alfa, "goals");
    await entrarComo(context, e.empleado);
    for (const cuerpo of [
      { unidadId: e.alfa, monto: 1 }, { anio: 1999, unidadId: e.alfa, monto: 1 }, { anio: "x", unidadId: e.alfa, monto: 1 },
      { anio: 2026, unidadId: e.alfa, monto: -1 }, { anio: 2026, unidadId: e.alfa, monto: "mucho" }, { anio: 2026, unidadId: e.alfa }, { anio: 2026, unidadId: e.alfa, monto: 1e12 },
      { anio: 2026, unidadId: "abc", monto: 1 }, { anio: 2026, unidadId: -3, monto: 1 },
    ]) {
      expect((await poner(context, cuerpo)).status(), JSON.stringify(cuerpo)).toBe(400);
    }
    expect(await guardada(2026, e.alfa)).toBeUndefined();
  });

  test("solo ve las metas de sus unidades; las de otras no aparecen ni por nombre", async ({ browser, context }) => {
    const { ctx } = await contextoCon(browser, ADMIN);
    const e = await escenario("met-ver");
    await poner(ctx, { anio: 2026, unidadId: e.alfa, monto: 111 });
    await poner(ctx, { anio: 2026, unidadId: e.beta, monto: 222 });
    await lidera(e.empleado, e.alfa);
    await entrarComo(context, e.empleado);
    const m = await metas(context);
    expect(m.unidades.map((u) => u.unidadId)).toEqual([e.alfa]);
    expect(m.unidades[0]).toMatchObject({ monto: 111, puedeEditar: false });
    expect(m.direccion).toBeNull();
    expect(JSON.stringify(m)).not.toContain("222");
    expect(JSON.stringify(m)).not.toContain(`Beta ${e.sufijo}`);
    expect((await context.request.get("/api/finanzas/metas?anio=1800")).status()).toBe(400);
  });

  test("la meta total se calcula: es la suma de las unidades que ve cada quien, y solo un valor fijado la reemplaza", async ({ browser, context }) => {
    const { ctx } = await contextoCon(browser, ADMIN);
    const e = await escenario("met-suma");
    await poner(ctx, { anio: 2032, unidadId: e.alfa, monto: 1000 });
    await poner(ctx, { anio: 2032, unidadId: e.beta, monto: 500.5 });

    await lidera(e.empleado, e.alfa); // su cadena: solo Alfa
    await entrarComo(context, e.empleado);
    let m = await metas(context, 2032);
    expect(m.sumaUnidades).toBe(1000);
    expect(m.total).toEqual({ monto: 1000, calculada: true });
    expect(m.direccion).toBeNull(); // nadie tecleo nada: no hay valor fijado que ver

    await lidera(e.empleado, e.beta); // ahora su cadena suma las dos
    m = await metas(context, 2032);
    expect(m.total).toEqual({ monto: 1500.5, calculada: true });

    // Cambiar una unidad cambia el total sin tocar nada mas.
    await poner(ctx, { anio: 2032, unidadId: e.beta, monto: 2000 });
    expect((await metas(context, 2032)).total.monto).toBe(3000);

    // Un valor fijado a mano solo lo ve quien ve todas las unidades; para el resto sigue siendo la suma.
    await poner(ctx, { anio: 2032, unidadId: null, monto: 9999 });
    expect((await metas(context, 2032)).total).toEqual({ monto: 3000, calculada: true });
    const admin = await metas(ctx, 2032);
    expect(admin.total).toEqual({ monto: 9999, calculada: false });
    expect(admin.direccion).toMatchObject({ monto: 9999, puedeEditar: true });
    // Quitarlo (monto 0) vuelve a la suma.
    await poner(ctx, { anio: 2032, unidadId: null, monto: 0 });
    expect((await metas(ctx, 2032)).direccion?.monto).toBe(0);
    expect((await metas(ctx, 2032)).total.calculada).toBe(true);
  });

  test("la meta de la direccion: la fija solo Administracion y la ve quien ve todas las unidades", async ({ browser, context }) => {
    const { ctx } = await contextoCon(browser, ADMIN);
    const e = await escenario("met-direccion");
    expect((await poner(ctx, { anio: 2031, unidadId: null, monto: 5000000 })).status()).toBe(200);
    expect(await guardada(2031, null)).toBe("5000000.00");
    expect((await poner(ctx, { anio: 2031, unidadId: null, monto: 6000000 })).status()).toBe(200); // actualiza, no duplica
    expect(Number((await sql<{ n: string }>("SELECT count(*) n FROM goals WHERE year = 2031 AND area_id IS NULL"))[0].n)).toBe(1);
    expect((await metas(ctx, 2031)).direccion).toMatchObject({ monto: 6000000, puedeEditar: true });

    await entrarComo(context, e.empleado); // no ve todas
    expect((await metas(context, 2031)).direccion).toBeNull();
    expect((await poner(context, { anio: 2031, unidadId: null, monto: 1 })).status()).toBe(404);

    await sql("INSERT INTO finance_grants (user_id, area_id, kind, created_at) SELECT $1, id, 'goals', now() FROM areas ON CONFLICT DO NOTHING", [e.empleado]);
    expect((await metas(context, 2031)).direccion).toMatchObject({ monto: 6000000, puedeEditar: false }); // ve todas: la ve, no la fija
    expect((await poner(context, { anio: 2031, unidadId: null, monto: 1 })).status()).toBe(403);
    expect(await guardada(2031, null)).toBe("6000000.00");
  });
});
