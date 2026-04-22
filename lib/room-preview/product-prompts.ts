import "server-only";

import { products, type ProductType } from "@/data/products";

// ─── Shared rules ─────────────────────────────────────────────────────────────

const PRESERVE_REALISM = `\
- Preserve the original perspective and vanishing points.
- Preserve all existing light sources, shadows, and ambient occlusion.
- Preserve the original image resolution and aspect ratio exactly.
- Keep realistic material scale relative to the space.
- No CGI plastic look, no over-saturation, no HDR halo.`;

const DO_NOT_TOUCH_FLOOR = `- Do not modify the floor, ceiling, or any horizontal surface.`;
const DO_NOT_TOUCH_WALLS = `- Do not modify walls, windows, doors, or skirting boards.`;
const DO_NOT_TOUCH_OBJECTS = `- Do not add, remove, or alter furniture, plants, people, decorations, or any objects in the scene.`;
const DO_NOT_TOUCH_POOL = `- Do not modify the pool structure, surrounding tiles, deck, or water reflections outside the pool basin.`;
const NO_ADDITIONS = `- Do not add text, logos, watermarks, borders, or any new architectural elements.`;

// ─── Prompt builders ──────────────────────────────────────────────────────────

function floorPrompt(materialDescription: string): string {
  return `\
ROLE
You are a premium photorealistic interior visualization engine for a luxury flooring showroom.

INPUTS
Image A: original room photograph.
Image B: ${materialDescription} sample / reference texture.

TASK
Replace only the visible floor surface in Image A with the material shown in Image B.

WHAT TO CHANGE
- Floor surface only — replace every visible floor pixel with the new material.
- Match the material's texture, pattern, color, finish, and repeat from Image B.
- Apply correct perspective projection so the material lies flat on the floor plane.

WHAT NOT TO CHANGE
${DO_NOT_TOUCH_WALLS}
${DO_NOT_TOUCH_OBJECTS}
${NO_ADDITIONS}

REALISM
${PRESERVE_REALISM}
- Preserve all contact shadows cast by furniture onto the floor.
- Maintain seamless integration at furniture contact points.

QUALITY BAR
The result must look as if the material was physically installed — correct scale, realistic lighting, proper perspective, and seamless edges.`;
}

function wallPrompt(materialDescription: string): string {
  return `\
ROLE
You are a premium photorealistic interior visualization engine for a luxury wall-finishing showroom.

INPUTS
Image A: original room photograph.
Image B: ${materialDescription} sample / reference texture.

TASK
Replace only the visible wall surfaces in Image A with the material shown in Image B.

WHAT TO CHANGE
- Wall surfaces only — replace every visible wall pixel with the new material.
- Match the material's texture, pattern, color, finish, and repeat from Image B.
- Wrap the material correctly around corners and architectural features.

WHAT NOT TO CHANGE
${DO_NOT_TOUCH_FLOOR}
- Do not modify windows, doors, door frames, window frames, or skirting boards.
${DO_NOT_TOUCH_OBJECTS}
${NO_ADDITIONS}

REALISM
${PRESERVE_REALISM}
- Preserve existing wall lighting, sconces, and shadows cast by wall-mounted fixtures.
- Maintain correct material scale — panels and tiles must look proportional to the room.

QUALITY BAR
The result must look as if the wall finish was physically applied — no floating textures, correct corner wrapping, and seamless integration with all trim elements.`;
}

// ─── Prompt map ───────────────────────────────────────────────────────────────

const prompts: Record<ProductType, string> = {

  floor_plank: floorPrompt("wood flooring plank"),

  floor_tile: floorPrompt("carpet tile (modular, 50×50 cm grid)"),

  large_tile: floorPrompt("large-format ceramic or porcelain tile"),

  wallpaper: wallPrompt("decorative wallpaper"),

  wall_panel: wallPrompt("MDF / wood wall panel"),

  stone_panel: wallPrompt("natural or engineered stone wall panel"),

  pool_tile: `\
ROLE
You are a premium photorealistic visualization engine for a luxury pool and outdoor showroom.

INPUTS
Image A: original pool photograph.
Image B: pool tile sample / reference texture.

TASK
Replace only the visible tile surface inside the pool basin in Image A with the tile shown in Image B.

WHAT TO CHANGE
- Pool basin interior surface only — floor and walls of the pool below the waterline.
- Match the tile's color, finish, grout lines, and repeat pattern from Image B.
- Simulate correct underwater light refraction and color shift.

WHAT NOT TO CHANGE
${DO_NOT_TOUCH_POOL}
${DO_NOT_TOUCH_OBJECTS}
${NO_ADDITIONS}

REALISM
${PRESERVE_REALISM}
- Preserve water transparency, caustics, and surface reflections.
- Maintain the visual depth illusion of the pool water.

QUALITY BAR
The result must look as if the pool was re-tiled — correct underwater color rendering, realistic grout lines, and natural water-surface interaction.`,

  outdoor_object: `\
ROLE
You are a premium photorealistic visualization engine for a luxury outdoor furniture showroom.

INPUTS
Image A: original outdoor space photograph (garden, terrace, patio, etc.).
Image B: outdoor furniture or accessory product photograph.

TASK
Place the product from Image B into the outdoor space shown in Image A in a natural and realistic position.

WHAT TO CHANGE
- Add the product from Image B into the scene at a realistic position, scale, and orientation.
- Cast a natural shadow from the product based on the existing light direction in Image A.
- Blend the product's base with the ground surface (grass, tile, gravel, etc.).

WHAT NOT TO CHANGE
- Do not modify the existing outdoor space, landscaping, fencing, or architecture.
- Do not remove or alter existing furniture already present in Image A.
${NO_ADDITIONS}

REALISM
${PRESERVE_REALISM}
- Match the product's lighting to the outdoor ambient light and sun angle in Image A.
- Scale the product realistically relative to the surrounding space and any reference objects.

QUALITY BAR
The result must look as if the furniture was physically placed in the space — correct scale, natural shadow, and seamless ground contact.`,

  shade_object: `\
ROLE
You are a premium photorealistic visualization engine for a luxury outdoor shade and canopy showroom.

INPUTS
Image A: original outdoor space photograph.
Image B: shade structure product photograph (umbrella, pergola, awning, sail shade, etc.).

TASK
Place the shade structure from Image B into the outdoor space shown in Image A in a natural and functional position.

WHAT TO CHANGE
- Add the shade structure from Image B at a realistic position, scale, and orientation above the outdoor area.
- Cast a natural diffused shadow beneath the shade onto the ground and any objects below it.
- Render the fabric or material translucency correctly based on the light source in Image A.

WHAT NOT TO CHANGE
- Do not modify the existing outdoor space, landscaping, or architecture.
- Do not remove or alter existing objects in Image A.
${NO_ADDITIONS}

REALISM
${PRESERVE_REALISM}
- Match the shade structure's lighting to the sun angle and sky conditions in Image A.
- Scale the structure realistically relative to the surrounding furniture and space.

QUALITY BAR
The result must look as if the shade structure was physically installed — correct scale, realistic shadow casting, and natural fabric appearance.`,

};

// ─── Public API ───────────────────────────────────────────────────────────────

export function getPromptForProductType(type: ProductType): string {
  return prompts[type];
}

export function getPromptForProduct(productCode: string): string {
  const product = products.find((p) => p.code === productCode);
  if (!product) throw new Error(`Product not found: ${productCode}`);
  return prompts[product.type as ProductType];
}
