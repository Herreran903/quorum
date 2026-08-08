import { redirect } from "next/navigation";

/**
 * La raíz no es una pantalla: crea una sala y te manda ahí.
 *
 * Una sala vive en su URL, y esa URL es lo que se comparte para que el equipo
 * entre. Una portada intermedia solo sería un clic entre vos y eso.
 */
export const dynamic = "force-dynamic";

export default function Inicio() {
  redirect(`/sala/${crypto.randomUUID().slice(0, 8)}`);
}
