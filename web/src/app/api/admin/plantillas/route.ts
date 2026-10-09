import { conUsuario, ErrorApi, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { registrarActividad } from "@/lib/actividad";
import { plantillas } from "@/lib/admin/consultas";
import { SOLO_ADMIN } from "@/lib/admin/api";
import { esPptxValido, MAX_PLANTILLA_BYTES, nombreSeguro } from "@/lib/admin/pptx";

export const GET = conUsuario(async () => ok(await plantillas()), SOLO_ADMIN);

/*
 * Subida (plantilla_upload). Se guarda en la base y no en disco: el contenedor
 * tiene almacenamiento efimero. Si ya existe una con ese nombre, se reemplaza.
 */
export const POST = conUsuario(async (req, u) => {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new ErrorApi(400, "Selecciona un archivo .pptx.");
  }
  const archivo = form.get("plantilla");
  if (!(archivo instanceof File) || !archivo.name) throw new ErrorApi(400, "Selecciona un archivo .pptx.");
  const nombre = nombreSeguro(archivo.name);
  if (!nombre.toLowerCase().endsWith(".pptx")) throw new ErrorApi(400, "El archivo debe ser un .pptx.");
  if (archivo.size > MAX_PLANTILLA_BYTES) {
    throw new ErrorApi(413, `La plantilla pesa ${Math.floor(archivo.size / 1048576)} MB y el límite es ${MAX_PLANTILLA_BYTES / 1048576} MB.`);
  }
  const contenido = new Uint8Array(await archivo.arrayBuffer());
  if (!esPptxValido(contenido)) throw new ErrorApi(400, "El archivo no es un PowerPoint válido, aunque se llame .pptx.");

  const existente = await db.pptx_templates.findUnique({ where: { name: nombre }, select: { id: true } });
  let id: number;
  if (existente) {
    await db.pptx_templates.update({ where: { id: existente.id }, data: { data: contenido, size_bytes: contenido.length, uploaded_by_id: u.id, created_at: new Date() } });
    id = existente.id;
  } else {
    id = (await db.pptx_templates.create({ data: { name: nombre, data: contenido, size_bytes: contenido.length, uploaded_by_id: u.id, created_at: new Date() }, select: { id: true } })).id;
  }
  const verbo = existente ? "reemplazada" : "subida";
  await registrarActividad(u.id, existente ? "pptx_template_replace" : "pptx_template_upload", `Plantilla ${verbo}: ${nombre} (${Math.floor(contenido.length / 1024)} KB)`, { tipo: "pptx_template", id });
  return ok({ id, nombre, reemplazada: !!existente }, existente ? 200 : 201);
}, SOLO_ADMIN);
