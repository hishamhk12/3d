import "server-only";

/**
 * Shared WALL_CLADDING-side prompt language for the two floor+wall-cladding
 * composite strategies (parquet-wall-cladding.ts, carpet-tiles-wall-cladding.ts).
 * Factored out so both composites describe the wall cladding surface
 * identically instead of two independently-drifting copies — the floor-side
 * language stays in each strategy's own file (it differs between parquet and
 * carpet tiles) and is never touched here.
 */
export function wallCladdingCompositeWallTaskLine(wallCladdingName: string): string {
  return `Apply Reference image 2 only to the intended wall surface as wall panel / wall cladding material (${wallCladdingName}).`;
}

export function wallCladdingCompositeWallRules(): string {
  return `WALL CLADDING RULES:
- Reference image 2 is the source of truth for the wall material. First determine its physical character from the reference image itself.
- If it visibly contains panels, slats, grooves, flutes, joints, seams, or raised relief, install it as a real architectural wall panel system with realistic thickness, spacing, shadows, depth, and perspective.
- If it is flat or low-relief, apply it as a flat wall cladding material. Do not invent grooves, slats, frames, seams, or 3D relief that are not visible in the reference image.
- Do not treat it as generic wallpaper, paint, or a newly designed decorative wall.
- Apply it only to the intended wall surface — do not automatically cover every wall in the room.
- The wall material must be correctly occluded behind furniture, decorations, TVs, curtains, and foreground objects, and must not be placed over doors, windows, glass, switches, sockets, trims, or skirting boards.`;
}

export function wallCladdingCompositeNegativeLine(): string {
  return "Do not apply wall panel / wall cladding material to the floor, ceiling, doors, windows, glass, furniture, curtains, decorations, or any non-wall surface.";
}

export function wallCladdingCompositeFallbackLine(wallCladdingName: string): string {
  return `Reference image 2 is the wall panel / wall cladding material (${wallCladdingName}); read its physical character from the reference (panelled/slatted/grooved vs. flat) and apply it only to the intended wall surface, correctly occluded behind furniture and fixtures — never invent relief that is not in the reference, and never apply it to the floor, ceiling, doors, windows, or furniture.`;
}
