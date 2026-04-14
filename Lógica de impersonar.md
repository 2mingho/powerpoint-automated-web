# Guía: Lógica de Suplantación de Usuario (Impersonation)

## ¿Qué es y para qué sirve?

La suplantación de usuario es una funcionalidad administrativa que le permite al administrador principal "iniciar sesión como otro usuario" sin necesidad de conocer su contraseña. Esto es útil para:

- Diagnosticar problemas que un usuario reporta ("yo veo esto así").
- Verificar qué permisos y vistas tiene un usuario específico.
- Dar soporte técnico sin pedirle al usuario que comparta pantalla.

El administrador cambia temporalmente su identidad en el sistema. Mientras dure la suplantación, todo lo que vea será exactamente lo que vería el usuario suplantado. Al terminar, el administrador regresa a su propia cuenta.

---

## ¿Cómo funciona internamente?

El mecanismo se apoya en la **sesión del servidor**. La sesión es el espacio donde el sistema guarda información temporal del usuario conectado (por ejemplo, quién es, cuándo se conectó, etc.).

### Paso 1 — Iniciar la suplantación

Cuando el administrador hace clic en "Iniciar sesión como este usuario":

1. El sistema verifica que quien hace la solicitud sea el **administrador principal** (no cualquier admin, solo el maestro).
2. Se guarda el ID del administrador en una variable de sesión llamada `impersonating_from`. Esto es como dejar una nota que dice: "el que realmente está aquí es el admin #1".
3. Se inicia sesión con la cuenta del usuario objetivo. A partir de este momento, el sistema trata al administrador como si fuera ese usuario.
4. Se redirige al panel principal, donde el admin ya ve todo desde la perspectiva del usuario.

### Paso 2 — Durante la suplantación

Mientras el administrador navega como otro usuario:

- Se muestra una **barra roja fija** en la parte superior de **todas las páginas** que dice: *"Viendo como [nombre del usuario]"* con un enlace para volver.
- Esta barra aparece porque en cada carga de página, el sistema revisa si existe la variable `impersonating_from` en la sesión. Si existe, muestra la barra.

### Paso 3 — Terminar la suplantación

Cuando el administrador hace clic en "Volver a mi cuenta":

1. Se lee el valor de `impersonating_from` (el ID del admin original) y se elimina de la sesión.
2. Se inicia sesión nuevamente con la cuenta del administrador.
3. Se redirige al panel de administración.

---

## Diagrama del flujo

```
Admin hace clic en "Suplantar"
        │
        ▼
¿Es el admin principal? ── NO ──▶ Denegar acceso
        │
       SÍ
        │
        ▼
Guardar admin_id en sesión como "impersonating_from"
        │
        ▼
Iniciar sesión como el usuario objetivo
        │
        ▼
Redirigir al inicio (el admin ahora ve como el usuario)
        │
        ▼
Todas las páginas muestran barra roja: "Viendo como [usuario]"
        │
        ▼
Admin hace clic en "Volver a mi cuenta"
        │
        ▼
Leer "impersonating_from" → recuperar admin_id
        │
        ▼
Eliminar "impersonating_from" de la sesión
        │
        ▼
Iniciar sesión como el admin original
        │
        ▼
Redirigir al panel de administración
```

---

## Consideraciones de seguridad

Estas reglas son obligatorias para cualquier implementación:

1. **Solo el administrador maestro** puede usar esta función. No cualquier usuario con rol de admin.
2. **Registrar todo en bitácora**: quién suplantó a quién, cuándo empezó, cuándo terminó, y desde qué IP.
3. **La barra de advertencia debe ser visible siempre**. Si el admin cierra sesión sin volver primero a su cuenta, la variable de sesión debe limpiarse automáticamente.
4. **No permitir suplantación encadenada**: si ya estás suplantando a alguien, no puedes suplantar a otro usuario desde esa cuenta.

---

## Modelo de datos necesario

Para implementar esta funcionalidad se necesitan estos elementos en la base de datos y la sesión:

| Elemento | Dónde vive | Descripción |
|---|---|---|
| `user_id` | Tabla [users](file:///c:/Users/DomingoAlcantara/Downloads/powerpoint-automated-web/blueprints/admin.py#98-122) | Identificador único de cada usuario |
| `email` o [role](file:///c:/Users/DomingoAlcantara/Downloads/powerpoint-automated-web/blueprints/admin.py#487-497) | Tabla [users](file:///c:/Users/DomingoAlcantara/Downloads/powerpoint-automated-web/blueprints/admin.py#98-122) | Para verificar si es el admin principal |
| `impersonating_from` | Sesión del servidor | Almacena el ID del admin original durante la suplantación |
| `activity_logs` | Tabla en BD | Registra cada inicio y fin de suplantación |

---

## Implementación de referencia (Flask / Python)

A continuación se muestra el código tal como está implementado en el proyecto actual. Sirve como referencia para adaptarlo a cualquier otro lenguaje o framework.

### Rutas del backend

```python
from flask import session, redirect, url_for, flash
from flask_login import login_required, current_user, login_user

# Correo del admin principal (se puede cargar de variable de entorno)
ADMIN_PRINCIPAL = 'admin@ejemplo.com'

# ── Iniciar suplantación ──
@admin_bp.route('/users/<int:user_id>/impersonate', methods=['POST'])
@admin_required
def user_impersonate(user_id):
    # Solo el admin principal puede usar esta función
    if current_user.email != ADMIN_PRINCIPAL:
        flash('Solo el administrador principal puede usar esta función.', 'error')
        return redirect(url_for('admin.users_list'))

    target = User.query.get_or_404(user_id)

    # Guardar el ID del admin en la sesión
    session['impersonating_from'] = current_user.id

    # Registrar en bitácora
    log_activity('impersonate_start', f'Suplantando a {target.username}')

    # Cambiar la sesión al usuario objetivo
    login_user(target)

    flash(f'Ahora estás viendo como {target.username}.', 'info')
    return redirect(url_for('menu'))


# ── Terminar suplantación ──
@admin_bp.route('/stop-impersonation')
@login_required
def stop_impersonation():
    admin_id = session.pop('impersonating_from', None)

    if admin_id:
        admin_user = User.query.get(admin_id)
        if admin_user:
            login_user(admin_user)
            log_activity('impersonate_stop', 'Regresó a cuenta admin')
            flash('Has vuelto a tu cuenta de administrador.', 'success')

    return redirect(url_for('admin.users_list'))
```

### Barra de advertencia en el HTML (plantilla global)

Este bloque se coloca en la plantilla base, antes del contenido principal, para que aparezca en todas las páginas:

```html
{% if session.get('impersonating_from') %}
<div class="impersonation-banner">
    <i class="fa-solid fa-user-secret"></i>
    Viendo como <strong>{{ current_user.username }}</strong>
    <a href="{{ url_for('admin.stop_impersonation') }}">Volver a mi cuenta</a>
</div>
{% endif %}
```

### Botón para iniciar la suplantación (pantalla de usuarios)

Este botón aparece en la tabla de usuarios, solo visible para el administrador principal:

```html
{% if current_user.email == 'admin@ejemplo.com' %}
<form method="POST"
      action="{{ url_for('admin.user_impersonate', user_id=user.id) }}"
      onsubmit="return confirm('¿Iniciar sesión como {{ user.username }}?');">
    <input type="hidden" name="csrf_token" value="{{ csrf_token() }}">
    <button type="submit" title="Login como este usuario">
        <i class="fa-solid fa-user-secret"></i>
    </button>
</form>
{% endif %}
```

### Estilos CSS de la barra

```css
.impersonation-banner {
    background: linear-gradient(90deg, #ef4444, #dc2626);
    color: #fff;
    padding: 8px 20px;
    text-align: center;
    font-size: 0.85rem;
    font-weight: 600;
    position: sticky;
    top: 0;
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
}

.impersonation-banner a {
    color: #fff;
    text-decoration: underline;
    font-weight: 700;
}
```

---

## Ejemplo completo en JavaScript (Node.js + React)

A continuación el mismo concepto implementado con Express en el backend y React en el frontend.

### Backend — Express (Node.js)

Se asume que ya tienes `express-session` configurado y un middleware de autenticación que coloca el usuario actual en `req.user`.

```javascript
// middleware/auth.js
// Middleware que verifica si el usuario está autenticado
function requireAuth(req, res, next) {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'No autenticado' });
    }
    next();
}

// Middleware que verifica si es admin maestro
function requireMasterAdmin(req, res, next) {
    if (req.user.email !== process.env.ADMIN_EMAIL) {
        return res.status(403).json({ error: 'Solo el admin principal puede hacer esto' });
    }
    next();
}

module.exports = { requireAuth, requireMasterAdmin };
```

```javascript
// routes/admin.js
const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { requireAuth, requireMasterAdmin } = require('../middleware/auth');

// ── Iniciar suplantación ──
router.post('/users/:userId/impersonate', requireAuth, requireMasterAdmin, async (req, res) => {
    const target = await User.findById(req.params.userId);
    if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });

    // Guardar el ID del admin original en la sesión
    req.session.impersonatingFrom = req.session.userId;

    // Cambiar la identidad activa al usuario objetivo
    req.session.userId = target.id;

    // Registrar en bitácora (implementar según tu sistema de logs)
    console.log(`Admin ${req.session.impersonatingFrom} suplantó a ${target.username}`);

    res.json({ success: true, message: `Ahora ves como ${target.username}` });
});

// ── Terminar suplantación ──
router.post('/stop-impersonation', requireAuth, async (req, res) => {
    const adminId = req.session.impersonatingFrom;

    if (!adminId) {
        return res.status(400).json({ error: 'No estás suplantando a nadie' });
    }

    // Restaurar la identidad del admin
    req.session.userId = adminId;
    delete req.session.impersonatingFrom;

    console.log(`Admin ${adminId} terminó la suplantación`);

    res.json({ success: true, message: 'Volviste a tu cuenta de administrador' });
});

// ── Endpoint para saber el estado actual ──
// React lo consulta para saber si debe mostrar la barra
router.get('/me', requireAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.json({
        user: { id: user.id, username: user.username, email: user.email, role: user.role },
        isImpersonating: !!req.session.impersonatingFrom
    });
});

module.exports = router;
```

### Frontend — React

```jsx
// components/ImpersonationBanner.jsx
// Este componente se coloca en el Layout principal, arriba de todo.
// Se muestra solo cuando el admin está suplantando a alguien.

import { useState, useEffect } from 'react';

export default function ImpersonationBanner() {
    const [impersonating, setImpersonating] = useState(false);
    const [username, setUsername] = useState('');

    useEffect(() => {
        // Consultar al backend si estamos en modo suplantación
        fetch('/api/admin/me', { credentials: 'include' })
            .then(res => res.json())
            .then(data => {
                setImpersonating(data.isImpersonating);
                setUsername(data.user.username);
            })
            .catch(() => {});
    }, []);

    const handleStop = async () => {
        const res = await fetch('/api/admin/stop-impersonation', {
            method: 'POST',
            credentials: 'include'
        });
        if (res.ok) {
            window.location.href = '/admin/users'; // Redirigir al panel de admin
        }
    };

    if (!impersonating) return null;

    return (
        <div style={{
            background: 'linear-gradient(90deg, #ef4444, #dc2626)',
            color: '#fff',
            padding: '8px 20px',
            textAlign: 'center',
            fontSize: '0.85rem',
            fontWeight: 600,
            position: 'sticky',
            top: 0,
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px'
        }}>
            🕵️ Viendo como <strong>{username}</strong>
            <button
                onClick={handleStop}
                style={{
                    background: 'none',
                    border: 'none',
                    color: '#fff',
                    textDecoration: 'underline',
                    fontWeight: 700,
                    cursor: 'pointer',
                    fontSize: 'inherit'
                }}
            >
                Volver a mi cuenta
            </button>
        </div>
    );
}
```

```jsx
// components/UserTable.jsx (fragmento)
// Botón de suplantación en la tabla de usuarios del admin

function ImpersonateButton({ userId, username }) {
    const handleClick = async () => {
        if (!window.confirm(`¿Iniciar sesión como ${username}?`)) return;

        const res = await fetch(`/api/admin/users/${userId}/impersonate`, {
            method: 'POST',
            credentials: 'include'
        });

        if (res.ok) {
            window.location.href = '/'; // Redirigir al inicio como el usuario
        }
    };

    return (
        <button onClick={handleClick} title="Login como este usuario">
            🕵️
        </button>
    );
}
```

```jsx
// App.jsx o Layout.jsx — Colocar el banner en el layout principal
import ImpersonationBanner from './components/ImpersonationBanner';

function Layout({ children }) {
    return (
        <>
            <ImpersonationBanner />
            <nav>{/* tu navegación */}</nav>
            <main>{children}</main>
        </>
    );
}
```

---

## Cómo adaptarlo a otro framework

La lógica es la misma independientemente de la tecnología. Lo que cambia es la sintaxis:

| Concepto | Flask (Python) | Express (Node.js) | Laravel (PHP) | Django (Python) |
|---|---|---|---|---|
| Sesión | `session['key']` | `req.session.key` | `session()->put('key')` | `request.session['key']` |
| Login como otro | `login_user(target)` | Asignar `req.session.userId` | `Auth::loginUsingId($id)` | `login(request, user)` |
| Leer sesión en template | `session.get('key')` | Pasar vía middleware | `session('key')` | `request.session.get('key')` |
| Eliminar de sesión | `session.pop('key')` | `delete req.session.key` | `session()->forget('key')` | `del request.session['key']` |

Los pasos siempre son:
1. Verificar que sea el admin maestro.
2. Guardar el ID original en la sesión.
3. Cambiar la identidad activa.
4. Mostrar la barra de aviso.
5. Al terminar, restaurar la identidad original.
