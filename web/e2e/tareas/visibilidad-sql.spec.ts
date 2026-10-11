import { expect, test } from "@playwright/test";
import { BASE, entrarComo, escenario, sql } from "./apoyo";

/*
 * visibilidadSql (consultas crudas) y filtroTareasVisibles (Prisma) son la MISMA regla escrita dos veces.
 * Aqui se comprueba que dan las mismas tareas para admin, quien lidera una unidad, quien tiene a alguien a
 * cargo y quien no tiene a nadie. Se hace a traves del mapa de calor de Equipo (que usa la regla cruda para las
 * vencidas) comparando contra las tareas visibles que lista la API (que usa la regla de Prisma).
 */
test.beforeEach(({}, info) => { test.skip(info.project.name !== "escritorio", "Una vez, en escritorio."); });

test("las vencidas que cuenta la base son exactamente las visibles que lista la API", async ({ context }) => {
  const e = await escenario("vis-sql");
  const lider = (await sql<{ id: number }>("INSERT INTO users (username, email, password, role, is_active, created_at, area_id, allowed_tools, tour_completed_at) SELECT $1, $2, password, 'analista', true, now(), $3, '[\"tasks\"]', now() FROM users WHERE id = $4 RETURNING id",
    [`lider.${e.sufijo}`, `lider.${e.sufijo}@e2e.test`, e.alfa, e.empleado]))[0].id;
  await sql("INSERT INTO unit_leads (user_id, area_id) VALUES ($1, $2)", [lider, e.alfa]);
  // Vencidas en las dos unidades, una de la unidad propia asignada a quien no es de ella, y una borrada.
  const ayer = new Date(Date.now() - 86_400_000 * 2).toISOString().slice(0, 10);
  const mias = [await e.tarea("A1", e.alfa, e.empleado, e.empleado, "Pendiente", ayer), await e.tarea("A2", e.alfa, e.empleado, e.companero, "Pendiente", ayer)];
  await e.tarea("B1", e.beta, e.ajeno, e.ajeno, "Pendiente", ayer);
  const borrada = await e.tarea("A3", e.alfa, e.empleado, e.empleado, "Pendiente", ayer);
  await sql("UPDATE tasks SET deleted_at = now() WHERE id = $1", [borrada]);
  await sql("UPDATE tasks SET estimated_hours = 10 WHERE id = ANY($1)", [mias]);

  await entrarComo(context, lider);
  const { calor } = (await (await context.request.get(`${BASE}/api/equipo`)).json()) as { calor: { filas: { personaId: number; celdas: { horas: number; tareas: number }[] }[] } };
  const vistas = calor.filas.reduce((n, f) => n + f.celdas[0].tareas, 0);
  const horas = calor.filas.reduce((n, f) => n + f.celdas[0].horas, 0);
  // Solo las dos de la unidad del lider: ni la de Beta ni la borrada.
  expect(vistas).toBe(2);
  expect(horas).toBe(20);
  const lista = (await (await context.request.get(`${BASE}/api/tareas?alcance=unidad&filtro=vencidas`)).json()) as { tareas: { id: number }[] };
  expect(new Set(lista.tareas.map((t) => t.id))).toEqual(new Set(mias));
});
