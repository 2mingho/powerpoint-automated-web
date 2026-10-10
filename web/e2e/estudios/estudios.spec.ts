import { expect, test, type BrowserContext } from "@playwright/test";
import { escenario, entrarComo, HOY, sql, sumarDias } from "../tareas/apoyo";
import { ADMIN, contextoCon } from "../admin/ayuda";

/*
 * Estudios por fases: una tarea de tipo "estudio" que contiene sus pasos como tareas
 * hijas, con fase. Solo las unidades con "Hace estudios" los crean; el contenedor
 * no cuenta como tarea en ninguna lista ni cifra; el alcance es el de las tareas.
 */
test.beforeEach(() => {
  test.skip(test.info().project.name !== "escritorio", "contrato de API: una pasada basta");
  test.setTimeout(120_000);
});

type Esc = Awaited<ReturnType<typeof escenario>>;
type Paso = { id: number; titulo: string; fase: string; hecho: boolean; horas: number | null; inicio: string; entrega: string };
type Estudio = { id: number; titulo: string; cliente: string; metodo: string; responsableId: number; unidadId: number; entrega: string; pasos: Paso[]; avance: number; fases: { fase: string; estado: string; actual: boolean }[]; faseActual: string | null; abiertos: number; vencidos: number; siguiente: { id: number; entrega: string } | null; contrato: { visible: boolean; monto: number | null; tipo: string }; puedeEditar: boolean };

/* Un entorno con Alfa haciendo estudios (Beta no): empleado crea, companero lidera. */
async function conEstudios(prefijo: string) {
  const e = await escenario(prefijo);
  await sql("UPDATE areas SET has_studies = true WHERE id = $1", [e.alfa]);
  return e;
}
const cuerpo = (e: Esc, extra: Record<string, unknown> = {}) => ({ titulo: `Estudio ${e.sufijo}`, cliente: `Cliente ${e.sufijo}`, metodo: "Mixto", responsableId: e.companero, entrega: sumarDias(HOY, 40), ...extra });
const crear = (ctx: BrowserContext, d: Record<string, unknown>) => ctx.request.post("/api/estudios", { data: d });
const leer = async (ctx: BrowserContext, id: number) => (await (await ctx.request.get(`/api/estudios/${id}`)).json()) as Estudio;
const filasTarea = (id: number) => sql<{ id: number; title: string; task_type: string; phase: string | null; parent_task_id: number | null; estimated_hours: number | null; assignee_id: number; area_id: number; client_id: number | null; due_date: Date; start_date: Date | null; study_method: string | null }>("SELECT * FROM tasks WHERE id = $1 OR parent_task_id = $1 ORDER BY id", [id]);
const cuantosEstudios = async (e: Esc) => Number((await sql<{ n: string }>("SELECT count(*) n FROM tasks WHERE task_type = 'estudio' AND area_id = $1", [e.alfa]))[0].n);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const cerrar = (id: number) => sql("UPDATE tasks SET status = 'Completado', done_at = now() WHERE id = $1", [id]);

test.describe("crear", () => {
  test("crea el estudio y todos sus pasos, con fases, horas, fechas en secuencia y un solo aviso", async ({ context }) => {
    const e = await conEstudios("est-crear");
    await entrarComo(context, e.empleado);
    const r = await crear(context, cuerpo(e, { titulo: "Estudio de marca" }));
    expect(r.status(), await r.text()).toBe(201);
    const { id, pasos } = await r.json();
    expect(pasos).toBe(8); // Mixto: las siete fases y los dos campos

    const filas = await filasTarea(id);
    const [padre, ...hijas] = filas;
    expect(padre).toMatchObject({ task_type: "estudio", study_method: "Mixto", assignee_id: e.companero, area_id: e.alfa, parent_task_id: null });
    expect(iso(padre.due_date)).toBe(sumarDias(HOY, 40));
    expect(hijas).toHaveLength(8);
    expect(hijas.every((h) => h.task_type === "normal" && h.parent_task_id === id && h.assignee_id === e.companero && h.area_id === e.alfa && h.client_id === padre.client_id)).toBe(true);
    expect(hijas.map((h) => h.phase)).toEqual(["Propuesta", "Kick off", "Instrumentos", "Campo", "Campo", "Procesamiento", "Informe", "Presentación"]);
    expect(hijas[0].title).toBe("Estudio de marca · Propuesta");
    expect(hijas.every((h) => (h.estimated_hours ?? 0) > 0)).toBe(true);

    // Fechas: en secuencia, dias habiles, sin pasar de la entrega final, la ultima en ella (o el ultimo habil).
    const fechas = hijas.map((h) => [iso(h.start_date!), iso(h.due_date)]);
    for (let i = 0; i < fechas.length; i++) {
      expect(fechas[i][0] <= fechas[i][1]).toBe(true);
      expect(fechas[i][1] <= sumarDias(HOY, 40)).toBe(true);
      if (i) expect(fechas[i][0] >= fechas[i - 1][1]).toBe(true);
      for (const d of fechas[i]) expect([0, 6]).not.toContain(new Date(`${d}T12:00:00Z`).getUTCDay());
    }
    expect(Number((await sql<{ n: string }>("SELECT count(*) n FROM task_checklist_items WHERE task_id = ANY($1)", [hijas.map((h) => h.id)]))[0].n)).toBeGreaterThan(8);

    // Un aviso para quien lo lidera, no ocho; y queda en la actividad.
    const avisos = await sql<{ title: string; link_url: string }>("SELECT title, link_url FROM notifications WHERE user_id = $1 AND kind = 'task_assigned'", [e.companero]);
    expect(avisos).toHaveLength(1);
    expect(avisos[0].title).toContain("Estudio de marca");
    const [log] = await sql<{ detail: string }>("SELECT detail FROM activity_logs WHERE action = 'study_create' AND entity_id = $1", [id]);
    expect(log.detail).toContain("8 pasos");
  });

  test("el tipo decide los pasos de campo: cuantitativo y cualitativo omiten el del otro", async ({ context }) => {
    const e = await conEstudios("est-metodo");
    await entrarComo(context, e.empleado);
    for (const [metodo, omite] of [["Cuantitativo", "cualitativo"], ["Cualitativo", "cuantitativo"]] as const) {
      const { id, pasos } = await (await crear(context, cuerpo(e, { titulo: `E ${metodo}`, metodo }))).json();
      expect(pasos).toBe(7);
      const titulos = (await filasTarea(id)).map((f) => f.title.toLowerCase());
      expect(titulos.some((t) => t.includes(`campo ${omite}`))).toBe(false);
      expect(titulos.some((t) => t.includes("campo"))).toBe(true);
    }
  });

  test("la vista previa muestra los mismos pasos y fechas que se crean", async ({ context }) => {
    const e = await conEstudios("est-previa");
    await entrarComo(context, e.empleado);
    const entrega = sumarDias(HOY, 30);
    const previa = (await (await context.request.get(`/api/estudios/plan?metodo=Mixto&entrega=${entrega}&responsableId=${e.companero}`)).json()) as { pasos: { nombre: string; fase: string; horas: number; inicio: string; entrega: string }[] };
    const { id } = await (await crear(context, cuerpo(e, { entrega }))).json();
    const reales = (await filasTarea(id)).slice(1);
    expect(previa.pasos.map((p) => [p.fase, p.horas, p.inicio, p.entrega])).toEqual(reales.map((h) => [h.phase, h.estimated_hours, iso(h.start_date!), iso(h.due_date)]));
  });

  test("el plan de la unidad manda: sus plantillas con fase reemplazan al plan por defecto", async ({ context }) => {
    const e = await conEstudios("est-plan");
    for (const [nombre, fase, horas] of [["Armar la propuesta", "Propuesta", 3], ["Cierre y entrega", "Informe", 5]] as const) {
      await sql("INSERT INTO task_templates (area_id, created_by_id, name, payload_json, created_at) VALUES ($1, $2, $3, $4, now())", [e.alfa, e.empleado, nombre, JSON.stringify({ title: nombre, fase, horas, checklist: ["uno"] })]);
    }
    await entrarComo(context, e.empleado);
    const { id, pasos } = await (await crear(context, cuerpo(e))).json();
    expect(pasos).toBe(2);
    const hijas = (await filasTarea(id)).slice(1);
    expect(hijas.map((h) => [h.phase, h.estimated_hours])).toEqual([["Propuesta", 3], ["Informe", 5]]);
    expect(hijas[0].title).toContain("Armar la propuesta");
  });

  test("con monto, registra el contrato de tipo Proyecto de hoy a la entrega, solo con permiso", async ({ context, browser }) => {
    const e = await conEstudios("est-contrato");
    await entrarComo(context, e.empleado);
    const entrega = sumarDias(HOY, 60);
    const sin = await crear(context, cuerpo(e, { monto: 9000, entrega }));
    expect(sin.status()).toBe(403);
    expect(await cuantosEstudios(e)).toBe(0); // nada se creo
    expect(Number((await sql<{ n: string }>("SELECT count(*) n FROM contracts WHERE area_id = $1", [e.alfa]))[0].n)).toBe(0);

    await sql("INSERT INTO finance_grants (user_id, area_id, kind, created_at) VALUES ($1, $2, 'contracts', now())", [e.empleado, e.alfa]);
    const r = await crear(context, cuerpo(e, { titulo: "Con contrato", monto: "9000", entrega }));
    expect(r.status(), await r.text()).toBe(201);
    expect((await r.json()).contrato).toMatch(/por mes durante \d+ meses?/);
    const [c] = await sql<{ contract_type: string; amount: string; area_id: number; note: string; end_date: Date; start_date: Date }>("SELECT * FROM contracts WHERE area_id = $1", [e.alfa]);
    expect(c).toMatchObject({ contract_type: "Proyecto", amount: "9000.00", note: "Estudio: Con contrato" });
    expect([iso(c.start_date), iso(c.end_date)]).toEqual([HOY, entrega]);

    // Con permiso ve el contrato en el estudio; sin el, ni el monto ni que lo hay.
    const { id } = await r.json();
    expect((await leer(context, id)).contrato).toMatchObject({ visible: true, monto: 9000, tipo: "Proyecto" });
    await entrarComo(context, e.companero);
    expect((await leer(context, id)).contrato).toEqual({ visible: false, monto: null, tipo: "" });
    void browser;
  });

  test("rechaza lo invalido y no crea nada", async ({ context }) => {
    const e = await conEstudios("est-invalido");
    await entrarComo(context, e.empleado);
    for (const [motivo, cambio] of Object.entries({
      "sin nombre": { titulo: "  " }, "sin cliente": { cliente: "" }, "tipo": { metodo: "Mixto2" }, "sin tipo": { metodo: undefined },
      "sin responsable": { responsableId: null }, "responsable que no existe": { responsableId: 99999999 },
      "sin entrega": { entrega: "" }, "entrega invalida": { entrega: "2026-02-31" }, "entrega pasada": { entrega: sumarDias(HOY, -1) },
      "monto con entrega hoy": { monto: 100, entrega: HOY }, "monto invalido": { monto: "mucho" },
    })) {
      const r = await crear(context, cuerpo(e, cambio));
      expect([400, 403], motivo).toContain(r.status());
      expect(r.status(), motivo).not.toBe(201);
    }
    expect(await cuantosEstudios(e)).toBe(0);
  });
});

test.describe("quien puede", () => {
  test("una unidad que no hace estudios no los crea; Administracion si, para una que si", async ({ context, browser }) => {
    const e = await conEstudios("est-permiso");
    await entrarComo(context, e.ajeno); // de Beta, sin estudios
    const r = await crear(context, cuerpo(e, { responsableId: e.ajeno }));
    expect(r.status()).toBe(403);

    const { ctx: admin } = await contextoCon(browser, ADMIN);
    expect((await crear(admin, cuerpo(e, { responsableId: e.ajeno }))).status()).toBe(400); // la unidad del responsable no hace estudios
    expect((await crear(admin, cuerpo(e))).status()).toBe(201);
  });

  test("el responsable debe ser de una unidad que hace estudios y estar en el ambito", async ({ context }) => {
    const e = await conEstudios("est-responsable");
    await entrarComo(context, e.empleado);
    expect((await crear(context, cuerpo(e, { responsableId: e.ajeno }))).status()).toBe(400); // otra unidad
    await sql("UPDATE users SET is_active = false WHERE id = $1", [e.companero]);
    expect((await crear(context, cuerpo(e))).status()).toBe(400); // inactiva
  });

  test("sin sesion es 401 y sin la herramienta de tareas es 403", async ({ context, request }) => {
    const e = await conEstudios("est-acceso");
    expect((await request.get("/api/estudios")).status()).toBe(401);
    expect((await request.post("/api/estudios", { data: {} })).status()).toBe(401);
    await sql("UPDATE users SET allowed_tools = '[\"reports\"]' WHERE id = $1", [e.empleado]);
    await entrarComo(context, e.empleado);
    expect((await context.request.get("/api/estudios")).status()).toBe(403);
    expect((await crear(context, cuerpo(e))).status()).toBe(403);
  });
});

test.describe("el estudio no es una tarea mas", () => {
  test("el contenedor no sale en listas, contadores ni abre como tarea; los pasos si", async ({ context }) => {
    const e = await conEstudios("est-contenedor");
    await entrarComo(context, e.empleado);
    const { id } = await (await crear(context, cuerpo(e, { titulo: "Solo contenedor", entrega: sumarDias(HOY, 20) }))).json();
    const hijas = (await filasTarea(id)).slice(1);

    const lista = (await (await context.request.get("/api/tareas?alcance=unidad")).json()) as { tareas: { id: number; titulo: string; fase: string; estudio: { id: number; titulo: string } | null }[] };
    expect(lista.tareas.find((t) => t.id === id)).toBeUndefined();
    const pasos = lista.tareas.filter((t) => t.estudio?.id === id);
    expect(pasos).toHaveLength(hijas.length);
    expect(pasos[0]).toMatchObject({ fase: "Propuesta", estudio: { id, titulo: "Solo contenedor" } });

    expect((await context.request.get(`/api/tareas/${id}`)).status()).toBe(404);
    expect((await context.request.put(`/api/tareas/${id}`, { data: { title: "x" } })).status()).toBe(404);
    expect((await context.request.get(`/api/tareas/${hijas[0].id}`)).status()).toBe(200);
  });

  test("el Panel y las cifras cuentan los pasos, no el contenedor", async ({ context, page }) => {
    const e = await conEstudios("est-cifras");
    await entrarComo(context, e.empleado);
    await crear(context, cuerpo(e, { metodo: "Cuantitativo", entrega: sumarDias(HOY, 60) }));
    await page.goto("/?vista=panel&periodo=todo");
    await expect(page.getByRole("group", { name: "Cifras del panel" })).toContainText("Tareas");
    const t = await page.getByRole("group", { name: "Cifras del panel" }).getByText("Tareas", { exact: true }).first().locator("..").innerText();
    expect(t.split("\n").map((x) => x.trim()).filter(Boolean)[1]).toBe("7");
  });

  test("las tareas normales de siempre siguen igual: sin fase ni estudio", async ({ context }) => {
    const e = await conEstudios("est-normal");
    await e.tarea("Una tarea cualquiera", e.alfa, e.empleado, e.empleado);
    await entrarComo(context, e.empleado);
    const l = (await (await context.request.get("/api/tareas?alcance=unidad")).json()) as { tareas: { titulo: string; fase: string; estudio: unknown }[] };
    expect(l.tareas.find((t) => t.titulo === "Una tarea cualquiera")).toMatchObject({ fase: "", estudio: null });
  });
});

test.describe("leer", () => {
  test("avance ponderado por horas, estado de cada fase, siguiente entrega y vencidos", async ({ context }) => {
    const e = await conEstudios("est-leer");
    await entrarComo(context, e.empleado);
    const { id } = await (await crear(context, cuerpo(e, { metodo: "Cuantitativo", entrega: sumarDias(HOY, 50) }))).json();
    let s = await leer(context, id);
    expect(s).toMatchObject({ avance: 0, abiertos: 7, vencidos: 0, faseActual: "Propuesta", metodo: "Cuantitativo", puedeEditar: true });
    expect(s.siguiente?.entrega).toBeTruthy();
    expect(s.fases.map((f) => f.fase)).toEqual(["Propuesta", "Kick off", "Instrumentos", "Campo", "Procesamiento", "Informe", "Presentación"]);

    const [propuesta, kick] = s.pasos; // 8 h y 4 h
    await cerrar(propuesta.id);
    await cerrar(kick.id);
    s = await leer(context, id);
    const total = s.pasos.reduce((a, p) => a + (p.horas ?? 4), 0);
    expect(s.avance).toBeCloseTo((8 + 4) / total, 5);
    expect(s.fases.slice(0, 2).map((f) => f.estado)).toEqual(["completa", "completa"]);
    expect(s.faseActual).toBe("Instrumentos");
    expect(s.abiertos).toBe(5);

    // Un paso abierto con fecha pasada vuelve vencida su fase.
    await sql("UPDATE tasks SET due_date = $2 WHERE id = $1", [s.pasos[2].id, sumarDias(HOY, -3)]);
    s = await leer(context, id);
    expect(s.vencidos).toBe(1);
    expect(s.fases.find((f) => f.fase === "Instrumentos")?.estado).toBe("vencida");
    // "Siguiente" es la proxima entrega por delante; lo atrasado se cuenta aparte, en vencidos.
    expect(s.siguiente?.id).toBe(s.pasos[3].id);
  });

  test("la lista filtra abiertos y cerrados, y busca por nombre o cliente", async ({ context }) => {
    const e = await conEstudios("est-lista");
    await entrarComo(context, e.empleado);
    const a = await (await crear(context, cuerpo(e, { titulo: `Abierto ${e.sufijo}`, cliente: `Zeta ${e.sufijo}` }))).json();
    const b = await (await crear(context, cuerpo(e, { titulo: `Cerrado ${e.sufijo}`, cliente: `Ypsilon ${e.sufijo}` }))).json();
    for (const h of (await filasTarea(b.id)).slice(1)) await cerrar(h.id);
    const lista = async (q: string) => ((await (await context.request.get(`/api/estudios?${q}`)).json()) as { estudios: Estudio[]; puedeCrear: boolean });
    const ids = async (q: string) => (await lista(q)).estudios.filter((x) => [a.id, b.id].includes(x.id)).map((x) => x.id);
    expect(await ids("estado=abiertos")).toEqual([a.id]);
    expect(await ids("estado=cerrados")).toEqual([b.id]);
    expect((await ids("estado=todos")).sort()).toEqual([a.id, b.id].sort());
    expect(await ids(`estado=todos&q=ypsilon ${e.sufijo}`)).toEqual([b.id]);
    expect((await lista("")).puedeCrear).toBe(true);
    expect((await leer(context, b.id)).avance).toBe(1);
  });

  test("solo ve los estudios de su ambito; los ajenos responden como si no existieran", async ({ context }) => {
    const e = await conEstudios("est-ambito");
    await sql("UPDATE areas SET has_studies = true WHERE id = $1", [e.beta]);
    await entrarComo(context, e.ajeno);
    const mio = await (await crear(context, cuerpo(e, { responsableId: e.ajeno, titulo: "De Beta" }))).json();
    await entrarComo(context, e.empleado);
    const nuestro = await (await crear(context, cuerpo(e, { titulo: "De Alfa" }))).json();

    const lista = (await (await context.request.get("/api/estudios?estado=todos")).json()) as { estudios: Estudio[] };
    expect(lista.estudios.map((s) => s.id)).toContain(nuestro.id);
    expect(lista.estudios.map((s) => s.id)).not.toContain(mio.id);
    expect(JSON.stringify(lista)).not.toContain("De Beta");
    const ajeno = await context.request.get(`/api/estudios/${mio.id}`);
    const inexistente = await context.request.get("/api/estudios/99999999");
    expect(ajeno.status()).toBe(404);
    expect(await ajeno.json()).toEqual(await inexistente.json());
    expect((await context.request.patch(`/api/estudios/${mio.id}`, { data: { titulo: "x" } })).status()).toBe(404);
    expect((await context.request.delete(`/api/estudios/${mio.id}`)).status()).toBe(404);
    // Un paso no es un estudio.
    const paso = (await filasTarea(nuestro.id))[1];
    expect((await context.request.get(`/api/estudios/${paso.id}`)).status()).toBe(404);
  });
});

test.describe("editar y borrar", () => {
  test("cambia nombre, cliente y responsable; el cliente y el responsable llegan a los pasos abiertos, no a los cerrados", async ({ context }) => {
    const e = await conEstudios("est-editar");
    await entrarComo(context, e.empleado);
    const { id } = await (await crear(context, cuerpo(e, { metodo: "Cuantitativo" }))).json();
    const s0 = await leer(context, id);
    await cerrar(s0.pasos[0].id);

    const r = await context.request.patch(`/api/estudios/${id}`, { data: { titulo: "Nuevo nombre", cliente: `Otro ${e.sufijo}`, responsableId: e.empleado } });
    expect(r.status(), await r.text()).toBe(200);
    const s = (await r.json()) as Estudio;
    expect(s).toMatchObject({ titulo: "Nuevo nombre", cliente: `Otro ${e.sufijo}`, responsableId: e.empleado });
    const filas = await filasTarea(id);
    const abiertas = filas.slice(1).filter((h) => h.id !== s0.pasos[0].id);
    expect(abiertas.every((h) => h.assignee_id === e.empleado && h.client_id === filas[0].client_id)).toBe(true);
    const cerrada = filas.find((h) => h.id === s0.pasos[0].id)!;
    expect(cerrada.assignee_id).toBe(e.companero); // lo ya hecho no cambia de manos
    expect(cerrada.client_id).not.toBe(filas[0].client_id);
    const [log] = await sql<{ detail: string }>("SELECT detail FROM activity_logs WHERE action = 'study_update' AND entity_id = $1 ORDER BY id DESC LIMIT 1", [id]);
    expect(log.detail).toContain("nombre:");
  });

  test("rechaza cambios invalidos sin tocar nada", async ({ context }) => {
    const e = await conEstudios("est-editar-mal");
    await entrarComo(context, e.empleado);
    const { id } = await (await crear(context, cuerpo(e))).json();
    for (const cambio of [{ titulo: " " }, { cliente: "" }, { metodo: "x" }, { entrega: "2026-13-01" }, { responsableId: e.ajeno }, { responsableId: 99999999 }]) {
      expect((await context.request.patch(`/api/estudios/${id}`, { data: cambio })).status(), JSON.stringify(cambio)).toBe(400);
    }
    expect((await leer(context, id)).titulo).toBe(`Estudio ${e.sufijo}`);
  });

  test("borrar quita el estudio y todos sus pasos; deshacer los devuelve", async ({ context }) => {
    const e = await conEstudios("est-borrar");
    await entrarComo(context, e.empleado);
    const { id } = await (await crear(context, cuerpo(e))).json();
    const hijas = (await filasTarea(id)).slice(1);
    const d = await context.request.delete(`/api/estudios/${id}`);
    expect(d.status()).toBe(200);
    expect((await d.json()).pasos).toBe(hijas.length);
    expect((await context.request.get(`/api/estudios/${id}`)).status()).toBe(404);
    expect((await context.request.get(`/api/tareas/${hijas[0].id}`)).status()).toBe(404);
    expect(Number((await sql<{ n: string }>("SELECT count(*) n FROM tasks WHERE (id = $1 OR parent_task_id = $1) AND deleted_at IS NULL", [id]))[0].n)).toBe(0);

    const r = await context.request.post(`/api/tareas/${id}/restaurar`);
    expect(r.status(), await r.text()).toBe(200);
    expect((await leer(context, id)).pasos).toHaveLength(hijas.length);
  });
});

test.describe("administracion y plantillas", () => {
  test("Administracion marca que unidades hacen estudios", async ({ browser }) => {
    const { ctx } = await contextoCon(browser, ADMIN);
    const e = await escenario("est-admin");
    const marca = async (v: unknown) => ctx.request.patch(`/api/admin/unidades/${e.alfa}`, { data: { tieneEstudios: v } });
    expect((await marca(true)).status()).toBe(200);
    expect((await sql<{ has_studies: boolean }>("SELECT has_studies FROM areas WHERE id = $1", [e.alfa]))[0].has_studies).toBe(true);
    const org = (await (await ctx.request.get("/api/admin/unidades")).json()) as { unidades: { id: number; tieneEstudios: boolean }[] };
    expect(org.unidades.find((u) => u.id === e.alfa)?.tieneEstudios).toBe(true);
    expect((await marca("si")).status()).toBe(400);
    expect((await marca(false)).status()).toBe(200);
    // Guardar otros datos sin mencionarlo no lo cambia.
    await marca(true);
    expect((await ctx.request.patch(`/api/admin/unidades/${e.alfa}`, { data: { descripcion: "x" } })).status()).toBe(200);
    expect((await sql<{ has_studies: boolean }>("SELECT has_studies FROM areas WHERE id = $1", [e.alfa]))[0].has_studies).toBe(true);
  });

  test("una plantilla con fase solo existe en unidades con estudios, con fase, horas y tipo validos", async ({ context }) => {
    const e = await conEstudios("est-plantilla");
    const base = { title: "Paso", priority: "Media", checklist: [] };
    const nueva = (payload: Record<string, unknown>) => context.request.post("/api/tareas/plantillas", { data: { name: `P ${Math.random()}`, payload: { ...base, ...payload } } });
    await entrarComo(context, e.ajeno); // Beta no hace estudios
    expect((await nueva({ fase: "Campo", horas: 4 })).status()).toBe(400);
    expect((await nueva({})).status()).toBe(201); // sin fase, normal

    await entrarComo(context, e.empleado);
    const ok = await nueva({ fase: "Campo", horas: "12,5", metodo: "Cuantitativo" });
    expect(ok.status(), await ok.text()).toBe(201);
    expect((await ok.json()).plantilla.datos).toMatchObject({ fase: "Campo", horas: 12.5, metodo: "Cuantitativo" });
    for (const malo of [{ fase: "Inventada", horas: 4 }, { fase: "Campo", horas: 0 }, { fase: "Campo", horas: "x" }, { fase: "Informe", horas: 4, metodo: "Cuantitativo" }, { fase: "Campo", horas: 4, metodo: "Mixto" }]) {
      expect((await nueva(malo)).status(), JSON.stringify(malo)).toBe(400);
    }
  });
});
