import Image from "next/image";

type SessionQRCodeProps = {
  dataUrl: string;
  alt: string;
};

/**
 * Renders a pre-generated QR code image.
 *
 * The data URL is produced server-side (in the parent Server Component) so
 * the QR code is embedded directly in the initial HTML — no client-side
 * async generation, no blank-box flash on load.
 */
export default function SessionQRCode({ dataUrl, alt }: SessionQRCodeProps) {
  return (
    <div className="w-full max-w-sm rounded-[28px] border border-white/60 bg-white/40 backdrop-blur-md p-5 shadow-lg">
      <div className="mx-auto flex aspect-square w-full items-center justify-center rounded-[20px] bg-white p-3 shadow-sm">
        <Image
          src={dataUrl}
          alt={alt}
          width={400}
          height={400}
          unoptimized
          className="aspect-square w-full rounded-[16px]"
        />
      </div>
    </div>
  );
}
