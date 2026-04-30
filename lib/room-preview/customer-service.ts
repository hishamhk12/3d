import "server-only";

import { prisma } from "@/lib/server/prisma";
import type { Customer, CustomerExperience } from "@/lib/generated/prisma";

const CUSTOMER_EXPIRY_DAYS = 60;

function buildExpiresAt(): Date {
  const d = new Date();
  d.setDate(d.getDate() + CUSTOMER_EXPIRY_DAYS);
  return d;
}

/** Normalize a local phone number + dial code to E.164. */
export function normalizePhoneToE164(localPhone: string, dialCode: string): string {
  // Strip all non-digits, then remove leading zeros (0501234567 → 501234567)
  const digits = localPhone.replace(/\D/g, "").replace(/^0+/, "");
  return `${dialCode}${digits}`;
}

/** Mask a phone for safe logging, e.g. +966****1234 */
export function maskPhone(phoneE164: string): string {
  if (phoneE164.length <= 7) return "****";
  return `${phoneE164.slice(0, 4)}****${phoneE164.slice(-4)}`;
}

export async function findCustomerByPhone(phoneE164: string): Promise<Customer | null> {
  return prisma.customer.findUnique({ where: { phoneE164 } });
}

export async function getCustomerById(customerId: string): Promise<Customer | null> {
  return prisma.customer.findUnique({ where: { id: customerId } });
}

type CreateCustomerData = {
  name: string;
  phoneE164: string;
  countryCode: string;
  dialCode: string;
};

/**
 * Upsert customer by phoneE164. On conflict, refreshes name, lastSeenAt,
 * and expiresAt (60 days from now). Returns the customer row.
 */
export async function createOrRefreshCustomer(data: CreateCustomerData): Promise<Customer> {
  const exp = buildExpiresAt();
  return prisma.customer.upsert({
    where: { phoneE164: data.phoneE164 },
    create: {
      name: data.name,
      phoneE164: data.phoneE164,
      countryCode: data.countryCode,
      dialCode: data.dialCode,
      lastSeenAt: new Date(),
      expiresAt: exp,
    },
    update: {
      name: data.name,
      lastSeenAt: new Date(),
      expiresAt: exp,
    },
  });
}

/** Touch lastSeenAt + expiresAt for an existing customer login. */
export async function refreshCustomerLastSeen(customerId: string): Promise<void> {
  await prisma.customer.update({
    where: { id: customerId },
    data: { lastSeenAt: new Date(), expiresAt: buildExpiresAt() },
  });
}

export async function getLatestCustomerExperiences(
  customerId: string,
  limit = 3,
): Promise<CustomerExperience[]> {
  return prisma.customerExperience.findMany({
    where: { customerId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

type SaveExperienceData = {
  customerId: string;
  sessionId: string;
  roomImageUrl?: string | null;
  roomImageKey?: string | null;
  productId?: string | null;
  productName?: string | null;
  resultImageUrl?: string | null;
  resultImageKey?: string | null;
  expiresAt: Date;
};

export async function saveCustomerExperience(data: SaveExperienceData): Promise<CustomerExperience> {
  return prisma.customerExperience.create({ data });
}

/**
 * Called after a successful render. Looks up the session's customerId and,
 * if one is bound, saves a CustomerExperience record. Fire-and-forget safe.
 */
export async function saveCustomerExperienceForSession(
  sessionId: string,
  renderData: {
    roomImageUrl?: string | null;
    productId?: string | null;
    productName?: string | null;
    resultImageUrl?: string | null;
  },
): Promise<void> {
  const session = await prisma.roomPreviewSession.findUnique({
    where: { id: sessionId },
    select: { customerId: true },
  });

  if (!session?.customerId) return;

  const customer = await prisma.customer.findUnique({
    where: { id: session.customerId },
    select: { expiresAt: true },
  });

  if (!customer) return;

  await prisma.customerExperience.create({
    data: {
      customerId: session.customerId,
      sessionId,
      roomImageUrl: renderData.roomImageUrl ?? null,
      productId: renderData.productId ?? null,
      productName: renderData.productName ?? null,
      resultImageUrl: renderData.resultImageUrl ?? null,
      expiresAt: customer.expiresAt,
    },
  });
}
