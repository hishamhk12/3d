import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import ScanProductClient from "./ScanProductClient";
import { resolveProductByCode } from "@/lib/room-preview/product-resolver";
import type { ResolveProductErrorCode } from "@/lib/room-preview/product-resolver";

type ProductScanPageProps = {
  params: Promise<{
    code: string;
  }>;
};

export async function generateMetadata({
  params,
}: ProductScanPageProps): Promise<Metadata> {
  const { code } = await params;

  return {
    title: `Product Scan - ${code}`,
  };
}

const ERROR_COPY: Record<ResolveProductErrorCode, { title: string; message: string }> = {
  INVALID_SKU: {
    title: "Invalid product code",
    message: "This code does not look like a valid product SKU.",
  },
  UNSUPPORTED_PRODUCT_CATEGORY: {
    title: "Product not supported",
    message: "This product category is not supported in room preview yet.",
  },
  PRODUCT_NOT_FOUND: {
    title: "Product not found",
    message: "No product with this SKU was found in the product data center.",
  },
  PRODUCT_IMAGE_MISSING: {
    title: "Product image missing",
    message: "This product has no approved preview image yet.",
  },
  PDC_AUTH_ERROR: {
    title: "Lookup unavailable",
    message: "Product lookup is temporarily unavailable. Please try again later.",
  },
  PDC_UNAVAILABLE: {
    title: "Lookup unavailable",
    message: "Product lookup failed. Please try again in a moment.",
  },
};

export default async function ProductScanPage({ params }: ProductScanPageProps) {
  const { code } = await params;
  const result = await resolveProductByCode(decodeURIComponent(code));

  if (!result.ok) {
    const copy = ERROR_COPY[result.code];

    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--bg-page)] px-6 py-10 text-[var(--text-primary)]">
        <section className="w-full max-w-xl rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-8 text-center shadow-[var(--shadow-md)]">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">
            {copy.title}
          </p>
          <h1 className="mt-3 break-words text-3xl font-bold tracking-normal">
            {code}
          </h1>
          <p className="mt-4 text-sm leading-6 text-[var(--text-secondary)]">
            {copy.message}
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

  const { product } = result;
  const displayName = product.nameAr || product.nameEn || product.name;

  return (
    <main className="min-h-screen bg-[var(--bg-page)] px-5 py-8 text-[var(--text-primary)]">
      <section className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">
            Product scan
          </p>
          <h1 className="mt-2 break-words text-4xl font-black tracking-normal">
            {displayName}
          </h1>
          {product.nameEn && product.nameEn !== displayName && (
            <p className="mt-2 break-words text-lg text-[var(--text-secondary)]">
              {product.nameEn}
            </p>
          )}
          <p className="mt-2 break-all text-sm text-[var(--text-secondary)]">
            {product.id}
          </p>
        </div>

        <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] shadow-[var(--shadow-md)]">
          <Image
            src={product.imageUrl}
            alt={`Product ${product.id}`}
            width={1200}
            height={900}
            unoptimized
            className="max-h-[70vh] w-full object-contain"
          />
        </div>

        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-5 shadow-[var(--shadow-sm)]">
          <p className="text-lg font-bold">Use this product in room preview</p>
          <ScanProductClient productCode={product.id} />
        </div>
      </section>
    </main>
  );
}
