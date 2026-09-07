import GuestSessionClient from "./guest-session-client";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function GuestSessionPage({ params }: PageProps) {
  const { id } = await params;
  return <GuestSessionClient sessionId={id} />;
}
