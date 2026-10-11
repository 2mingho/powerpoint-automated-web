import ExcelJS from "exceljs";
import { expect, test, type BrowserContext } from "@playwright/test";
import { idDeCorreo } from "../comun";
import { BASE, entrarComo, escenario, sql } from "./apoyo";

/*
 * Horas extras de la unidad (el reporte de Media Watch): las registra quien la LIDERA, solo si un administrador activó
 * las horas extras de la unidad; quien la supervisa solo las ve. Hay un maximo por persona y trimestre que AVISA.
 * Las fechas son fijas (septiembre de 2026): el 12 y el 13 caen en sabado y domingo.
 */
test.beforeEach(({}, info) => { test.skip(info.project.name !== "escritorio", "Una vez basta, en escritorio."); });

type Esc = Awaited<ReturnType<typeof escenario>>;

async function nuevaPersona(e: Esc, nombre: string, area: number | null, manager: number | null = null) {
  return (await sql<{ id: number }>("INSERT INTO users (username, email, password, role, is_active, created_at, area_id, manager_id, allowed_tools, tour_completed_at) SELECT $1, $2, password, 'DI', true, now(), $3, $4, '[\"tasks\"]', now() FROM users WHERE id = $5 RETURNING id",
    [`${nombre}.${e.sufijo}`, `${nombre}.${e.sufijo}@e2e.test`, area, manager, e.empleado]))[0].id;
}

async function conGerente(activa = true) {
  const e = await escenario("he");
  const director = await nuevaPersona(e, "director", null);
  const gerente = await nuevaPersona(e, "gerente", e.alfa, director);
  await sql("INSERT INTO unit_leads (user_id, area_id) VALUES ($1, $2)", [gerente, e.alfa]);
  if (activa) await sql("UPDATE areas SET has_overtime = true, overtime_limit = 80 WHERE id = $1", [e.alfa]);
  return { e, gerente, director };
}

async function api(contexto: BrowserContext, userId: number) {
  await entrarComo(contexto, userId);
  return contexto.request;
}
const registro = (personaId: number, o: Record<string, unknown> = {}) => ({ personaId, fecha: "2026-09-14", detalle: "Cobertura medios", horario: "08:00-11:00 PM", horas: 3, ...o });
const P = (anio: number, mes: number, mitad: 15 | 30) => ({ anio, mes, mitad });
/* Dias de la 1ra quincena registrados en la 2da: se reporta tarde, como en el Excel de MW. */
const TARDE = { periodo: P(2026, 9, 30) };
const pedir = async (r: BrowserContext["request"], unidad: number, periodo = P(2026, 9, 30)) =>
  (await (await r.get(`${BASE}/api/horas-extras?unidad=${unidad}&anio=${periodo.anio}&mes=${periodo.mes}&mitad=${periodo.mitad}`)).json());

test.describe("API de horas extras", () => {
  test("el gerente registra y el reporte segmenta L-V / SAB-DOM, con totales por persona y colaboradores", async ({ context }) => {
    const { e, gerente } = await conGerente();
    const r = await api(context, gerente);
    const post = async (o: Record<string, unknown>) => {
      const res = await r.post(`${BASE}/api/horas-extras`, { data: o });
      expect(res.status(), await res.text()).toBe(201);
      return res.json();
    };
    await post(registro(e.empleado, { fecha: "2026-09-14", horas: 3, ...TARDE }));
    await post(registro(e.empleado, { fecha: "2026-09-12", horas: "6,5", detalle: "Cobertura sábado", ...TARDE })); // sabado
    await post(registro(e.companero, { fecha: "2026-09-13", horas: 2.5, ...TARDE })); // domingo
    await post(registro(e.companero, { fecha: "2026-09-16", horas: 1 })); // su reporte es el de su fecha: la 2da
    // Este cae en la 1ra quincena y se queda en ella: no entra en el reporte de la 2da.
    await post(registro(e.companero, { fecha: "2026-09-02", horas: 4 }));

    const d = await pedir(r, e.alfa);
    expect(d.puedeEditar).toBe(true);
    expect(d.rotulo).toBe("2DA. QUINCENA DE SEPTIEMBRE 2026");
    expect(d.reporte).toMatchObject({ total: 13, laborables: 4, finDeSemana: 9, colaboradores: 2 });
    const emp = d.reporte.bloques.find((b: { personaId: number }) => b.personaId === e.empleado);
    expect(emp).toMatchObject({ laborables: 3, finDeSemana: 6.5, total: 9.5 });
    expect(emp.filas.map((f: { fecha: string; finDeSemana: boolean }) => [f.fecha, f.finDeSemana])).toEqual([["2026-09-12", true], ["2026-09-14", false]]);
    // La matriz del trimestre cuenta las dos quincenas de septiembre.
    expect(d.matriz.filas.find((f: { personaId: number }) => f.personaId === e.companero).total).toBe(7.5);
    expect(d.personas.map((p: { id: number }) => p.id).sort()).toEqual([e.companero, e.empleado, gerente].sort());
  });

  test("el máximo del trimestre avisa pero no bloquea, y el mapa lo marca", async ({ context }) => {
    const { e, gerente } = await conGerente();
    const r = await api(context, gerente);
    const post = async (horas: number, fecha: string) => (await (await r.post(`${BASE}/api/horas-extras`, { data: registro(e.empleado, { horas, fecha }) })).json());
    expect(await post(24, "2026-07-06")).toMatchObject({ horasTrimestre: 24, limite: 80, aviso: "" });
    expect(await post(24, "2026-07-07")).toMatchObject({ horasTrimestre: 48, aviso: "" });
    expect(await post(24, "2026-08-04")).toMatchObject({ horasTrimestre: 72, aviso: "cerca" });
    expect(await post(8, "2026-08-05")).toMatchObject({ horasTrimestre: 80, aviso: "cerca" }); // justo en el maximo
    const pasado = await post(2.5, "2026-09-01");
    expect(pasado).toMatchObject({ horasTrimestre: 82.5, aviso: "excedido" }); // se guardó igual
    const d = await pedir(r, e.alfa, P(2026, 9, 15));
    const f = d.matriz.filas.find((x: { personaId: number }) => x.personaId === e.empleado);
    expect(f).toMatchObject({ total: 82.5, restante: -2.5, aviso: "excedido", nivel: 4 });
    expect(f.celdas.map((c: { horas: number }) => c.horas)).toEqual([48, 0, 32, 0, 2.5, 0]);
    // Otro trimestre empieza de cero.
    const otro = await post(5, "2026-10-05");
    expect(otro).toMatchObject({ horasTrimestre: 5, aviso: "" });
  });

  test("se puede registrar tarde en un reporte posterior, nunca por adelantado ni a más de seis meses", async ({ context }) => {
    const { e, gerente } = await conGerente();
    const r = await api(context, gerente);
    // Dias de finales de agosto en la 2da quincena de septiembre, como el Excel de MW.
    const ok = await r.post(`${BASE}/api/horas-extras`, { data: registro(e.empleado, { fecha: "2026-08-31", periodo: P(2026, 9, 30) }) });
    expect(ok.status()).toBe(201);
    expect((await pedir(r, e.alfa)).reporte.total).toBe(3);
    expect((await pedir(r, e.alfa, P(2026, 8, 30))).reporte.total).toBe(0);
    for (const [fecha, periodo, texto] of [
      ["2026-09-16", P(2026, 9, 15), /anterior/], ["2026-09-16", P(2026, 8, 30), /anterior/], ["2026-01-02", P(2025, 12, 30), /anterior/], ["2026-08-31", P(2027, 3, 15), /seis meses/],
      ["2026-08-31", { anio: 2026, mes: 13, mitad: 15 }, /mes/], ["2026-08-31", { anio: 2026, mes: 9, mitad: 20 }, /quincena/],
    ] as const) {
      const res = await r.post(`${BASE}/api/horas-extras`, { data: registro(e.empleado, { fecha, periodo }) });
      expect(res.status(), `${fecha} ${JSON.stringify(periodo)}`).toBe(400);
      expect((await res.json()).error).toMatch(texto);
    }
  });

  test("valida horas, día y detalle", async ({ context }) => {
    const { e, gerente } = await conGerente();
    const r = await api(context, gerente);
    for (const [malo, texto] of [
      [{ horas: 0 }, /horas/i], [{ horas: 25 }, /24/], [{ horas: "1.234" }, /horas/i], [{ horas: "abc" }, /horas/i], [{ fecha: "2026-02-30" }, /día/], [{ detalle: " " }, /Describe/],
      [{ detalle: "x".repeat(301) }, /300/], [{ horario: "x".repeat(121) }, /120/],
    ] as const) {
      const res = await r.post(`${BASE}/api/horas-extras`, { data: registro(e.empleado, malo) });
      expect(res.status(), JSON.stringify(malo)).toBe(400);
      expect((await res.json()).error, JSON.stringify(malo)).toMatch(texto);
    }
  });

  test("edita y borra; las horas pasan al trimestre del reporte nuevo", async ({ context }) => {
    const { e, gerente } = await conGerente();
    const r = await api(context, gerente);
    const id = (await (await r.post(`${BASE}/api/horas-extras`, { data: registro(e.empleado, { fecha: "2026-09-14", horas: 3 }) })).json()).id as number;
    const ed = await (await r.patch(`${BASE}/api/horas-extras/${id}`, { data: { horas: 10, detalle: "Cobertura ampliada", periodo: P(2026, 10, 15) } })).json();
    expect(ed).toMatchObject({ horasTrimestre: 10 }); // el trimestre 4
    expect((await pedir(r, e.alfa, P(2026, 9, 15))).reporte.total).toBe(0);
    expect((await pedir(r, e.alfa, P(2026, 10, 15))).reporte.total).toBe(10);
    // La persona no se cambia por edicion.
    await r.patch(`${BASE}/api/horas-extras/${id}`, { data: { personaId: e.companero } });
    expect((await sql<{ user_id: number }>("SELECT user_id FROM overtime_entries WHERE id = $1", [id]))[0].user_id).toBe(e.empleado);
    expect((await r.delete(`${BASE}/api/horas-extras/${id}`)).status()).toBe(200);
    expect((await pedir(r, e.alfa, P(2026, 10, 15))).reporte.total).toBe(0);
    expect((await r.delete(`${BASE}/api/horas-extras/${id}`)).status()).toBe(404);
    expect((await sql<{ n: string }>("SELECT count(*) n FROM activity_logs WHERE action IN ('overtime_create','overtime_edit','overtime_delete') AND user_id = $1", [gerente]))[0].n).toBe("4");
  });

  test("quién ve y quién edita: dirección solo ve; la gente de la unidad, otras unidades y unidades sin horas extras, nada", async ({ context, browser }) => {
    const { e, gerente, director } = await conGerente();
    const id = (await (await (await api(context, gerente)).post(`${BASE}/api/horas-extras`, { data: registro(e.empleado, TARDE) })).json()).id as number;

    const ctxDir = await browser.newContext();
    const rd = await api(ctxDir, director);
    const dd = await pedir(rd, e.alfa);
    expect(dd.puedeEditar).toBe(false);
    expect(dd.reporte.total).toBe(3);
    expect((await rd.post(`${BASE}/api/horas-extras`, { data: registro(e.empleado) })).status()).toBe(403);
    expect((await rd.patch(`${BASE}/api/horas-extras/${id}`, { data: { horas: 1 } })).status()).toBe(403);
    expect((await rd.delete(`${BASE}/api/horas-extras/${id}`)).status()).toBe(403);
    await ctxDir.close();

    // Una persona de la unidad, y el gerente de OTRA unidad que si lleva horas extras.
    const beta = await nuevaPersona(e, "gerentebeta", e.beta);
    await sql("INSERT INTO unit_leads (user_id, area_id) VALUES ($1, $2)", [beta, e.beta]);
    await sql("UPDATE areas SET has_overtime = true WHERE id = $1", [e.beta]);
    for (const quien of [e.companero, beta]) {
      const ctx = await browser.newContext();
      const r = await api(ctx, quien);
      const d = await pedir(r, e.alfa);
      expect(JSON.stringify(d), `persona ${quien}`).not.toContain("Cobertura medios");
      expect(d.unidades.some((u: { id: number }) => u.id === e.alfa)).toBe(false);
      expect((await r.post(`${BASE}/api/horas-extras`, { data: registro(e.empleado) })).status()).toBe(404);
      expect((await r.patch(`${BASE}/api/horas-extras/${id}`, { data: { horas: 1 } })).status()).toBe(404);
      expect((await r.delete(`${BASE}/api/horas-extras/${id}`)).status()).toBe(404);
      expect((await r.get(`${BASE}/api/horas-extras/exportar?unidad=${e.alfa}`)).status()).toBe(404);
      await ctx.close();
    }
  });

  test("sin horas extras activadas en la unidad, nadie las gestiona (ni el gerente) hasta que un administrador las active", async ({ context }) => {
    const { e, gerente } = await conGerente(false);
    const r = await api(context, gerente);
    expect((await pedir(r, e.alfa)).unidades).toEqual([]);
    expect((await r.post(`${BASE}/api/horas-extras`, { data: registro(e.empleado) })).status()).toBe(404);
    const adm = await api(context, await idDeCorreo("demo@local.test"));
    const res = await adm.patch(`${BASE}/api/admin/unidades/${e.alfa}`, { data: { tieneHorasExtras: true, limiteHorasExtras: "60" } });
    expect(res.status(), await res.text()).toBe(200);
    const r2 = await api(context, gerente);
    const d = await pedir(r2, e.alfa);
    expect(d.unidad).toMatchObject({ id: e.alfa, limite: 60 });
    expect((await r2.post(`${BASE}/api/horas-extras`, { data: registro(e.empleado) })).status()).toBe(201);
    // El maximo de la unidad manda: 60.
    const f = (await pedir(r2, e.alfa)).matriz.filas.find((x: { personaId: number }) => x.personaId === e.empleado);
    expect(f.limite).toBe(60);
  });

  test("el administrador valida el máximo y la unidad con registros no se elimina", async ({ context }) => {
    const { e, gerente } = await conGerente();
    await (await api(context, gerente)).post(`${BASE}/api/horas-extras`, { data: registro(e.empleado) });
    const adm = await api(context, await idDeCorreo("demo@local.test"));
    for (const malo of [0, -5, 401, "abc", 12.345]) {
      expect((await adm.patch(`${BASE}/api/admin/unidades/${e.alfa}`, { data: { limiteHorasExtras: malo } })).status(), String(malo)).toBe(400);
    }
    expect((await adm.patch(`${BASE}/api/admin/unidades/${e.alfa}`, { data: { tieneHorasExtras: "si" } })).status()).toBe(400);
    const vacia = await escenario("he-borrar");
    await sql("UPDATE users SET area_id = NULL WHERE area_id = $1", [vacia.alfa]);
    await sql("INSERT INTO overtime_entries (area_id, user_id, work_date, detail, hours, period_year, period_month, period_half, created_at, updated_at) VALUES ($1, $2, '2026-09-14', 'x', 1, 2026, 9, 15, now(), now())", [vacia.alfa, vacia.empleado]);
    const res = await adm.delete(`${BASE}/api/admin/unidades/${vacia.alfa}`);
    expect(res.status()).toBe(409);
    expect((await res.json()).error).toMatch(/horas extras/);
  });

  test("el Excel trae las dos hojas con los totales del reporte, y solo para quien lo ve", async ({ context }) => {
    const { e, gerente } = await conGerente();
    const r = await api(context, gerente);
    for (const [quien, fecha, horas] of [[e.empleado, "2026-09-14", 3], [e.empleado, "2026-09-12", 6.5], [e.companero, "2026-09-16", 1]] as const) {
      await r.post(`${BASE}/api/horas-extras`, { data: registro(quien, { fecha, horas, ...TARDE }) });
    }
    const res = await r.get(`${BASE}/api/horas-extras/exportar?unidad=${e.alfa}&anio=2026&mes=9&mitad=30`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("spreadsheetml");
    expect(res.headers()["content-disposition"]).toContain("attachment");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await res.body() as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["GENERALES", "2DA QUINCENA DE SEPTIEMBRE"]);
    const hoja = wb.getWorksheet("2DA QUINCENA DE SEPTIEMBRE")!;
    const v = hoja.getCell("A6").value as { result: number };
    expect(v.result).toBe(10.5);
    expect((hoja.getCell("C6").value as { result: number }).result).toBe(2);
    expect((await r.get(`${BASE}/api/horas-extras/exportar`)).status()).toBe(400);
  });
});

test.describe("pantalla de horas extras", () => {
  test("el gerente registra desde el diálogo, ve el mapa de calor y el aviso al pasar el máximo", async ({ context, page }) => {
    const { e, gerente } = await conGerente();
    // 70 h ya en el trimestre (un registro admite hasta 24 h).
    await sql("INSERT INTO overtime_entries (area_id, user_id, work_date, detail, hours, period_year, period_month, period_half, created_at, updated_at) SELECT $1, $2, d::date, 'Previas', h, 2026, 7, 15, now(), now() FROM (VALUES ('2026-07-08', 24), ('2026-07-09', 24), ('2026-07-10', 22)) v(d, h)", [e.alfa, e.empleado]);
    await entrarComo(context, gerente);
    await page.goto("/horas-extras?anio=2026&mes=9&mitad=30");
    await expect(page.getByRole("heading", { name: "Horas extras", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "Horas extras" }).first()).toBeVisible();
    await expect(page.getByText("Sin horas extras en este reporte")).toBeVisible();
    await expect(page.getByRole("img", { name: new RegExp(`empleado.${e.sufijo}, trimestre: 70 de 80 h`) })).toBeVisible();

    await page.getByRole("button", { name: "Registrar horas" }).first().click();
    const d = page.getByRole("dialog", { name: "Registrar horas extras" });
    await d.getByLabel("Persona").selectOption({ label: `empleado.${e.sufijo}` });
    await d.getByLabel("Día trabajado").fill("2026-09-12");
    await d.getByLabel("Horas").fill("12");
    await d.getByLabel("Horario").fill("6:00-12:30 PM");
    await d.getByLabel("Detalle").fill("Cubrir medios turno AM del sábado");
    await expect(d.getByText("SAB-DOM")).toBeVisible();
    await expect(d.getByText(/se pasaría del máximo de 80/)).toBeVisible();
    await d.getByRole("button", { name: "Registrar horas" }).click();

    await expect(page.locator("[data-horas]").filter({ hasText: "Cubrir medios turno AM del sábado" })).toBeVisible();
    await expect(page.getByText(/se pasó del máximo de 80/)).toBeVisible(); // el aviso al guardar
    await expect(page.getByRole("img", { name: new RegExp(`empleado.${e.sufijo}, trimestre: 82 de 80 h. Pasó del máximo`) })).toBeVisible();
    await expect(page.getByText("1 pasada del máximo")).toBeVisible();
    await expect(page.getByRole("group", { name: "Cifras del reporte" })).toContainText("12 h");
    expect((await sql<{ h: string }>("SELECT hours::text h FROM overtime_entries WHERE detail LIKE 'Cubrir medios%'"))[0].h).toBe("12.00");

    // Editar y borrar.
    await page.getByRole("button", { name: /Editar las horas de .* del 12\/09\/2026/ }).click();
    const ed = page.getByRole("dialog", { name: "Editar horas extras" });
    await ed.getByLabel("Horas").fill("2");
    await ed.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(page.getByRole("img", { name: new RegExp(`empleado.${e.sufijo}, trimestre: 72 de 80 h. Cerca del máximo`) })).toBeVisible();
    await page.getByRole("button", { name: /Eliminar las horas de .* del 12\/09\/2026/ }).click();
    await page.getByRole("dialog", { name: "Eliminar horas extras" }).getByRole("button", { name: "Eliminar horas" }).click();
    await expect(page.getByText("Sin horas extras en este reporte")).toBeVisible();
  });

  test("quien no lidera una unidad con horas extras no ve el menú y la pantalla le dice por qué", async ({ context, page }) => {
    const { e } = await conGerente();
    await entrarComo(context, e.companero);
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Horas extras" })).toHaveCount(0);
    await page.goto("/horas-extras");
    await expect(page.getByText(/Las horas extras las gestiona quien lidera una unidad/)).toBeVisible();
  });

  test("dirección ve el mapa y el reporte sin botones de edición", async ({ context, page }) => {
    const { e, gerente, director } = await conGerente();
    await (await api(context, gerente)).post(`${BASE}/api/horas-extras`, { data: registro(e.empleado) });
    await entrarComo(context, director);
    await page.goto(`/horas-extras?unidad=${e.alfa}&anio=2026&mes=9&mitad=15`);
    await expect(page.locator("[data-horas]")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Registrar horas" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Editar las horas/ })).toHaveCount(0);
    await expect(page.getByText(/solo quien la lidera registra horas/)).toBeVisible();
  });
});
