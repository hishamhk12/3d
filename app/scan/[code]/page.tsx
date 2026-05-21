import fs from "fs";
import path from "path";
import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";

type ProductScanPageProps = {
  params: Promise<{
    code: string;
  }>;
};

type ProductImage = {
  fileName: string;
  productCode: string;
};

export async function generateMetadata({
  params,
}: ProductScanPageProps): Promise<Metadata> {
  const { code } = await params;

  return {
    title: `Product Scan - ${code}`,
  };
}

const allowedExtensions = [".jpg", ".jpeg", ".png", ".webp"];

function publicAssetPath(...segments: string[]) {
  return `/${segments.map((segment) => encodeURIComponent(segment)).join("/")}`;
}

function findProductImage(productCode: string): ProductImage | null {
  const productsDir = path.join(process.cwd(), "public", "qr-products");

  if (!fs.existsSync(productsDir)) return null;

  const files = fs
    .readdirSync(productsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);

  for (const extension of allowedExtensions) {
    const match = files.find((fileName) => {
      const parsed = path.parse(fileName);
      return (
        parsed.name === productCode &&
        parsed.ext.toLowerCase() === extension
      );
    });

    if (match) {
      return {
        fileName: match,
        productCode,
      };
    }
  }

  return null;
}

export default async function ProductScanPage({ params }: ProductScanPageProps) {
  const { code } = await params;
  const product = findProductImage(code);

  if (!product) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--bg-page)] px-6 py-10 text-[var(--text-primary)]">
        <section className="w-full max-w-xl rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-8 text-center shadow-[var(--shadow-md)]">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">
            Product not found
          </p>
          <h1 className="mt-3 break-words text-3xl font-bold tracking-normal">
            {code}
          </h1>
          <p className="mt-4 text-sm leading-6 text-[var(--text-secondary)]">
            No image matching this product code was found in public/qr-products.
          </p>
          <Link
            href="/room-preview"
            className="mt-6 inline-flex items-center justify-center rounded-md bg-[var(--brand-navy)] px-5 py-3 text-sm font-bold text-white transition hover:opacity-90"
          >
            Back to room preview
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[var(--bg-page)] px-5 py-8 text-[var(--text-primary)]">
      <section className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">
            Product scan
          </p>
          <h1 className="mt-2 break-words text-4xl font-black tracking-normal">
            {product.productCode}
          </h1>
          <p className="mt-2 break-all text-sm text-[var(--text-secondary)]">
            {product.fileName}
          </p>
        </div>

        <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] shadow-[var(--shadow-md)]">
          <Image
            src={publicAssetPath("qr-products", product.fileName)}
            alt={`Product ${product.productCode}`}
            width={1200}
            height={900}
            unoptimized
            className="max-h-[70vh] w-full object-contain"
          />
        </div>

        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-5 shadow-[var(--shadow-sm)]">
          <p className="text-lg font-bold">Use this product in room preview</p>
          <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
            This printed product QR is recognized. Product selection is not connected to the room preview session yet.
          </p>
        </div>
      </section>
    </main>
  );
}
