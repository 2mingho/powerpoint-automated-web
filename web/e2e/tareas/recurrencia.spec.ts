import { expect, test, type BrowserContext } from "@playwright/test";
import { BASE, entrarComo, escenario, sql } from "./apoyo";
import { ADMIN, contextoCon } from "../admin/ayuda";

/*
 * Recurrencia: la siguiente tarea de una serie se crea al CERRAR la anterior, para el
 * mismo dia de la semana (semanal) o del mes (mensual) de la primera, contando desde la
 * ENTREGA y no desde el dia del cierre. Fechas fijas en 2031 (el cierre siempre es "hoy",
 * lejos de la entrega: asi se ve que el cierre no cuenta).
 */
test.beforeEach(() => {
  test.skip(test.info().project.name !== "escritorio", "contrato de API: una pasada basta");
  test.setTimeout(120_000);
});

const LUNES = "2031-01-06";
type Fila = { id: number; title: string; due_date: Date; status: string; parent_task_id: number | null; is_recurrent: boolean; recurrence_type: string | null; assignee_id: number; area_id: number; priority: string; estimated_hours: number | null; reviewer_id: number | null; client_id: number | null; end_date: Date | null; start_date: Date | null; creator_id: number; done_at: Date | null };
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const serie = (titulo: string) => sql<Fila>("SELECT * FROM tasks WHERE title = $1 AND deleted_at IS NULL ORDER BY due_date, id", [titulo]);
const todas = (titulo: string) => sql<Fila>("SELECT * FROM tasks WHERE title = $1 ORDER BY due_date, id", [titulo]);

async function crear(ctx: BrowserContext, e: Awaited<ReturnType<typeof escenario>>, titulo: string, extra: Record<string, unknown> = {}) {
  const r = await ctx.request.post(`${BASE}/api/tareas`, { data: { title: titulo, assignee_id: e.companero, due_date: LUNES, is_recurrent: true, recurrence_type: "Semanal", ...extra } });
  expect(r.status(), await r.text()).toBe(201);
  return (await r.json()) as { tarea: { id: number }; cuantas: number };
}
const cerrar = (ctx: BrowserContext, id: number) => ctx.request.put(`${BASE}/api/tareas/${id}`, { data: { status: "Completado" } });
const reabrir = (ctx: BrowserContext, id: number) => ctx.request.put(`${BASE}/api/tareas/${id}`, { data: { status: "Pendiente" } });
const siguienteDe = async (r: Awaited<ReturnType<typeof cerrar>>) => ((await r.json()) as { tarea: { siguiente: { id: number; entrega: string } | null } }).tarea.siguiente;

test.describe("al crear", () => {
  test("una serie nace con una sola tarea: ya no se precalcula", async ({ context }) => {
    const e = await escenario("rec-alta");
    await entrarComo(context, e.empleado);
    const r = await crear(context, e, `Semanal ${e.sufijo}`, { recurrence_end: "2031-06-30" });
    expect(r.cuantas).toBe(1);
    const filas = await serie(`Semanal ${e.sufijo}`);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ is_recurrent: true, recurrence_type: "Semanal", parent_task_id: null });
    expect(iso(filas[0].end_date)).toBe("2031-06-30"); // el fin de la serie
  });

  test("sin fecha de fin vale; con fin anterior a la entrega, no; en fin de semana, no; frecuencia invalida, no", async ({ context }) => {
    const e = await escenario("rec-valida");
    await entrarComo(context, e.empleado);
    expect((await context.request.post(`${BASE}/api/tareas`, { data: { title: `Sin fin ${e.sufijo}`, assignee_id: e.companero, due_date: LUNES, is_recurrent: true, recurrence_type: "Mensual" } })).status()).toBe(201);
    for (const [motivo, cambio] of Object.entries({ "fin anterior": { recurrence_end: "2031-01-01" }, "sabado": { due_date: "2031-01-04" }, "frecuencia": { recurrence_type: "Cada rato" } })) {
      const r = await context.request.post(`${BASE}/api/tareas`, { data: { title: `Mal ${e.sufijo}`, assignee_id: e.companero, due_date: LUNES, is_recurrent: true, recurrence_type: "Semanal", ...cambio } });
      expect(r.status(), motivo).toBe(400);
    }
    expect(await serie(`Mal ${e.sufijo}`)).toHaveLength(0);
  });
});

test.describe("al cerrar", () => {
  test("semanal: la siguiente sale el mismo dia de la semana, una semana despues, sin importar cuando se cierre", async ({ context }) => {
    const e = await escenario("rec-semanal");
    await entrarComo(context, e.empleado);
    const t = `Semanal ${e.sufijo}`;
    const { tarea } = await crear(context, e, t, { priority: "Alta", estimated_hours: 3, checklist: undefined });
    await sql("UPDATE tasks SET reviewer_id = $2, estimated_hours = 3, start_date = '2031-01-02' WHERE id = $1", [tarea.id, e.empleado]);
    await sql("INSERT INTO task_checklist_items (task_id, body, position, is_completed, created_at) VALUES ($1, 'Paso uno', 0, true, now()), ($1, 'Paso dos', 1, false, now())", [tarea.id]);
    await sql("INSERT INTO task_watchers (task_id, user_id, added_by_id, created_at) VALUES ($1, $2, $2, now())", [tarea.id, e.empleado]);

    const r = await cerrar(context, tarea.id);
    expect(r.status(), await r.text()).toBe(200);
    const sig = await siguienteDe(r);
    expect(sig?.entrega).toBe("2031-01-13");

    const filas = await serie(t);
    expect(filas).toHaveLength(2);
    const [primera, segunda] = filas;
    expect(primera.status).toBe("Completado");
    expect(iso(segunda.due_date)).toBe("2031-01-13");
    expect(segunda).toMatchObject({ id: sig!.id, status: "Pendiente", parent_task_id: tarea.id, is_recurrent: true, recurrence_type: "Semanal", assignee_id: e.companero, area_id: e.alfa, priority: "Alta", estimated_hours: 3, reviewer_id: e.empleado, done_at: null });
    expect(iso(segunda.start_date)).toBe("2031-01-09"); // el inicio conserva su distancia a la entrega (4 dias)
    // Lo que traia pasa sin marcar.
    const pasos = await sql<{ body: string; is_completed: boolean }>("SELECT body, is_completed FROM task_checklist_items WHERE task_id = $1 ORDER BY position", [segunda.id]);
    expect(pasos).toEqual([{ body: "Paso uno", is_completed: false }, { body: "Paso dos", is_completed: false }]);
    expect(Number((await sql<{ n: string }>("SELECT count(*) n FROM task_watchers WHERE task_id = $1", [segunda.id]))[0].n)).toBe(1);
    // Aviso a quien la hace (otra persona que quien cerro) y rastro en la actividad.
    const avisos = await sql<{ title: string }>("SELECT title FROM notifications WHERE user_id = $1 AND kind = 'task_assigned' AND entity_id = $2", [e.companero, segunda.id]);
    expect(avisos).toHaveLength(1);
    expect((await sql("SELECT 1 FROM activity_logs WHERE action = 'task_create' AND entity_id = $1 AND detail LIKE 'Siguiente de la serie%'", [segunda.id])).length).toBe(1);
  });

  test("la cadena sigue con el dia de la primera aunque una se haya movido de dia", async ({ context }) => {
    const e = await escenario("rec-ancla");
    await entrarComo(context, e.empleado);
    const t = `Ancla ${e.sufijo}`;
    const { tarea } = await crear(context, e, t);
    const s2 = await siguienteDe(await cerrar(context, tarea.id));
    expect(s2?.entrega).toBe("2031-01-13");
    // La segunda se mueve al martes; al cerrarla, la tercera vuelve al lunes de la semana siguiente.
    await context.request.put(`${BASE}/api/tareas/${s2!.id}`, { data: { due_date: "2031-01-14" } });
    const s3 = await siguienteDe(await cerrar(context, s2!.id));
    expect(s3?.entrega).toBe("2031-01-20");
    const filas = await serie(t);
    expect(filas.map((f) => iso(f.due_date))).toEqual(["2031-01-06", "2031-01-14", "2031-01-20"]);
    // Todas cuelgan de la primera, no una de otra.
    expect(filas.slice(1).every((f) => f.parent_task_id === tarea.id)).toBe(true);
  });

  test("mensual: el mismo dia del mes de la primera; un 31 cae en el ultimo dia del mes corto y vuelve al 31", async ({ context }) => {
    const e = await escenario("rec-mensual");
    await entrarComo(context, e.empleado);
    const t = `Mensual ${e.sufijo}`;
    const { tarea } = await crear(context, e, t, { recurrence_type: "Mensual", due_date: "2031-01-31" }); // viernes
    const s2 = await siguienteDe(await cerrar(context, tarea.id));
    expect(s2?.entrega).toBe("2031-02-28");
    const s3 = await siguienteDe(await cerrar(context, s2!.id));
    expect(s3?.entrega).toBe("2031-03-31");
    const s4 = await siguienteDe(await cerrar(context, s3!.id));
    expect(s4?.entrega).toBe("2031-04-30");
    const s5 = await siguienteDe(await cerrar(context, s4!.id));
    expect(s5?.entrega).toBe("2031-05-31");
  });

  test("mensual del dia 7: el 7 del mes siguiente aunque caiga en fin de semana", async ({ context }) => {
    const e = await escenario("rec-dia7");
    await entrarComo(context, e.empleado);
    const { tarea } = await crear(context, e, `Dia7 ${e.sufijo}`, { recurrence_type: "Mensual", due_date: "2031-01-07" }); // martes
    expect((await siguienteDe(await cerrar(context, tarea.id)))?.entrega).toBe("2031-02-07"); // viernes
    const s2 = (await serie(`Dia7 ${e.sufijo}`))[1];
    expect((await siguienteDe(await cerrar(context, s2.id)))?.entrega).toBe("2031-03-07");
    const s3 = (await serie(`Dia7 ${e.sufijo}`))[2];
    expect((await siguienteDe(await cerrar(context, s3.id)))?.entrega).toBe("2031-04-07"); // lunes
  });

  test("diaria: el siguiente dia laborable", async ({ context }) => {
    const e = await escenario("rec-diaria");
    await entrarComo(context, e.empleado);
    const { tarea } = await crear(context, e, `Diaria ${e.sufijo}`, { recurrence_type: "Diaria", due_date: "2031-01-03" }); // viernes
    const s2 = await siguienteDe(await cerrar(context, tarea.id));
    expect(s2?.entrega).toBe("2031-01-06"); // lunes
    expect((await siguienteDe(await cerrar(context, s2!.id)))?.entrega).toBe("2031-01-07");
  });

  test("con fecha de fin, la serie termina: no se crea nada pasada esa fecha", async ({ context }) => {
    const e = await escenario("rec-fin");
    await entrarComo(context, e.empleado);
    const t = `Fin ${e.sufijo}`;
    const { tarea } = await crear(context, e, t, { recurrence_end: "2031-01-20" });
    const s2 = await siguienteDe(await cerrar(context, tarea.id));
    const s3 = await siguienteDe(await cerrar(context, s2!.id));
    expect(s3?.entrega).toBe("2031-01-20"); // el dia del fin si entra
    expect(await siguienteDe(await cerrar(context, s3!.id))).toBeNull();
    expect(await serie(t)).toHaveLength(3);
  });

  test("reabrir y volver a cerrar no duplica; lo borrado no resucita", async ({ context }) => {
    const e = await escenario("rec-idem");
    await entrarComo(context, e.empleado);
    const t = `Idem ${e.sufijo}`;
    const { tarea } = await crear(context, e, t);
    const s2 = await siguienteDe(await cerrar(context, tarea.id));
    await reabrir(context, tarea.id);
    expect(await siguienteDe(await cerrar(context, tarea.id))).toBeNull(); // la siguiente ya existe
    expect(await serie(t)).toHaveLength(2);
    // Borrada la siguiente a proposito, cerrar de nuevo no la vuelve a crear.
    expect((await context.request.delete(`${BASE}/api/tareas/${s2!.id}`)).status()).toBe(200);
    await reabrir(context, tarea.id);
    expect(await siguienteDe(await cerrar(context, tarea.id))).toBeNull();
    expect(await serie(t)).toHaveLength(1);
    expect(await todas(t)).toHaveLength(2);
  });

  test("una serie precalculada por la version anterior no se duplica", async ({ context }) => {
    const e = await escenario("rec-legado");
    await entrarComo(context, e.empleado);
    const t = `Legado ${e.sufijo}`;
    const raiz = await e.tarea(t, e.alfa, e.empleado, e.empleado, "Pendiente", LUNES);
    const hija = await e.tarea(t, e.alfa, e.empleado, e.empleado, "Pendiente", "2031-01-13");
    await sql("UPDATE tasks SET is_recurrent = true, recurrence_type = 'Semanal' WHERE id = ANY($1)", [[raiz, hija]]);
    await sql("UPDATE tasks SET parent_task_id = $1 WHERE id = $2", [raiz, hija]);
    expect(await siguienteDe(await cerrar(context, raiz))).toBeNull(); // la del 13 ya esta
    expect(await serie(t)).toHaveLength(2);
    // Pero la ultima de la serie precalculada si continua.
    const s = await siguienteDe(await cerrar(context, hija));
    expect(s?.entrega).toBe("2031-01-20");
  });

  test("dejar de repetir: la tarea sigue y cerrarla ya no crea otra", async ({ context }) => {
    const e = await escenario("rec-parar");
    await entrarComo(context, e.empleado);
    const t = `Parar ${e.sufijo}`;
    const { tarea } = await crear(context, e, t);
    const r = await context.request.put(`${BASE}/api/tareas/${tarea.id}`, { data: { is_recurrent: false } });
    expect(r.status(), await r.text()).toBe(200);
    expect(((await r.json()) as { tarea: { recurrente: boolean } }).tarea.recurrente).toBe(false);
    expect(await siguienteDe(await cerrar(context, tarea.id))).toBeNull();
    expect(await serie(t)).toHaveLength(1);
  });

  test("una tarea que no se repite no crea nada al cerrarse", async ({ context }) => {
    const e = await escenario("rec-normal");
    await entrarComo(context, e.empleado);
    const t = await e.tarea(`Normal ${e.sufijo}`, e.alfa, e.empleado, e.empleado);
    expect(await siguienteDe(await cerrar(context, t))).toBeNull();
    expect(await serie(`Normal ${e.sufijo}`)).toHaveLength(1);
  });
});

test.describe("todos los caminos de cierre", () => {
  test("tablero, edicion masiva y edicion de administracion", async ({ context, browser }) => {
    const e = await escenario("rec-caminos");
    await entrarComo(context, e.empleado);
    const mk = async (n: string) => (await crear(context, e, `${n} ${e.sufijo}`)).tarea.id;
    const [tablero, masivoA, masivoB, admin] = [await mk("Tablero"), await mk("MasivoA"), await mk("MasivoB"), await mk("Admin")];

    const m = await context.request.post(`${BASE}/api/tareas/${tablero}/mover`, { data: { status: "Completado" } });
    expect(m.status(), await m.text()).toBe(200);
    expect(((await m.json()) as { siguiente: { entrega: string } | null }).siguiente?.entrega).toBe("2031-01-13");

    const lote = await context.request.post(`${BASE}/api/tareas/masivo`, { data: { accion: "editar", task_ids: [masivoA, masivoB], status: "Completado" } });
    expect(lote.status(), await lote.text()).toBe(200);
    expect((await lote.json()).siguientes).toBe(2);

    const { ctx } = await contextoCon(browser, ADMIN);
    const a = await ctx.request.post(`${BASE}/api/admin/tareas/lote`, { data: { ids: [admin], estado: "Completado" } });
    expect(a.status(), await a.text()).toBe(200);
    expect((await a.json()).siguientes).toBe(1);

    for (const n of ["Tablero", "MasivoA", "MasivoB", "Admin"]) expect(await serie(`${n} ${e.sufijo}`), n).toHaveLength(2);
  });

  test("un lote que cierra y mueve la fecha a la vez calcula la siguiente desde la fecha nueva", async ({ context }) => {
    const e = await escenario("rec-lote-fecha");
    await entrarComo(context, e.empleado);
    const { tarea } = await crear(context, e, `Movida ${e.sufijo}`);
    const r = await context.request.post(`${BASE}/api/tareas/masivo`, { data: { accion: "editar", task_ids: [tarea.id], status: "Completado", due_date_map: { [tarea.id]: "2031-01-14" } } });
    expect(r.status(), await r.text()).toBe(200);
    // La primera quedo en martes 14: ese es ahora el dia de la serie, y la siguiente es el martes 21 (no el 13 ni el 20).
    expect((await serie(`Movida ${e.sufijo}`)).map((f) => iso(f.due_date))).toEqual(["2031-01-14", "2031-01-21"]);
  });
});

test.describe("en pantalla", () => {
  test("el formulario dice para cuando saldra la siguiente y crea una sola tarea", async ({ context, page }) => {
    const e = await escenario("rec-form");
    await entrarComo(context, e.empleado);
    await page.goto(`${BASE}/tareas`);
    await page.getByRole("button", { name: /Nueva tarea/ }).first().click();
    const d = page.getByRole("dialog", { name: "Nueva tarea" });
    await d.getByLabel("Qué hay que hacer").fill(`Informe semanal ${e.sufijo}`);
    await d.getByLabel("Entrega").fill(LUNES);
    await d.getByText("Repetir").first().click();
    await d.getByLabel("Repetir esta tarea").check();
    await expect(d.getByText("Al cerrar la primera, la siguiente sale para el 2031-01-13")).toBeVisible();
    await expect(d.getByText("el mismo día de la semana")).toBeVisible();
    await d.getByLabel("Frecuencia").selectOption("Mensual");
    await expect(d.getByText("Al cerrar la primera, la siguiente sale para el 2031-02-06")).toBeVisible();
    await expect(d.getByText("Sin fecha, se repite mientras la vayas cerrando.")).toBeVisible();
    await d.getByLabel("Frecuencia").selectOption("Semanal");
    await d.getByRole("button", { name: "Crear tarea" }).click();
    await expect(d).toBeHidden();
    expect(await serie(`Informe semanal ${e.sufijo}`)).toHaveLength(1);
  });

  test("al completar una tarea de una serie se avisa y la siguiente aparece en la lista", async ({ context, page }) => {
    const e = await escenario("rec-pantalla");
    await entrarComo(context, e.empleado);
    const hoy = new Date();
    // Una entrega proxima y laborable para que entre en la lista por defecto: el lunes siguiente.
    const lunes = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate() + ((8 - hoy.getUTCDay()) % 7 || 7))).toISOString().slice(0, 10);
    const t = `Serie visible ${e.sufijo}`;
    const { tarea } = await crear(context, e, t, { assignee_id: e.empleado, due_date: lunes });
    await page.goto(`${BASE}/tareas?tarea=${tarea.id}`);
    await page.getByRole("button", { name: "Completar", exact: true }).first().click();
    await expect(page.getByText(/Se creó la siguiente de la serie, para el/)).toBeVisible();
    await expect.poll(async () => (await serie(t)).length).toBe(2);
    await expect(page.locator("li[data-tarea]").filter({ hasText: t })).toHaveCount(2);
  });

  test("dejar de repetir desde el detalle", async ({ context, page }) => {
    const e = await escenario("rec-detalle");
    await entrarComo(context, e.empleado);
    const t = `Detener ${e.sufijo}`;
    const { tarea } = await crear(context, e, t, { assignee_id: e.empleado });
    await page.goto(`${BASE}/tareas?tarea=${tarea.id}`);
    await expect(page.getByRole("article", { name: `Tarea: ${t}` })).toBeVisible();
    // El pase se repinta al llegar sus datos: se abre el plegable hasta que se quede abierto.
    await expect(async () => {
      await page.locator("summary:visible", { hasText: "Más datos" }).first().evaluate((s) => { (s.parentElement as HTMLDetailsElement).open = true; });
      await expect(page.getByText(/Semanal: al cerrarla se crea la siguiente/).first()).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 15_000 });
    await page.getByRole("button", { name: "Dejar de repetir" }).first().click();
    await expect(page.getByText("No se repite").first()).toBeVisible();
    // La pantalla cambia al instante; la base, cuando llega la respuesta.
    await expect.poll(async () => (await serie(t))[0].is_recurrent).toBe(false);
  });
});
