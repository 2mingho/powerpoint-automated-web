import "server-only";

/* La cuenta de administrador protegida (DEFAULT_ADMIN_EMAIL de Flask): no se edita ni se puede ver como ella. (Cualquier administradora puede suplantar a personas que no administran.) */
export const EMAIL_ADMIN_PROTEGIDO = (process.env.ADMIN_EMAIL ?? "admin@dataintel.com").toLowerCase();
export const esAdminProtegido = (email: string) => email.toLowerCase() === EMAIL_ADMIN_PROTEGIDO;
