import { test } from "@playwright/test";
import { cookieDe, expect, soloEscritorio, sql } from "./apoyo";

test.beforeEach(() => {
  test.skip(soloEscritorio(test.info()), "contrato de seguridad: una pasada basta");
  test.setTimeout(180_000);
});

/* Zip "stored" minimo: lo justo para que esPptxValido lo acepte (no mira CRC). */
function zip(entradas: { nombre: string; datos: Buffer }[]): Buffer {
  const locales: Buffer[] = [];
  const centrales: Buffer[] = [];
  let offset = 0;
  for (const e of entradas) {
    const nombre = Buffer.from(e.nombre);
    const loc = Buffer.alloc(30);
    loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(20, 4);
    loc.writeUInt32LE(e.datos.length, 18); loc.writeUInt32LE(e.datos.length, 22); loc.writeUInt16LE(nombre.length, 26);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6);
    cen.writeUInt32LE(e.datos.length, 20); cen.writeUInt32LE(e.datos.length, 24); cen.writeUInt16LE(nombre.length, 28);
    cen.writeUInt32LE(offset, 42);
    locales.push(loc, nombre, e.datos);
    centrales.push(cen, nombre);
    offset += 30 + nombre.length + e.datos.length;
  }
  const dir = Buffer.concat(centrales);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(entradas.length, 8); fin.writeUInt16LE(entradas.length, 10);
  fin.writeUInt32LE(dir.length, 12); fin.writeUInt32LE(offset, 16);
  return Buffer.concat([...locales, dir, fin]);
}

/*
 * Las plantillas admiten hasta 15 MB, pero el proxy (que cubre /api/admin)
 * copia el cuerpo y lo corta en silencio a 10 MB: una plantilla de 12 MB
 * llegaba truncada, sin directorio central, y se rechazaba como "no es un
 * PowerPoint valido".
 */
test("una plantilla de 12 MB llega entera a traves del proxy", async ({ context }) => {
  const admin = (await sql<{ id: number }>("SELECT id FROM users WHERE email = 'demo@local.test'"))[0].id;
  await context.addCookies([await cookieDe(admin)]);
  const nombre = `e2e_seguridad_${Date.now()}.pptx`;
  const archivo = zip([
    { nombre: "[Content_Types].xml", datos: Buffer.from("<Types/>") },
    { nombre: "ppt/media/relleno.bin", datos: Buffer.alloc(12 * 1024 * 1024, 7) },
  ]);
  const r = await context.request.post("/api/admin/plantillas", {
    multipart: { plantilla: { name: nombre, mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", buffer: archivo } },
  });
  const cuerpo = await r.json();
  expect(r.status(), JSON.stringify(cuerpo)).toBe(201);
  const guardada = await sql<{ size_bytes: number }>("SELECT size_bytes FROM pptx_templates WHERE name = $1", [nombre]);
  expect(guardada[0].size_bytes).toBe(archivo.length);
  await sql("DELETE FROM pptx_templates WHERE name = $1", [nombre]);
});
