/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");
const QRCode = require("qrcode");
const { loadEnvConfig } = require("@next/env");

const projectDir = process.cwd();
const isDevelopment = process.env.NODE_ENV !== "production";

loadEnvConfig(projectDir, isDevelopment);

const productsDir = path.join(projectDir, "public", "qr-products");
const labelsDir = path.join(projectDir, "public", "qr-labels");
const allowedExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);

function getBaseUrl() {
  const configuredUrl = process.env.NEXT_PUBLIC_BASE_URL?.trim();

  if (configuredUrl) {
    return configuredUrl.replace(/\/+$/, "");
  }

  if (isDevelopment) {
    return "http://localhost:3000";
  }

  throw new Error(
    "NEXT_PUBLIC_BASE_URL is required when generating product QR labels outside development.",
  );
}

async function main() {
  if (!fs.existsSync(productsDir)) {
    throw new Error(`Product image folder not found: ${productsDir}`);
  }

  fs.mkdirSync(labelsDir, { recursive: true });

  const baseUrl = getBaseUrl();
  const productImages = fs
    .readdirSync(productsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((fileName) => allowedExtensions.has(path.extname(fileName).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  if (productImages.length === 0) {
    console.log(`No product images found in ${productsDir}`);
    return;
  }

  const generatedCodes = new Set();

  for (const fileName of productImages) {
    const productCode = path.parse(fileName).name;

    if (generatedCodes.has(productCode)) {
      console.warn(
        `[skip] ${productCode} from ${fileName}: QR already generated for this product code.`,
      );
      continue;
    }

    generatedCodes.add(productCode);

    const url = `${baseUrl}/scan/${productCode}`;
    const outputPath = path.join(labelsDir, `${productCode}.png`);

    await QRCode.toFile(outputPath, url, {
      errorCorrectionLevel: "H",
      margin: 2,
      width: 900,
      type: "png",
      color: {
        dark: "#000000",
        light: "#ffffff",
      },
    });

    console.log(`[generated] ${productCode} -> ${url}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
