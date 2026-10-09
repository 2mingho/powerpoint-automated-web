import { test } from "@playwright/test";
import { entrarComo, escenario, expect, HOY, soloEscritorio, sql, sumarDias } from "./apoyo";

test.beforeEach(() => {
  test.skip(soloEscritorio(test.info()), "contrato de seguridad: una pasada basta");
  test.setTimeout(120_000);
});

/*
 * Los textos largos tenian tope en la columna (titulo, cliente) pero no las
 * descripciones ni el motivo de rechazo: cualquiera con la herramienta podia
 * guardar megas por peticion en filas que luego se listan y se notifican.
 */
const ENORME = "x".repeat(25_000);

test("descripciones y motivos tienen tope de longitud", async ({ context }) => {
  const e = await escenario("largo");
  await entrarComo(context, e.empleado);
  const api = context.request;

  const alta = await api.post("/api/tareas", { data: { title: "Larga", assignee_id: e.empleado, due_date: sumarDias(HOY, 3), description: ENORME } });
  expect(alta.status()).toBe(400);
  expect((await alta.json()).error).toMatch(/descripción/i);

  const id = await e.tarea("Editable", e.alfa, e.empleado, e.empleado);
  const cambio = await api.put(`/api/tareas/${id}`, { data: { description: ENORME } });
  expect(cambio.status()).toBe(400);

  const plantilla = await api.post("/api/tareas/plantillas", { data: { name: "P", payload: { title: "T", description: ENORME } } });
  expect(plantilla.status()).toBe(400);

  const sol = await api.post("/api/solicitudes", { data: { titulo: "Larga", unidadDestinoId: e.beta, descripcion: ENORME } });
  expect(sol.status()).toBe(400);

  // Motivo de rechazo: lo resuelve quien lidera la unidad destino.
  await sql("INSERT INTO unit_leads (user_id, area_id) VALUES ($1, $2)", [e.ajeno, e.beta]);
  const solicitud = (await sql<{ id: number }>(
    "INSERT INTO task_requests (title, requester_id, from_area_id, to_area_id, status, created_at) VALUES ('Pedido', $1, $2, $3, 'Pendiente', now()) RETURNING id",
    [e.empleado, e.alfa, e.beta]))[0].id;
  await entrarComo(context, e.ajeno);
  const rechazo = await api.post(`/api/solicitudes/${solicitud}/rechazar`, { data: { motivo: ENORME } });
  expect(rechazo.status()).toBe(400);
  const normal = await api.post(`/api/solicitudes/${solicitud}/rechazar`, { data: { motivo: "No es de nuestra unidad." } });
  expect(normal.status()).toBe(200);
});
