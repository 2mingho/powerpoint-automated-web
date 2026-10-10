import { expect, test, type Page } from "@playwright/test";
import { BASE, entrarComo, escenario, HOY, sql, sumarDias } from "./apoyo";

/* Pulido (B8): avisos al revisor y orden de las tablas. */

const avisosDeRevision = (user: number) => sql<{ title: string; link_url: string }>("SELECT title, link_url FROM notifications WHERE user_id = $1 AND kind = 'task_review' ORDER BY id", [user]);
async function conRevisor(prefijo: string) {
  const e = await escenario(prefijo);
  const t = await e.tarea("Informe para revisar", e.alfa, e.empleado, e.empleado);
  await sql("UPDATE tasks SET reviewer_id = $2 WHERE id = $1", [t, e.companero]);
  return { e, t };
}

test.describe("aviso al revisor", () => {
  test.beforeEach(({}, info) => { test.skip(info.project.name !== "escritorio", "contrato de API: una pasada basta"); });

  test("al pasar a revision por el formulario, el revisor recibe un aviso con enlace; no antes ni dos veces", async ({ context }) => {
    const { e, t } = await conRevisor("pul-rev-put");
    await entrarComo(context, e.empleado);
    await context.request.put(`${BASE}/api/tareas/${t}`, { data: { status: "En Progreso" } });
    expect(await avisosDeRevision(e.companero)).toHaveLength(0); // aun no esta en revision
    const r = await context.request.put(`${BASE}/api/tareas/${t}`, { data: { status: "En Revisión" } });
    expect(r.status(), await r.text()).toBe(200);
    const avisos = await avisosDeRevision(e.companero);
    expect(avisos).toHaveLength(1);
    expect(avisos[0].title).toContain("Informe para revisar");
    expect(avisos[0].link_url).toContain(`tarea=${t}`);
    // Guardar otra cosa estando ya en revision no repite el aviso.
    await context.request.put(`${BASE}/api/tareas/${t}`, { data: { description: "ajuste" } });
    expect(await avisosDeRevision(e.companero)).toHaveLength(1);
  });

  test("tambien desde el tablero y desde la edicion masiva", async ({ context }) => {
    const a = await conRevisor("pul-rev-mover");
    await entrarComo(context, a.e.empleado);
    expect((await context.request.post(`${BASE}/api/tareas/${a.t}/mover`, { data: { status: "En Revisión" } })).status()).toBe(200);
    expect(await avisosDeRevision(a.e.companero)).toHaveLength(1);

    const b = await conRevisor("pul-rev-masivo");
    const otra = await b.e.tarea("Otra", b.e.alfa, b.e.empleado, b.e.empleado); // sin revisor: no avisa a nadie
    await entrarComo(context, b.e.empleado);
    const r = await context.request.post(`${BASE}/api/tareas/masivo`, { data: { accion: "editar", task_ids: [b.t, otra], status: "En Revisión" } });
    expect(r.status(), await r.text()).toBe(200);
    const avisos = await avisosDeRevision(b.e.companero);
    expect(avisos).toHaveLength(1);
    expect(avisos[0].link_url).toContain(`tarea=${b.t}`);
  });

  test("no se avisa a quien hizo el cambio, ni si la tarea no tiene revisor", async ({ context }) => {
    const { e, t } = await conRevisor("pul-rev-propio");
    await entrarComo(context, e.companero); // el propio revisor la mueve
    await context.request.put(`${BASE}/api/tareas/${t}`, { data: { status: "En Revisión" } });
    expect(await avisosDeRevision(e.companero)).toHaveLength(0);

    const sin = await e.tarea("Sin revisor", e.alfa, e.empleado, e.empleado);
    await entrarComo(context, e.empleado);
    await context.request.put(`${BASE}/api/tareas/${sin}`, { data: { status: "En Revisión" } });
    expect((await sql<{ n: string }>("SELECT count(*) n FROM notifications WHERE kind = 'task_review' AND entity_id = $1", [sin]))[0].n).toBe("0");
  });
});

/* ─── Orden de las tablas ─── */

async function conTareasParaOrdenar(prefijo: string) {
  const e = await escenario(prefijo);
  const mk = async (titulo: string, dias: number, horas: number | null, quien: number) => {
    const id = await e.tarea(titulo, e.alfa, e.empleado, quien, "Pendiente", sumarDias(HOY, dias));
    await sql("UPDATE tasks SET estimated_hours = $2 WHERE id = $1", [id, horas]);
    return id;
  };
  await mk("Beta tarea", 3, 2, e.empleado);
  await mk("Alfa tarea", 5, 10, e.companero);
  await mk("Gama tarea", 1, 6, e.empleado);
  return e;
}
const titulos = (page: Page) => page.getByRole("table", { name: "Tareas que cumplen los filtros" }).getByRole("row").filter({ hasNot: page.getByRole("columnheader") }).locator("a").allInnerTexts();
const soloEstas = (l: string[]) => l.filter((t) => /(Alfa|Beta|Gama) tarea/.test(t));

test.describe("tablas ordenables: el detalle del Panel", () => {
  test("pulsar una columna ordena, otra vez invierte y una tercera vuelve a lo urgente", async ({ context, page }, info) => {
    test.skip(info.project.name !== "escritorio", "Los encabezados son de escritorio.");
    const e = await conTareasParaOrdenar("pul-ord-panel");
    await entrarComo(context, e.empleado);
    await page.goto("/?vista=panel&periodo=todo");
    const th = (n: RegExp) => page.getByRole("table", { name: "Tareas que cumplen los filtros" }).getByRole("columnheader", { name: n });
    await expect.poll(async () => soloEstas(await titulos(page))).toEqual(["Gama tarea", "Beta tarea", "Alfa tarea"]); // lo urgente: por entrega

    await th(/tarea/i).getByRole("button").click();
    await expect(th(/tarea/i)).toHaveAttribute("aria-sort", "ascending");
    await expect.poll(async () => soloEstas(await titulos(page))).toEqual(["Alfa tarea", "Beta tarea", "Gama tarea"]);
    await th(/tarea/i).getByRole("button").click();
    await expect(th(/tarea/i)).toHaveAttribute("aria-sort", "descending");
    await expect.poll(async () => soloEstas(await titulos(page))).toEqual(["Gama tarea", "Beta tarea", "Alfa tarea"]);
    await th(/tarea/i).getByRole("button").click();
    await expect(th(/tarea/i)).toHaveAttribute("aria-sort", "none");
    await expect.poll(async () => soloEstas(await titulos(page))).toEqual(["Gama tarea", "Beta tarea", "Alfa tarea"]); // de vuelta a lo urgente

    // Horas empieza de mayor a menor: es lo que casi siempre se busca.
    await th(/horas/i).getByRole("button").click();
    await expect.poll(async () => soloEstas(await titulos(page))).toEqual(["Alfa tarea", "Gama tarea", "Beta tarea"]);
    await expect(th(/horas/i)).toHaveAttribute("aria-sort", "descending");
    // Cambiar de columna deja una sola activa.
    await th(/persona/i).getByRole("button").click();
    await expect(th(/horas/i)).toHaveAttribute("aria-sort", "none");
    await expect(th(/persona/i)).toHaveAttribute("aria-sort", "ascending");
  });

  test("en movil se ordena con el selector", async ({ context, page }, info) => {
    test.skip(info.project.name !== "movil", "El selector es de movil.");
    const e = await conTareasParaOrdenar("pul-ord-movil");
    await entrarComo(context, e.empleado);
    await page.goto("/?vista=panel&periodo=todo");
    const sel = page.getByLabel("Ordenar", { exact: false }).first();
    await sel.selectOption({ label: "Tarea" });
    await expect.poll(async () => soloEstas(await titulos(page))).toEqual(["Alfa tarea", "Beta tarea", "Gama tarea"]);
    await page.getByRole("button", { name: /Orden ascendente/ }).click();
    await expect.poll(async () => soloEstas(await titulos(page))).toEqual(["Gama tarea", "Beta tarea", "Alfa tarea"]);
    await sel.selectOption({ label: "Lo urgente primero" });
    await expect.poll(async () => soloEstas(await titulos(page))).toEqual(["Gama tarea", "Beta tarea", "Alfa tarea"]);
  });
});

test.describe("tablas ordenables: estudios e ingresos", () => {
  test.beforeEach(({}, info) => { test.skip(info.project.name !== "escritorio", "Una vez, en escritorio."); });

  test("los estudios se ordenan por avance, de mayor a menor la primera vez", async ({ context, page }) => {
    const e = await escenario("pul-ord-est");
    await sql("UPDATE areas SET has_studies = true WHERE id = $1", [e.alfa]);
    await entrarComo(context, e.empleado);
    const mk = async (titulo: string) => (await (await page.request.post("/api/estudios", { data: { titulo, cliente: `C ${e.sufijo}`, metodo: "Cuantitativo", responsableId: e.companero, entrega: sumarDias(HOY, 40) } })).json()) as { id: number };
    const poco = await mk(`Poco ${e.sufijo}`);
    const mucho = await mk(`Mucho ${e.sufijo}`);
    for (const p of await sql<{ id: number }>("SELECT id FROM tasks WHERE parent_task_id = $1 ORDER BY id LIMIT 5", [mucho.id])) await sql("UPDATE tasks SET status = 'Completado', done_at = now() WHERE id = $1", [p.id]);
    void poco;
    await page.goto("/estudios");
    const filas = () => page.getByRole("button", { name: new RegExp(`(Poco|Mucho) ${e.sufijo}`) }).allInnerTexts();
    const nombres = async () => (await filas()).map((t) => /Poco|Mucho/.exec(t)![0]);
    await page.getByRole("columnheader", { name: /avance/i }).getByRole("button").click();
    await expect.poll(nombres).toEqual(["Mucho", "Poco"]);
    await page.getByRole("columnheader", { name: /avance/i }).getByRole("button").click();
    await expect.poll(nombres).toEqual(["Poco", "Mucho"]);
    await expect(page.getByRole("columnheader", { name: /avance/i })).toHaveAttribute("aria-sort", "ascending");
  });

  test("los contratos se ordenan por monto desde el selector", async ({ context, page }) => {
    const e = await escenario("pul-ord-ing");
    const mk = async (n: string, monto: number) => {
      const c = (await sql<{ id: number }>("INSERT INTO clients (name, name_key, is_active, created_at) VALUES ($1, $2, true, now()) RETURNING id", [`${n} ${e.sufijo}`, `${n} ${e.sufijo}`.toLowerCase()]))[0].id;
      await sql("INSERT INTO contracts (client_id, area_id, contract_type, amount, start_date, end_date, created_at, updated_at) VALUES ($1, $2, 'Fee', $3, make_date(extract(year from now())::int, 1, 1), make_date(extract(year from now())::int, 12, 31), now(), now())", [c, e.alfa, monto]);
    };
    await mk("Pequeño", 1200);
    await mk("Grande", 90000);
    await mk("Medio", 12000);
    await sql("INSERT INTO unit_leads (user_id, area_id) VALUES ($1, $2)", [e.empleado, e.alfa]);
    await entrarComo(context, e.empleado);
    await page.goto("/ingresos");
    const lista = page.getByRole("region", { name: "Contratos" });
    const orden = async () => (await lista.getByRole("listitem").allInnerTexts()).map((t) => /Pequeño|Grande|Medio/.exec(t)?.[0]).filter(Boolean);
    await lista.getByLabel("Ordenar").selectOption({ label: "Monto" });
    await expect.poll(orden).toEqual(["Grande", "Medio", "Pequeño"].reverse()); // primera vez ascendente
    await lista.getByRole("button", { name: /Orden ascendente/ }).click();
    await expect.poll(orden).toEqual(["Grande", "Medio", "Pequeño"]);
  });
});
