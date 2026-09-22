export const MAX_GENERATIONS = 5;

export function buildPedigreeTree(rootId, horsesById, maxGen = MAX_GENERATIONS) {
  function build(id, gen) {
    if (id == null || gen > maxGen) return null;
    const horse = horsesById.get(id);
    if (!horse) return null;
    return {
      id: horse.id,
      name: horse.name,
      gender: horse.gender,
      sire: build(horse.sire_id, gen + 1),
      dam: build(horse.dam_id, gen + 1),
    };
  }
  return build(rootId, 0);
}

// Rows/columns for a CSS grid pedigree chart: each node gets a row range that's
// half its parent's, so sire/dam boxes visually bracket their descendant's row.
export function layoutPedigree(tree, maxGen = MAX_GENERATIONS) {
  const totalRows = 2 ** maxGen;
  const boxes = [];

  function place(node, gen, rowStart, rowEnd) {
    boxes.push({
      id: node?.id ?? null,
      name: node?.name ?? "Unknown",
      gender: node?.gender ?? null,
      generation: gen,
      col: gen + 1,
      rowStart,
      rowSpan: rowEnd - rowStart,
      isUnknown: !node,
    });

    if (!node || gen >= maxGen) return;

    const mid = rowStart + (rowEnd - rowStart) / 2;
    place(node.sire, gen + 1, rowStart, mid);
    place(node.dam, gen + 1, mid, rowEnd);
  }

  place(tree, 0, 1, totalRows + 1);
  return boxes;
}

// Depth-tagged list of every ancestor reachable from `id` (depth 0 = id itself).
function collectLineage(id, horsesById, maxDepth) {
  const result = [];
  function walk(currentId, depth) {
    if (currentId == null || depth > maxDepth) return;
    const horse = horsesById.get(currentId);
    if (!horse) return;
    result.push({ id: currentId, depth });
    walk(horse.sire_id, depth + 1);
    walk(horse.dam_id, depth + 1);
  }
  walk(id, 0);
  return result;
}

// Every ancestor shared between a sire-side lineage and a dam-side lineage, tagged with
// how many generations back (from each side) that ancestor sits. n1/n2 = 0 means the
// sire/dam itself.
function findCommonAncestors(sireId, damId, horsesById, maxGen = MAX_GENERATIONS) {
  const sireLine = collectLineage(sireId, horsesById, maxGen - 1);
  const damLine = collectLineage(damId, horsesById, maxGen - 1);

  const shared = [];
  for (const s of sireLine) {
    for (const d of damLine) {
      if (s.id === d.id) shared.push({ id: s.id, n1: s.depth, n2: d.depth });
    }
  }
  return shared;
}

// Wright's coefficient of inbreeding: F = sum over shared ancestors of (1/2)^(n1+n2+1),
// where n1/n2 count generations from the horse's sire/dam to the shared ancestor.
// Ancestors beyond the pedigree depth (their own F) are treated as non-inbred.
export function calculateInbreeding(horse, horsesById, maxGen = MAX_GENERATIONS) {
  if (!horse || horse.sire_id == null || horse.dam_id == null) return 0;

  const shared = findCommonAncestors(horse.sire_id, horse.dam_id, horsesById, maxGen);

  let f = 0;
  for (const a of shared) {
    f += 0.5 ** (a.n1 + a.n2 + 1);
  }
  return f;
}

export function formatInbreeding(f) {
  const pct = Math.round(f * 10000) / 100;
  return `${pct}%`;
}

// Horses sharing at least one parent with `horse` (excluding itself), tagged full/half.
export function findSiblings(horse, horsesById) {
  if (!horse) return [];
  const siblings = [];
  for (const other of horsesById.values()) {
    if (other.id === horse.id) continue;
    const shareSire = horse.sire_id != null && other.sire_id === horse.sire_id;
    const shareDam = horse.dam_id != null && other.dam_id === horse.dam_id;
    if (shareSire && shareDam) siblings.push({ horse: other, type: "full" });
    else if (shareSire || shareDam) siblings.push({ horse: other, type: "half" });
  }
  return siblings;
}

// Horses whose sire or dam is `horse` (i.e. `horse`'s own offspring).
export function findOffspring(horse, horsesById) {
  if (!horse) return [];
  const offspring = [];
  for (const other of horsesById.values()) {
    if (other.sire_id === horse.id || other.dam_id === horse.id) offspring.push(other);
  }
  return offspring;
}

// Human-readable description of how a prospective sire/dam pair are related, based on
// their closest shared ancestor. Returns null if they share no ancestor within range.
export function describeRelationship(sireHorse, damHorse, horsesById, maxGen = MAX_GENERATIONS) {
  if (!sireHorse || !damHorse) return null;

  const shared = findCommonAncestors(sireHorse.id, damHorse.id, horsesById, maxGen);
  if (shared.length === 0) return null;

  shared.sort((a, b) => (a.n1 + a.n2) - (b.n1 + b.n2));
  const closest = shared[0];
  const ancestor = horsesById.get(closest.id);

  const grandLabel = (n) => (n === 2 ? "grandparent" : `${"great-".repeat(n - 2)}grandparent`);

  if (closest.n1 === 0) {
    const label = closest.n2 === 1 ? "sire" : grandLabel(closest.n2);
    return `${sireHorse.name} is the ${label} of ${damHorse.name}.`;
  }
  if (closest.n2 === 0) {
    const label = closest.n1 === 1 ? "dam" : grandLabel(closest.n1);
    return `${damHorse.name} is the ${label} of ${sireHorse.name}.`;
  }
  if (closest.n1 === 1 && closest.n2 === 1) {
    const isFullSibling = shared.filter((a) => a.n1 === 1 && a.n2 === 1).length >= 2;
    return isFullSibling
      ? `${sireHorse.name} and ${damHorse.name} are full siblings.`
      : `${sireHorse.name} and ${damHorse.name} are half-siblings, sharing ${ancestor?.name ?? "a parent"}.`;
  }

  return `${sireHorse.name} and ${damHorse.name} share a common ancestor, ${ancestor?.name ?? "Unknown"} `
    + `(${closest.n1} generation(s) from ${sireHorse.name}, ${closest.n2} generation(s) from ${damHorse.name}).`;
}
