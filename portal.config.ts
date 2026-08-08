import { defineConfig } from "@portalsdk/config";

/**
 * Configuración de Portal para Quorum.
 *
 * Se despliega con `portal deploy`, que lee `PORTAL_SECRET=sk_...` del entorno.
 * La llave publicable (`pk_...`) va aparte, en `NEXT_PUBLIC_PORTAL_API_KEY`.
 *
 * `sesion-*` es una plantilla: cubre todos los canales `sesion:{id}` sin tener
 * que declararlos uno por uno.
 */
export default defineConfig({
  channels: {
    "sesion-*": {
      mode: "standard",
      // Cualquiera con el enlace entra. Es una demo, no un producto con cuentas.
      access: "open",
      anonymous: true,
      extensions: {
        // El handle con el que el cliente lee el snapshot: channel.ext["iniciativa"]
        iniciativa: "./src/extensiones/iniciativa-ext.ts",
      },
    },
  },
});
