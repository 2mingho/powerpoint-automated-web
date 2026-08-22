# SQL de migración revisable

Generado con Alembic en modo offline (`flask db upgrade --sql`), dialecto
PostgreSQL. No se conectó a ninguna base para producirlo.

    01_stamp_0001_baseline.sql          crea alembic_version, marca 0001 como aplicada
    02_upgrade_0002_tasks_collab.sql    la delta de v2: 9 columnas + 6 tablas
    03_post_deploy_drop_defaults.sql    SOLO DESPUÉS de desplegar v2

## Orden

1. `01` y `02` pueden aplicarse con la versión anterior de la app corriendo.
   Son aditivos: no borran ni alteran ningún dato existente.
2. `03` se aplica **después** del despliegue de v2, nunca antes.

## Por qué 03 va aparte

`02` deja puestos los valores por defecto del motor en `tasks.priority` y
`tasks.visibility`. Ambas son NOT NULL, y la versión anterior de la aplicación
no las conoce: sin default, sus INSERT violarían la restricción y crear tareas
dejaría de funcionar en producción.

Con el default puesto, v1 y el esquema de v2 conviven sin interrupción. Una vez
desplegada v2 —que pone esos valores desde la aplicación— `03` retira el default
del motor para no tener dos fuentes del mismo valor.

## Verificado

- Cero `DROP TABLE`, `DELETE` o `TRUNCATE` en los tres scripts.
- Los dos `UPDATE` de `02` llevan `WHERE` y solo rellenan columnas recién
  creadas (`tasks.updated_at` desde `created_at`, `tasks.area_id` desde
  `areas.name`).
- No tocan ninguna tabla del módulo Admin V2.
- `classification_presets` no aparece; `areas` solo se lee.
- Ensayado en la rama `develop` de Neon: esquema resultante idéntico a
  models.py (122 columnas), huellas MD5 de los datos sin variación.
