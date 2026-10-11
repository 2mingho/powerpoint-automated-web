import { expect, test } from "@playwright/test";
import { idDeCorreo } from "../comun";
import { BASE, entrarComo, escenario, HOY, sql, sumarDias } from "./apoyo";

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
  const lider = (await sql<{ id: number }>("INSERT INTO users (username, email, password, role, is_active, created_at, area_id, allowed_tools, tour_completed_at) SELECT $1, $2, password, 'analista', true, now(), $3, '[\"tasks\"]', now() FROM users WHERE id = $4 RETURNING id",
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

  test("las vencidas cargan su resto en la semana de hoy (sumadas en la base), con avance de pasos y sin estimar; lo lejano no cuenta", async ({ context }) => {
    const { e, lider } = await conLider();
    const vencida = async (quien: number, dias: number, horas: number | null, pasos: [number, number] = [0, 0]) => {
      const id = await e.tarea(`Vencida ${Math.random()}`, e.alfa, quien, quien, "En Progreso", sumarDias(HOY, -dias));
      await sql("UPDATE tasks SET estimated_hours = $2 WHERE id = $1", [id, horas]);
      for (let i = 0; i < pasos[1]; i++) await sql("INSERT INTO task_checklist_items (task_id, body, position, is_completed, created_at) VALUES ($1, 'p', $2, $3, now())", [id, i, i < pasos[0]]);
      return id;
    };
    await vencida(e.empleado, 3, 8); // 8 h enteras
    await vencida(e.empleado, 20, 4, [1, 4]); // 4 h con 1 de 4 pasos hechos: 3 h
    await vencida(e.empleado, 9, 6, [2, 2]); // pasos completos: no aporta
    await vencida(e.companero, 1, null); // sin estimar: 4 h y marca
    // Una tarea que empieza y vence lejos de la ventana (y no vencida) no carga nada.
    const lejos = await e.tarea("Lejos", e.alfa, e.empleado, e.empleado, "En Progreso", sumarDias(HOY, 120));
    await sql("UPDATE tasks SET estimated_hours = 20, start_date = $2 WHERE id = $1", [lejos, sumarDias(HOY, 118)]);
    // Una larga sin fecha de inicio que vence tras la ventana pero empieza dentro de ella por sus horas.
    const larga = await e.tarea("Larga", e.alfa, e.empleado, e.empleado, "En Progreso", sumarDias(HOY, 32));
    await sql("UPDATE tasks SET estimated_hours = 120 WHERE id = $1", [larga]);
    await entrarComo(context, lider);
    const { calor } = (await (await context.request.get(`${BASE}/api/equipo`)).json()) as { calor: { filas: Fila[] } };
    const emp = calor.filas.find((f) => f.personaId === e.empleado)!;
    const comp = calor.filas.find((f) => f.personaId === e.companero)!;
    // La larga (120 h = 20 dias habiles hacia atras desde hoy+32) aporta algo a la ultima semana; las vencidas, a la primera.
    expect(emp.celdas[0]).toMatchObject({ horas: 11, tareas: 2, sinEstimar: 0 });
    expect(emp.celdas[3].horas).toBeGreaterThan(0);
    expect(comp.celdas[0]).toMatchObject({ horas: 4, tareas: 1, sinEstimar: 1 });
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

/*
 * Cifras del panel de Equipo: contadores, carga por persona, vencidas por unidad y tendencia salen de consultas
 * agregadas en la base (no de cada tarea). Aqui se comparan con lo que se sembro, tarea por tarea.
 */
test.describe("cifras de Equipo desde la base", () => {
  type Panel = {
    contadores: { abiertas: number; vencidas: number; completadasSemana: number; enRiesgo: number };
    carga: { personaId: number; total: number; vencidas: number; segmentos: { estado: string; n: number }[] }[];
    porUnidad: { nombre: string; abiertas: number; vencidas: number }[];
    tendencia: { semana: string; creadas: number; completadas: number }[];
  };

  test("contadores, carga, unidades y tendencia coinciden con las tareas sembradas", async ({ context }) => {
    const { e, lider } = await conLider();
    const t = async (quien: number, estado: string, entrega: string, creadaHace: number, tocadaHace = creadaHace) => {
      const id = await e.tarea(`Eq ${Math.random()}`, e.alfa, quien, quien, estado, entrega);
      await sql("UPDATE tasks SET created_at = now() - make_interval(days => $2::int), updated_at = now() - make_interval(days => $3::int) WHERE id = $1", [id, creadaHace, tocadaHace]);
      return id;
    };
    await t(e.empleado, "Pendiente", sumarDias(HOY, -4), 30); // vencida
    await t(e.empleado, "En Progreso", sumarDias(HOY, -1), 30); // vencida
    await t(e.companero, "Pendiente", sumarDias(HOY, 1), 12); // en riesgo (mañana)
    await t(e.companero, "Bloqueado", sumarDias(HOY, 45), 2); // abierta lejana
    await t(e.empleado, "Completado", sumarDias(HOY, -2), 20, 0); // cerrada ahora: esta semana
    await t(e.companero, "Completado", sumarDias(HOY, -30), 40, 22); // cerrada hace 22 dias: otra semana
    await t(e.companero, "Completado", sumarDias(HOY, -100), 200, 90); // cerrada hace mucho: fuera de las 8 semanas
    await entrarComo(context, lider);
    const res = await context.request.get(`${BASE}/api/equipo?unidad=${e.alfa}`);
    expect(res.status(), await res.text()).toBe(200);
    const panel = (await res.json()) as Panel;

    expect(panel.contadores).toEqual({ abiertas: 4, vencidas: 2, enRiesgo: 1, completadasSemana: 1 });
    const emp = panel.carga.find((f) => f.personaId === e.empleado)!;
    const comp = panel.carga.find((f) => f.personaId === e.companero)!;
    expect(emp).toMatchObject({ total: 2, vencidas: 2 });
    expect(comp).toMatchObject({ total: 2, vencidas: 0 });
    expect(comp.segmentos.map((s) => s.estado).sort()).toEqual(["Bloqueado", "Pendiente"]);
    expect(panel.porUnidad.find((u) => u.nombre.startsWith("Alfa"))).toMatchObject({ abiertas: 4, vencidas: 2 });

    // Tendencia: 8 semanas, la ultima es la actual; los cierres y las altas caen en la semana de su fecha.
    expect(panel.tendencia).toHaveLength(8);
    const semanaDe = (haceDias: number) => { const d = new Date(Date.now() - haceDias * 86_400_000 - 4 * 3_600_000); return sumarDias(d.toISOString().slice(0, 10), -((d.getUTCDay() + 6) % 7)); };
    const cierres = (s: string) => panel.tendencia.find((p) => p.semana === s)!.completadas;
    expect(cierres(semanaDe(0))).toBe(1);
    expect(cierres(semanaDe(22))).toBe(1);
    expect(panel.tendencia.reduce((n, p) => n + p.completadas, 0)).toBe(2); // la de hace 90 dias no entra
    // Altas en las 8 semanas: las de hace 30, 30, 12, 2, 20 y 40 dias; las de 200 no.
    expect(panel.tendencia.reduce((n, p) => n + p.creadas, 0)).toBe(6);
  });
});
