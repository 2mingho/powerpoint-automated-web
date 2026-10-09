import { expect, test } from "@playwright/test";
import { idDeCorreo } from "../comun";
import { BASE, entrarComo, escenario, HOY, sql } from "./apoyo";

/*
 * Mapa de calor de carga en Equipo y capacidad semanal. Cada prueba crea su
 * escenario: unidad Alfa (lider, empleado, companero) y unidad Beta (ajeno).
 */

test.beforeEach(({}, info) => { test.skip(info.project.name !== "escritorio", "Una vez basta, en escritorio."); });

type Esc = Awaited<ReturnType<typeof escenario>>;
type Fila = { personaId: number; nombre: string; capacidad: number; celdas: Array<{ horas: number; razon: number; nivel: number; tareas: number; sinEstimar: number }> };

/* Una tarea abierta que empieza y vence hoy: todas sus horas caen en la semana actual. */
async function tareaDeHoy(e: Esc, asignado: number, area: number, horas: number | null) {
  const id = await e.tarea(`Carga ${horas ?? "sin estimar"} ${Math.random()}`, area, asignado, asignado, "En Progreso", HOY);
  await sql("UPDATE tasks SET start_date = $1, estimated_hours = $2 WHERE id = $3", [HOY, horas, id]);
  return id;
}

async function conLider() {
  const e = await escenario("calor");
  const lider = (await sql<{ id: number }>("INSERT INTO users (username, email, password, role, is_active, created_at, area_id, allowed_tools, tour_completed_at) SELECT $1, $2, password, 'DI', true, now(), $3, '[\"tasks\"]', now() FROM users WHERE id = $4 RETURNING id",
    [`lider.${e.sufijo}`, `lider.${e.sufijo}@e2e.test`, e.alfa, e.empleado]))[0].id;
  await sql("INSERT INTO unit_leads (user_id, area_id) VALUES ($1, $2)", [lider, e.alfa]);
  return { e, lider };
}

test.describe("mapa de calor", () => {
  test("pinta horas, razon y nivel de cada persona; marca lo sin estimar", async ({ context }) => {
    const { e, lider } = await conLider();
    await tareaDeHoy(e, e.empleado, e.alfa, 35); // 100 % de 35 h: al limite
    await tareaDeHoy(e, e.companero, e.alfa, null); // sin estimar: cuenta 4 h
    await entrarComo(context, lider);

    const res = await context.request.get(`${BASE}/api/equipo`);
    expect(res.status(), await res.text()).toBe(200);
    const { calor } = (await res.json()) as { calor: { semanas: string[]; filas: Fila[] } };
    expect(calor.semanas).toHaveLength(4);
    const emp = calor.filas.find((f) => f.personaId === e.empleado)!;
    const comp = calor.filas.find((f) => f.personaId === e.companero)!;
    expect(emp.capacidad).toBe(35);
    expect(emp.celdas[0]).toMatchObject({ horas: 35, nivel: 3, tareas: 1, sinEstimar: 0 });
    expect(emp.celdas[1]).toMatchObject({ horas: 0, nivel: 0 });
    expect(comp.celdas[0]).toMatchObject({ horas: 4, tareas: 1, sinEstimar: 1 });
    // El mas cargado va primero.
    expect(calor.filas[0].personaId).toBe(e.empleado);
  });

  test("capacidad 0 saca a la persona del mapa; otra capacidad cambia la razon", async ({ context }) => {
    const { e, lider } = await conLider();
    await tareaDeHoy(e, e.empleado, e.alfa, 10);
    await sql("UPDATE users SET weekly_capacity = 0 WHERE id = $1", [e.companero]);
    await sql("UPDATE users SET weekly_capacity = 20 WHERE id = $1", [e.empleado]);
    await entrarComo(context, lider);
    const { calor } = (await (await context.request.get(`${BASE}/api/equipo`)).json()) as { calor: { filas: Fila[] } };
    expect(calor.filas.some((f) => f.personaId === e.companero)).toBe(false);
    const emp = calor.filas.find((f) => f.personaId === e.empleado)!;
    expect(emp.capacidad).toBe(20);
    expect(emp.celdas[0]).toMatchObject({ horas: 10, nivel: 1 });
    expect(emp.celdas[0].razon).toBeCloseTo(0.5, 6);
  });

  test("no enseña personas ni horas de otra unidad, y pedirla da 403", async ({ context }) => {
    const { e, lider } = await conLider();
    await tareaDeHoy(e, e.ajeno, e.beta, 30);
    await entrarComo(context, lider);
    const { calor } = (await (await context.request.get(`${BASE}/api/equipo`)).json()) as { calor: { filas: Fila[] } };
    expect(calor.filas.some((f) => f.personaId === e.ajeno)).toBe(false);
    expect(JSON.stringify(calor)).not.toContain(`ajeno.${e.sufijo}`);
    const ajena = await context.request.get(`${BASE}/api/equipo?unidad=${e.beta}`);
    expect(ajena.status()).toBe(403);
    expect(await ajena.text()).not.toContain(`ajeno.${e.sufijo}`);
  });

  test("un empleado sin unidades a cargo no ve el panel", async ({ context }) => {
    const e = await escenario("calor-no");
    await entrarComo(context, e.empleado);
    expect((await context.request.get(`${BASE}/api/equipo`)).status()).toBe(403);
  });

  test("la pantalla lo muestra con el nivel escrito y filtra por persona", async ({ page, context }) => {
    const { e, lider } = await conLider();
    await tareaDeHoy(e, e.empleado, e.alfa, 35);
    await entrarComo(context, lider);
    await page.goto(`${BASE}/equipo`);
    const panel = page.getByRole("region", { name: "Carga por semana" });
    await expect(panel).toBeVisible({ timeout: 20_000 });
    await expect(panel.getByRole("img", { name: new RegExp(`empleado\\.${e.sufijo}.*35 h de 35.*al límite`, "i") }).first()).toBeVisible();
    await panel.getByRole("button", { name: `empleado.${e.sufijo}` }).click();
    await expect(page).toHaveURL(new RegExp(`asignado=${e.empleado}`));
  });
});

test.describe("capacidad semanal en Admin", () => {
  test("se fija, se quita con vacio y rechaza valores invalidos", async ({ context }) => {
    const e = await escenario("capacidad");
    await entrarComo(context, await idDeCorreo("demo@local.test"));
    const patch = (capacidad: unknown) => context.request.patch(`${BASE}/api/admin/usuarios/${e.empleado}`, { data: { capacidad } });
    const valor = async () => (await sql<{ c: number | null }>("SELECT weekly_capacity AS c FROM users WHERE id = $1", [e.empleado]))[0].c;

    expect((await patch(20)).status()).toBe(200);
    expect(await valor()).toBe(20);
    expect((await patch(0)).status()).toBe(200);
    expect(await valor()).toBe(0);
    for (const malo of [-1, 81, 12.5, "abc"]) expect((await patch(malo)).status(), String(malo)).toBe(400);
    expect(await valor()).toBe(0);
    expect((await patch("")).status()).toBe(200);
    expect(await valor()).toBeNull();
  });

  test("un no administrador no puede cambiar capacidades", async ({ context }) => {
    const e = await escenario("capacidad-no");
    await entrarComo(context, e.empleado);
    const res = await context.request.patch(`${BASE}/api/admin/usuarios/${e.companero}`, { data: { capacidad: 1 } });
    expect(res.status()).toBe(403);
  });
});
