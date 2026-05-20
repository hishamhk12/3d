import { Carousel3D } from "@/components/room-preview/Carousel3D";
import { getRoomPreviewProductRoomImages } from "@/data/room-preview/product-room-images";

export default function RoomPreviewLandingPage() {
  const roomImages = getRoomPreviewProductRoomImages();

  return (
    <main style={{ background: "#0d1b35", minHeight: "100dvh" }}>
      <Carousel3D images={roomImages} />
    </main>
  );
}
