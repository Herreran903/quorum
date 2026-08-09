# La sala — una sesión de agente que el equipo comparte

Un agente de IA trabaja una tarea larga dentro de un chat que **todo el equipo
ve en vivo**. Cualquiera entra, lo corrige, y puede tomarle el mando sin que
se pierda el contexto.

Hoy trabajar con IA es de un jugador: abrís un chat, escribís, y la respuesta
la ves solo vos. Acá la sesión es el lugar compartido, no una transcripción
que se comparte después.

## Qué la hace distinta

- **Se ve quién pidió qué.** Cada instrucción queda atribuida, y cuando el
  agente la incorpora lo dice: *"aplicó lo que pidió Ana"*. El panel derecho
  lleva el consolidado por persona, con cuántos pedidos ya entraron.
- **El resultado se construye a la vista.** Si la tarea pide código, el panel
  muestra el archivo; si pide investigar o redactar, un documento. Se
  reescribe turno a turno.
- **Cuando el equipo se contradice, se vota.** Dos pedidos que chocan abren
  una votación que frena al agente hasta que se resuelva. Se ve quién votó
  qué, y el resultado queda en la transcripción.
- **Un solo conductor.** El agente corre en la pestaña de una persona. Si otra
  quiere seguir, toma el mando y la primera se detiene sola — nunca dos
  agentes publicando encima.
- **Se calla mientras escribís.** Si alguien está tecleando, el agente espera
  su turno.

## Correr

```bash
npm run dev
```

Abrí `/` — crea una sala y te lleva. Compartí esa URL para que se sumen.

Para probar solo, abrí la misma URL en dos pestañas.

## Configuración

Todo es opcional: sin ninguna clave la app funciona, degradando de forma
explícita.

| variable | sin ella |
| --- | --- |
| `ANTHROPIC_API_KEY` | el agente sigue un guion fijo en vez de pensar |
| `NEXT_PUBLIC_PORTAL_API_KEY` | la sincronización usa BroadcastChannel (solo entre pestañas del mismo navegador) |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` + `CLERK_SECRET_KEY` | sin login: apodos generados en vez de perfiles reales |

`?transporte=mock` en la URL fuerza el transporte local aunque haya clave de
Portal. Existe para el demo: si Portal falla en vivo, la sesión sigue
funcionando entre pestañas sin tocar nada.

### Identidad real

Las claves de Clerk se sacan sin abrir cuenta:

```bash
npx clerk@latest init --keyless
```

Eso deja una app de desarrollo temporal. Para que sea permanente y para poder
configurarla, hay que reclamarla:

```bash
npx clerk auth login
```

El nombre que ve el equipo lo extrae **Portal** del token firmado
(`claimMap.username`), no lo declara el navegador: nadie puede hacerse pasar
por otro. Para que ese claim exista hay que crear en Clerk una plantilla JWT
llamada `portal` con el claim `name`. Sin ella la identidad sigue siendo real
—el `sub` va firmado— pero el nombre viaja sin verificar.

Con identidad configurada, el canal pasa a exigir sesión. Hay que desplegarlo:

```bash
npx portal deploy
```

## Mapa

| archivo | qué es |
| --- | --- |
| `src/lib/protocolo.ts` | todo lo que viaja por el canal, y nada más |
| `src/lib/useChat.ts` | el estado, reducido del canal. La única fuente de verdad |
| `src/lib/agente-chat.ts` | el agente: cuándo habla, cuándo cede, cuándo se calla |
| `src/lib/modelo-turno.ts` | qué se le pide al modelo y cómo se sanea lo que devuelve |
| `src/lib/transporte.ts` | la interfaz de red. El resto de la app solo habla con esto |
| `src/lib/identidad.ts` | quién sos, sin que la app conozca a Clerk |
| `src/app/sala/[id]/panel.tsx` | la pantalla |

El agente no guarda estado propio: **lee** el de `useChat`. Por eso da igual
en qué pestaña se escriba algo, y por eso el traspaso no pierde contexto — el
contexto nunca fue de la pestaña, fue del canal.

## Verificar

```bash
npm test && npx tsc --noEmit && npm run lint && npm run build
```

## Referencias

- [Python + Agentes: creando agentes y flujos de IA](https://developer.microsoft.com/en-us/reactor/series/S-1633/) —
  serie en español de Microsoft Reactor (feb–mar 2026) sobre construcción de
  agentes: herramientas, memoria, evaluación y orquestación.
