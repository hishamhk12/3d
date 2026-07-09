import { Carousel3D } from "@/components/room-preview/Carousel3D";
import { getRoomPreviewProductRoomImages } from "@/data/room-preview/product-room-images";

export default function RoomPreviewLandingPage() {
  const roomImages = getRoomPreviewProductRoomImages();

  return (
    // Server-rendered static background: the real page image paints before
    // React hydration, with a neutral warm-dark fallback while it downloads
    // (never the old blue flash).
    <main
      style={{
        background: '#14110d url("/room-preview/private.jpg") center / cover no-repeat',
        minHeight: "100dvh",
      }}
    >
      <Carousel3D images={roomImages} />
    </main>
  );
}
