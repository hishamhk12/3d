import fs from "fs";
import path from "path";
import type { Metadata } from "next";
import Image from "next/image";

export const metadata: Metadata = {
  title: "Product QR Labels",
};

type QrLabel = {
  productCode: string;
  qrFileName: string;
  productFileName: string | null;
};

const allowedProductExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);

function readFilesIfDirectory(directory: string) {
  if (!fs.existsSync(directory)) return [];

  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function publicAssetPath(...segments: string[]) {
  return `/${segments.map((segment) => encodeURIComponent(segment)).join("/")}`;
}

function getQrLabels(): QrLabel[] {
  const publicDir = path.join(process.cwd(), "public");
  const labelsDir = path.join(publicDir, "qr-labels");
  const productsDir = path.join(publicDir, "qr-products");

  const productFiles = readFilesIfDirectory(productsDir).filter((fileName) =>
    allowedProductExtensions.has(path.extname(fileName).toLowerCase()),
  );

  const productFileByCode = new Map(
    productFiles.map((fileName) => [path.parse(fileName).name, fileName]),
  );

  return readFilesIfDirectory(labelsDir)
    .filter((fileName) => path.extname(fileName).toLowerCase() === ".png")
    .map((qrFileName) => {
      const productCode = path.parse(qrFileName).name;

      return {
        productCode,
        qrFileName,
        productFileName: productFileByCode.get(productCode) ?? null,
      };
    });
}

export default function ProductQrPrintPage() {
  const labels = getQrLabels();

  return (
    <main className="min-h-screen bg-white px-6 py-8 text-slate-950 print:min-h-0 print:px-0 print:py-0">
      <section className="mx-auto max-w-6xl print:max-w-none">
        <div className="mb-8 flex flex-col gap-2 border-b border-slate-200 pb-5 print:hidden">
          <h1 className="text-3xl font-bold tracking-normal text-slate-950">
            Product QR Labels
          </h1>
          <p className="text-sm text-slate-600">
            Press Ctrl + P to print. Each printed QR opens its permanent product scan page.
          </p>
        </div>

        {labels.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center print:hidden">
            <p className="font-semibold text-slate-900">No QR labels found.</p>
            <p className="mt-2 text-sm text-slate-600">
              Run npm run generate:product-qr, then refresh this page.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-3 print:gap-3">
            {labels.map((label) => (
              <article
                key={label.qrFileName}
                className="break-inside-avoid rounded-lg border border-slate-300 bg-white p-4 text-center shadow-sm print:rounded-none print:p-3 print:shadow-none"
              >
                <Image
                  src={publicAssetPath("qr-labels", label.qrFileName)}
                  alt={`QR code for ${label.productCode}`}
                  width={900}
                  height={900}
                  unoptimized
                  className="mx-auto aspect-square w-full max-w-[260px] object-contain print:max-w-[42mm]"
                />
                <h2 className="mt-3 break-words text-2xl font-black tracking-normal text-slate-950 print:text-[18pt]">
                  {label.productCode}
                </h2>
                <p className="mt-1 break-all font-mono text-[11px] text-slate-500 print:text-[8pt]">
                  /scan/{label.productCode}
                </p>

                <div className="mt-3 flex items-center justify-center gap-3 border-t border-slate-200 pt-3">
                  {label.productFileName ? (
                    <>
                      <Image
                        src={publicAssetPath("qr-products", label.productFileName)}
                        alt=""
                        width={96}
                        height={96}
                        unoptimized
                        className="h-12 w-12 rounded border border-slate-200 object-cover print:h-9 print:w-9"
                      />
                      <p className="min-w-0 break-all text-left text-xs font-semibold text-slate-700 print:text-[8pt]">
                        {label.productFileName}
                      </p>
                    </>
                  ) : (
                    <p className="text-xs font-semibold text-red-700 print:text-[8pt]">
                      No matching product image found
                    </p>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
