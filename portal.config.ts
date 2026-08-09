import { defineConfig } from "@portalsdk/config";

/**
 * Configuración de Portal.
 *
 * Se despliega con `portal deploy`, que lee `PORTAL_SECRET=sk_...` del entorno.
 * La llave publicable (`pk_...`) va aparte, en `NEXT_PUBLIC_PORTAL_API_KEY`.
 *
 * `sala-*` es una plantilla: cubre todos los canales `sala:{id}` sin tener
 * que declararlos uno por uno.
 */

/**
 * El emisor de los tokens: el Frontend API de Clerk, que es también el `iss`
 * de cada JWT y de donde cuelga el JWKS.
 *
 * No hay que copiarlo de ningún lado: la publishable key ES ese dominio en
 * base64 con un `$` de terminador (`pk_test_<base64(dominio$)>`), así que se
 * deriva. `CLERK_ISSUER` queda solo como escape para dominios propios.
 *
 * Sin esto no se puede exigir sesión: no habría con qué verificar los tokens.
 */
function emisorDeClerk(): string | undefined {
  if (process.env.CLERK_ISSUER) return process.env.CLERK_ISSUER.replace(/\/$/, "");

  const clave = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const cuerpo = clave?.replace(/^pk_(test|live)_/, "");
  if (!cuerpo || cuerpo === clave) return undefined;

  try {
    const dominio = Buffer.from(cuerpo, "base64").toString("utf8").replace(/\$$/, "");
    // Un base64 inválido no tira: decodifica a basura. Se exige que parezca
    // un host antes de darlo por bueno.
    return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(dominio) ? `https://${dominio}` : undefined;
  } catch {
    return undefined;
  }
}

const emisor = emisorDeClerk();

/**
 * Exigir sesión SOLO si hay con qué verificarla.
 *
 * Dos esquinas del esquema que ya nos mordieron (verificadas contra los .d.ts
 * de @portalsdk/config, no contra la intuición):
 *
 *  - `auth` vive en la RAÍZ de la config, es por proyecto. Dentro de la
 *    entrada del canal se compila igual (el spread esquiva el chequeo de
 *    propiedades sobrantes) y el deploy no verifica nada.
 *  - Las plantillas matchean por prefijo fijo. Los canales reales se llaman
 *    `sala:{id}` (ver `canalDeSala`), así que la clave es `sala:*` — con
 *    `sala-*` la regla no aplicaría a ningún canal existente.
 */
export default defineConfig({
  ...(emisor
    ? {
        auth: {
          issuer: emisor,
          jwksUrl: `${emisor}/.well-known/jwks.json`,
          /**
           * De dónde saca Portal la identidad dentro del token.
           *
           * `username` es lo que termina viéndose en la presencia, y por eso
           * es el nombre que nadie puede falsificar desde el cliente. Requiere
           * una plantilla JWT en Clerk llamada `portal` con ese claim.
           */
          claimMap: { userId: "sub", username: "name" },
        },
      }
    : {}),
  channels: {
    "sala:*": {
      mode: "standard",
      // Cualquiera con el enlace entra… pero, con auth configurada, teniendo
      // sesión iniciada. La sala es pública; la identidad no es opcional.
      access: "open",
      // Sin emisor no hay cómo verificar tokens: todo corre en anónimo.
      anonymous: !emisor,
    },
  },
});
