export const products = [
  { code: "PQC201-001", name: "باركيه رمادي كلاسيك",  type: "floor_plank", target: "floor", image: "/PQC201-1220X180X6/PQC201.001.png" },
  { code: "PQC201-002", name: "باركيه بني طبيعي",      type: "floor_plank", target: "floor", image: "/PQC201-1220X180X6/PQC201.002.png" },
  { code: "PQC201-004", name: "باركيه أبيض ناصع",      type: "floor_plank", target: "floor", image: "/PQC201-1220X180X6/PQC201.004.png" },
  { code: "PQC201-005", name: "باركيه رمادي مدخن",     type: "floor_plank", target: "floor", image: "/PQC201-1220X180X6/PQC201.005.png" },
  { code: "PQC201-006", name: "باركيه رمادي فضي",      type: "floor_plank", target: "floor", image: "/PQC201-1220X180X6/PQC201.006.png" },
  { code: "P-001",  name: "باركيه",    type: "floor_plank",    target: "floor",   image: "/products/P-001.jpg"  },
  { code: "C-001",  name: "كاربت",     type: "floor_tile",     target: "floor",   image: "/products/C-001.jpg"  },
  { code: "T-001",  name: "سيراميك",   type: "large_tile",     target: "floor",   image: "/products/T-001.jpg"  },
  { code: "W-001",  name: "ورق جدران", type: "wallpaper",      target: "wall",    image: "/products/W-001.png"  },
  { code: "M-001",  name: "MDF",       type: "wall_panel",     target: "wall",    image: "/products/M-001.jpeg" },
  { code: "S-001",  name: "بديل حجر",  type: "stone_panel",    target: "wall",    image: "/products/S-001.jpg"  },
  { code: "PT-001", name: "بلاط مسبح", type: "pool_tile",      target: "pool",    image: "/products/PT-001.jpg" },
  { code: "F-001",  name: "مفروشات",   type: "outdoor_object", target: "outdoor", image: "/products/F-001.jpg"  },
  { code: "U-001",  name: "مظلة",      type: "shade_object",   target: "outdoor", image: "/products/U-001.jpg"  },
] as const;

export type Product = typeof products[number];
export type ProductCode = Product["code"];
export type ProductType = Product["type"];
export type ProductTarget = Product["target"];
