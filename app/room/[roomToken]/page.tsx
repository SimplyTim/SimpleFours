import RoomClient from "@/components/RoomClient";

interface RoomPageProps {
  params: Promise<{ roomToken: string }>;
}

export default async function RoomPage({ params }: RoomPageProps) {
  const resolvedParams = await Promise.resolve(params);
  return <RoomClient roomToken={resolvedParams.roomToken.toUpperCase()} />;
}
