# Retirada de Admin V2 del esquema de producción

**Fecha:** 21 agosto 2026
**Estado:** aplicado
**Código preservado en:** etiqueta `admin-v2-experimento` → commit `7e01565`

## Contexto

La base de producción contenía 9 tablas que `models.py` no declaraba:
`admin_freeze_state`, `audit_ledger_events`, `config_items`, `config_versions`,
`incident_actions`, `incident_events`, `module_locks`, `ops_job_runs`, `ops_jobs`.

Pertenecen al módulo **Admin V2** (consola de operaciones): 3.055 líneas en
`blueprints/admin_v2.py`, 47 rutas, 221 líneas de modelos. Cubría identidad y
permisos efectivos, cola de trabajos, configuración versionada con rollback,
libro de auditoría con exportación, gestión de incidentes con playbooks, y
bloqueo de módulos.

## Por qué estaban ahí sin estar en el código

El PR #39 fusionó `8d5b93e` a `main` el 16 de abril a las 14:25. El commit de
Admin V2 (`7e01565`) se apiló sobre **la misma rama ya fusionada** nueve horas
después, a las 23:45, sin PR de seguimiento. La rama quedó dormida ese mismo
día; `main` siguió hasta junio.

Su esquema sí llegó a la base real, sin pasar por ningún despliegue. La
explicación que encaja con la evidencia es que se ejecutó `create_all()` contra
la base de producción desde una máquina de desarrollo. Lo apoya que la rama
Neon `develop` tuviera una tabla más (`incident_playbooks`) que producción: si
hubiera llegado por despliegue, ambas tendrían lo mismo.

Ese agujero se cerró en el commit `678f4bf`: el arranque ya nunca escribe en una
base remota fuera de modo producción.

## Qué se retiró y qué costó

- **Datos perdidos: ninguno.** Las 9 tablas tenían 0 filas.
- **Funcionalidad perdida: ninguna.** El código nunca se desplegó.
- **Integridad: intacta.** Las 13 claves foráneas apuntaban hacia `users` y
  entre ellas; ninguna tabla del núcleo dependía de ellas.

Verificado tras la operación: 122 columnas (las que declara `models.py`) y las
huellas MD5 de `users`, `tasks`, `areas`, `classification_presets`,
`activity_logs` y `temp_artifacts` sin variación.

## Si algún día se retoma

`git checkout admin-v2-experimento`

Aviso: unas 14 de sus 47 rutas duplican `blueprints/admin.py`. Aquel commit
**reescribía** el panel de administración en vez de extenderlo, así que
reintegrarlo exige reconciliar ambos, no solo enchufar el blueprint.

## Pendiente

La rama Neon `develop` conserva sus 10 tablas de Admin V2 (las 9 más
`incident_playbooks`). Retirarlas también la dejaría alineada con producción.
