import { Sala } from "./sala";

export default async function PaginaSesion({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <Sala idSesion={id} />;
}
