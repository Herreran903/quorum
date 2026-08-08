# Acta — sesión de agente

Una sesión de agente de IA que varias personas ven en vivo y pueden intervenir.

El diferenciador no es la sesión compartida. Es que **el agente decide cuándo
hablar según quién esté mirando la sala**:

- nadie mira → avanza solo y encola las dudas como *volantes*
- hay gente y el paso es arriesgado → se detiene y pregunta
- alguien está escribiendo → se calla y espera
- varias dudas seguidas → se preguntan como **una sola**, nunca como ráfaga

Esa última regla ataca el modo de fallo documentado de los agentes
colaborativos: saturar al humano con comentarios.

## Correr

```bash
npm run dev
```

Abre `/sesion/demo` **en dos pestañas**. En una, dale a "arrancar agente".

- con una sola pestaña la sala está vacía (el agente no se cuenta a sí mismo):
  avanza los 12 pasos solo y deja 5 volantes
- abre la segunda pestaña: los volantes salen como **una sola** pregunta
- escribe en cualquiera de las dos: el agente se calla mientras tecleas

## Mapa

| archivo | qué es |
| --- | --- |
| `src/lib/iniciativa.ts` | **la política**. `decidir()` pura + `Politica` con agrupación |
| `src/lib/protocolo.ts` | los tipos de todo lo que viaja por el canal |
| `src/lib/transporte.ts` | la interfaz de red. El resto de la app solo habla con esto |
| `src/lib/transporte-mock.ts` | BroadcastChannel + localStorage, sin red |
| `src/lib/transporte-portal.ts` | Portal de verdad |
| `src/lib/simulador.ts` | agente falso, un paso cada 2s, sin LLM |
| `src/app/sesion/[id]/` | la sala |

## Cambiar mock → Portal

Una línea, en `.env.local`:

```
NEXT_PUBLIC_PORTAL_API_KEY=pk_...
```

`crearTransporte()` en `src/lib/transporte.ts` es el único punto de decisión.
Sin llave, todo corre sobre BroadcastChannel.

Para obtener la llave (verificado contra `@portalsdk/cli` 0.5.5):

```bash
npx portal login
```

```bash
npx portal projects create <nombre-del-proyecto>
```

```bash
npx portal keys create
```

El valor se imprime **una sola vez**.

## Verificar

```bash
npm test && npx tsc --noEmit && npm run build
```
