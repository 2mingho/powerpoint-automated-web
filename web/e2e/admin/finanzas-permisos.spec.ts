import { expect, test } from "@playwright/test";
import { escenario, entrarComo, sql } from "../tareas/apoyo";
import { ADMIN, contextoCon } from "./ayuda";

/*
 * Permisos de ingresos por unidad: un administrador concede, persona por persona,
 * editar contratos y/o metas de unidades concretas. Son dos permisos separados.
 */
test.beforeEach(() => {
  test.skip(test.info().project.name !== "escritorio", "contrato de API: una pasada basta");
  test.setTimeout(120_000);
});

const filas = async (userId: number) =>
  (await sql<{ area_id: number; kind: string; granted_by: number | null }>("SELECT area_id, kind, granted_by FROM finance_grants WHERE user_id = $1 ORDER BY kind, area_id", [userId]));
const unidades = (rows: { area_id: number; kind: string }[], kind: string) => rows.filter((r) => r.kind === kind).map((r) => r.area_id).sort((a, b) => a - b);
const adminId = async () => (await sql<{ id: number }>("SELECT id FROM users WHERE email = $1", [ADMIN]))[0].id;
const avisos = async (userId: number) => (await sql<{ n: string }>("SELECT count(*) n FROM notifications WHERE user_id = $1 AND kind = 'finance_grant'", [userId]))[0].n;

test.describe("conceder desde Personas", () => {
  test("concede por tipo y unidad, registra quien lo hizo, deja actividad y avisa", async ({ browser }) => {
    const { page } = await contextoCon(browser, ADMIN);
    const e = await escenario("fin-conceder");
    const r = await page.request.patch(`/api/admin/usuarios/${e.empleado}`, { data: { finanzas: { contracts: [e.alfa], goals: [e.alfa, e.beta] } } });
    expect(r.status(), await r.text()).toBe(200);

    const f = await filas(e.empleado);
    expect(unidades(f, "contracts")).toEqual([e.alfa]);
    expect(unidades(f, "goals")).toEqual([e.alfa, e.beta].sort((a, b) => a - b));
    const yo = await adminId();
    expect(f.every((x) => x.granted_by === yo)).toBe(true);

    const [log] = await sql<{ detail: string }>("SELECT detail FROM activity_logs WHERE action = 'finance_grant_update' AND entity_id = $1 ORDER BY id DESC LIMIT 1", [e.empleado]);
    expect(log.detail).toContain(`empleado.${e.sufijo}`);
    expect(log.detail).toContain(`+Alfa ${e.sufijo}`);
    expect(await avisos(e.empleado)).toBe("2"); // uno por cada tipo que cambio
  });

  test("repetir lo mismo no cambia nada ni vuelve a avisar", async ({ browser }) => {
    const { page } = await contextoCon(browser, ADMIN);
    const e = await escenario("fin-idem");
    const cuerpo = { finanzas: { goals: [e.alfa] } };
    expect((await page.request.patch(`/api/admin/usuarios/${e.empleado}`, { data: cuerpo })).status()).toBe(200);
    const antes = await avisos(e.empleado);
    expect((await page.request.patch(`/api/admin/usuarios/${e.empleado}`, { data: cuerpo })).status()).toBe(200);
    expect(await avisos(e.empleado)).toBe(antes);
    expect(unidades(await filas(e.empleado), "goals")).toEqual([e.alfa]);
  });

  test("reemplaza la lista del tipo que llega y no toca el otro", async ({ browser }) => {
    const { page } = await contextoCon(browser, ADMIN);
    const e = await escenario("fin-reemplazo");
    await page.request.patch(`/api/admin/usuarios/${e.empleado}`, { data: { finanzas: { contracts: [e.alfa], goals: [e.alfa] } } });
    const r = await page.request.patch(`/api/admin/usuarios/${e.empleado}`, { data: { finanzas: { contracts: [e.beta] } } });
    expect(r.status()).toBe(200);
    const f = await filas(e.empleado);
    expect(unidades(f, "contracts")).toEqual([e.beta]); // Alfa se quito
    expect(unidades(f, "goals")).toEqual([e.alfa]); // metas intactas
    const quitar = await page.request.patch(`/api/admin/usuarios/${e.empleado}`, { data: { finanzas: { goals: [] } } });
    expect(quitar.status()).toBe(200);
    expect(unidades(await filas(e.empleado), "goals")).toEqual([]);
  });

  test("guardar otros datos sin mencionar finanzas no toca los permisos", async ({ browser }) => {
    const { page } = await contextoCon(browser, ADMIN);
    const e = await escenario("fin-aparte");
    await page.request.patch(`/api/admin/usuarios/${e.empleado}`, { data: { finanzas: { goals: [e.alfa] } } });
    expect((await page.request.patch(`/api/admin/usuarios/${e.empleado}`, { data: { capacidad: 20 } })).status()).toBe(200);
    expect(unidades(await filas(e.empleado), "goals")).toEqual([e.alfa]);
  });

  test("rechaza lo invalido sin cambiar nada", async ({ browser }) => {
    const { page } = await contextoCon(browser, ADMIN);
    const e = await escenario("fin-invalido");
    await page.request.patch(`/api/admin/usuarios/${e.empleado}`, { data: { finanzas: { goals: [e.alfa] } } });
    for (const malo of [
      { ingresos: [e.alfa] }, { contracts: "1" }, { contracts: [e.alfa, 0] }, { goals: [1.5] }, { contracts: [99999999] }, [1], null, "x",
      { contracts: [e.beta], goals: [99999999] }, // una buena y una mala: nada se aplica
    ]) {
      const r = await page.request.patch(`/api/admin/usuarios/${e.empleado}`, { data: { finanzas: malo } });
      expect(r.status(), JSON.stringify(malo)).toBe(400);
    }
    const f = await filas(e.empleado);
    expect(unidades(f, "goals")).toEqual([e.alfa]);
    expect(unidades(f, "contracts")).toEqual([]);
  });

  test("una cuenta de administracion no recibe concesiones (ya edita todo), pero vaciar es valido", async ({ browser }) => {
    const { page } = await contextoCon(browser, ADMIN);
    const e = await escenario("fin-admin");
    await sql("UPDATE users SET is_admin = true WHERE id = $1", [e.companero]);
    const r = await page.request.patch(`/api/admin/usuarios/${e.companero}`, { data: { finanzas: { goals: [e.alfa] } } });
    expect(r.status()).toBe(400);
    expect((await page.request.patch(`/api/admin/usuarios/${e.companero}`, { data: { finanzas: { goals: [] } } })).status()).toBe(200);
    expect(await filas(e.companero)).toEqual([]);
  });

  test("solo un administrador concede: nadie se las da a si mismo", async ({ context, page }) => {
    const e = await escenario("fin-sin-permiso");
    await entrarComo(context, e.empleado);
    const r = await page.request.patch(`/api/admin/usuarios/${e.empleado}`, { data: { finanzas: { goals: [e.alfa] } } });
    expect(r.status()).toBe(403);
    expect(await filas(e.empleado)).toEqual([]);
  });

  test("el listado de personas trae los permisos de cada una", async ({ browser }) => {
    const { page } = await contextoCon(browser, ADMIN);
    const e = await escenario("fin-lista");
    await page.request.patch(`/api/admin/usuarios/${e.empleado}`, { data: { finanzas: { contracts: [e.alfa] } } });
    const lista = (await (await page.request.get(`/api/admin/usuarios?q=empleado.${e.sufijo}`)).json()) as { filas: { id: number; finanzas: { contracts: number[]; goals: number[] } }[] };
    expect(lista.filas).toHaveLength(1);
    expect(lista.filas[0].finanzas).toEqual({ contracts: [e.alfa], goals: [] });
  });

  test("borrar la unidad o la persona limpia sus permisos", async ({ browser }) => {
    const { page } = await contextoCon(browser, ADMIN);
    const e = await escenario("fin-cascada");
    await page.request.patch(`/api/admin/usuarios/${e.ajeno}`, { data: { finanzas: { contracts: [e.alfa, e.beta] } } });
    await sql("DELETE FROM users WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM tasks WHERE assignee_id = $1 OR creator_id = $1)", [e.companero]);
    await sql("DELETE FROM areas WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM tasks WHERE area_id = $1) AND NOT EXISTS (SELECT 1 FROM users WHERE area_id = $1)", [e.alfa]);
    // La unidad sigue (tiene personas): los permisos tambien. Al quitar a las personas, sale con ella.
    expect(unidades(await filas(e.ajeno), "contracts")).toContain(e.alfa);
    await sql("DELETE FROM users WHERE area_id = $1", [e.alfa]);
    await sql("DELETE FROM areas WHERE id = $1", [e.alfa]);
    expect(unidades(await filas(e.ajeno), "contracts")).toEqual([e.beta]);
  });
});

test.describe("lo que cada persona puede hacer (GET /api/finanzas/permisos)", () => {
  type Permisos = { admin: boolean; ver: { id: number; nombre: string }[]; supervisa: { id: number }[]; editar: { contracts: { id: number }[]; goals: { id: number }[] } };
  const ids = (l: { id: number }[]) => l.map((x) => x.id).sort((a, b) => a - b);

  test("sin sesion es 401", async ({ request }) => {
    expect((await request.get("/api/finanzas/permisos")).status()).toBe(401);
  });

  test("sin concesiones ni mando no ve ni edita nada", async ({ context, page }) => {
    const e = await escenario("fin-nada");
    await entrarComo(context, e.empleado);
    const p = (await (await page.request.get("/api/finanzas/permisos")).json()) as Permisos;
    expect(p).toMatchObject({ admin: false, ver: [], supervisa: [], editar: { contracts: [], goals: [] } });
  });

  test("editar una unidad tambien la hace visible, y solo esa", async ({ browser, context, page }) => {
    const { page: admin } = await contextoCon(browser, ADMIN);
    const e = await escenario("fin-ver");
    await admin.request.patch(`/api/admin/usuarios/${e.empleado}`, { data: { finanzas: { goals: [e.beta] } } });
    await entrarComo(context, e.empleado);
    const p = (await (await page.request.get("/api/finanzas/permisos")).json()) as Permisos;
    expect(ids(p.ver)).toEqual([e.beta]);
    expect(ids(p.editar.goals)).toEqual([e.beta]);
    expect(p.editar.contracts).toEqual([]); // son permisos separados
    expect(p.supervisa).toEqual([]);
  });

  test("quien lidera una unidad la ve, pero no la edita sin concesion", async ({ context, page }) => {
    const e = await escenario("fin-mando");
    await sql("INSERT INTO unit_leads (user_id, area_id) VALUES ($1, $2)", [e.companero, e.alfa]);
    await entrarComo(context, e.companero);
    const p = (await (await page.request.get("/api/finanzas/permisos")).json()) as Permisos;
    expect(ids(p.ver)).toEqual([e.alfa]);
    expect(ids(p.supervisa)).toEqual([e.alfa]);
    expect(p.editar).toEqual({ contracts: [], goals: [] });
  });

  test("un lider de gerentes ve la cadena; las concesiones se suman, sin duplicar", async ({ browser, context, page }) => {
    const { page: admin } = await contextoCon(browser, ADMIN);
    const e = await escenario("fin-cadena");
    await sql("INSERT INTO unit_leads (user_id, area_id) VALUES ($1, $2)", [e.companero, e.alfa]);
    await sql("UPDATE users SET manager_id = $1 WHERE id = $2", [e.empleado, e.companero]); // empleado lidera a companero
    await admin.request.patch(`/api/admin/usuarios/${e.empleado}`, { data: { finanzas: { contracts: [e.alfa, e.beta] } } });
    await entrarComo(context, e.empleado);
    const p = (await (await page.request.get("/api/finanzas/permisos")).json()) as Permisos;
    expect(ids(p.supervisa)).toEqual([e.alfa]);
    expect(ids(p.ver)).toEqual([e.alfa, e.beta].sort((a, b) => a - b));
  });

  test("administracion ve y edita todas las unidades", async ({ browser }) => {
    const { page } = await contextoCon(browser, ADMIN);
    const total = Number((await sql<{ n: string }>("SELECT count(*) n FROM areas"))[0].n);
    const p = (await (await page.request.get("/api/finanzas/permisos")).json()) as Permisos;
    expect(p.admin).toBe(true);
    expect(p.ver).toHaveLength(total);
    expect(p.editar.contracts).toHaveLength(total);
    expect(p.editar.goals).toHaveLength(total);
  });
});

test.describe("en pantalla", () => {
  test("se conceden desde el panel de la persona y la lista lo marca", async ({ browser }) => {
    const { page } = await contextoCon(browser, ADMIN);
    const e = await escenario("fin-pantalla");
    const nombre = `empleado.${e.sufijo}`;
    await page.goto(`/admin/personas?q=${encodeURIComponent(nombre)}`);
    await page.getByRole("button", { name: `Editar a ${nombre}` }).click();
    const ingresos = page.getByRole("group", { name: "Ingresos" });
    await expect(ingresos).toBeVisible();

    await ingresos.getByText("Edita contratos").click();
    await ingresos.getByRole("checkbox", { name: `Alfa ${e.sufijo}` }).first().check();
    await ingresos.getByText("Edita metas de ingresos").click();
    await ingresos.getByRole("button", { name: "Todas" }).nth(1).click();
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(page.getByText(`${nombre} actualizada.`)).toBeVisible();

    const f = await filas(e.empleado);
    expect(unidades(f, "contracts")).toEqual([e.alfa]);
    expect(unidades(f, "goals")).toContain(e.alfa);
    expect(unidades(f, "goals")).toContain(e.beta);
    await expect(page.getByTitle(/Edita ingresos: 1 unidades en contratos/)).toBeVisible();
  });

  test("guardar sin tocar ingresos no los modifica", async ({ browser }) => {
    const { page } = await contextoCon(browser, ADMIN);
    const e = await escenario("fin-pantalla-2");
    const nombre = `empleado.${e.sufijo}`;
    await page.request.patch(`/api/admin/usuarios/${e.empleado}`, { data: { finanzas: { goals: [e.alfa] } } });
    const antes = await avisos(e.empleado);
    await page.goto(`/admin/personas?q=${encodeURIComponent(nombre)}`);
    await page.getByRole("button", { name: `Editar a ${nombre}` }).click();
    await page.getByLabel("Capacidad semanal (horas)").fill("30");
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(page.getByText(`${nombre} actualizada.`)).toBeVisible();
    expect(unidades(await filas(e.empleado), "goals")).toEqual([e.alfa]);
    expect(await avisos(e.empleado)).toBe(antes);
  });

  test("a un administrador no se le ofrecen unidades", async ({ browser }) => {
    const { page } = await contextoCon(browser, ADMIN);
    const e = await escenario("fin-pantalla-3");
    await sql("UPDATE users SET is_admin = true WHERE id = $1", [e.companero]);
    await page.goto(`/admin/personas?q=${encodeURIComponent(`companero.${e.sufijo}`)}`);
    await page.getByRole("button", { name: `Editar a companero.${e.sufijo}` }).click();
    await expect(page.getByText("Administración entra a todas.")).toBeVisible();
    await expect(page.getByRole("group", { name: "Ingresos" })).toHaveCount(0);
  });
});
