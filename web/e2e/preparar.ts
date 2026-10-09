import { sembrarTodo } from "./semilla";

/* globalSetup de Playwright: la base de todas las baterias, desde cero. Con SIN_SEMILLA=1 se deja como esta. */
export default async function preparar() {
  if (process.env.SIN_SEMILLA) return;
  const n = await sembrarTodo();
  console.log(`[e2e] base sembrada: ${n.personas} personas, ${n.tareas} tareas, ${n.solicitudes} solicitudes`);
}
