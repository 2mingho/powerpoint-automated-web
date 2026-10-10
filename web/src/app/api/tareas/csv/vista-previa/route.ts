import { conUsuario, ErrorApi, ok } from "@/lib/api";
import { vistaPrevia } from "@/lib/tareas/importar";

export const POST = conUsuario(async (req, u) => {
  let archivo: File | null = null;
  try {
    const v = (await req.formData()).get("csv_file");
    archivo = v instanceof File ? v : null;
  } catch {
    throw new ErrorApi(400, "Debes seleccionar un archivo CSV.");
  }
  return ok(await vistaPrevia(u, archivo));
}, { herramienta: "tasks" });
