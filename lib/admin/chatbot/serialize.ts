// Safe DB -> API serializers for the admin Chatbot management routes. These pick
// ONLY display-safe fields - the seller passwordHash is NEVER selected or
// returned. tokenVersion is included as read-only feedback (so the UI can show
// that a disable/reset/force-logout bumped it); the browser can never set it.

export interface SafeSeller {
  id: string;
  name: string;
  sellerCode: string;
  status: string;
  tokenVersion: number;
  showroom: { id: string; code: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
}

// The exact Prisma `select` to use for sellers (excludes passwordHash).
export const sellerSelect = {
  id: true,
  name: true,
  sellerCode: true,
  status: true,
  tokenVersion: true,
  createdAt: true,
  updatedAt: true,
  showroom: { select: { id: true, code: true, name: true } },
} as const;

type SellerRow = {
  id: string;
  name: string;
  sellerCode: string;
  status: string;
  tokenVersion: number;
  createdAt: Date;
  updatedAt: Date;
  showroom: { id: string; code: string; name: string } | null;
};

export function toSafeSeller(s: SellerRow): SafeSeller {
  return {
    id: s.id,
    name: s.name,
    sellerCode: s.sellerCode,
    status: s.status,
    tokenVersion: s.tokenVersion,
    showroom: s.showroom,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

export interface SafeShowroom {
  id: string;
  code: string;
  name: string;
  sellerCount: number;
  createdAt: string;
  updatedAt: string;
}

type ShowroomRow = {
  id: string;
  code: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  _count?: { sellers: number };
};

export function toSafeShowroom(s: ShowroomRow): SafeShowroom {
  return {
    id: s.id,
    code: s.code,
    name: s.name,
    sellerCount: s._count?.sellers ?? 0,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}
