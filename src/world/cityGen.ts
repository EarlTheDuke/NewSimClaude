import type { SeededRNG } from "../utils/rng";
import { World } from "./World";
import type {
  MapNode,
  Road,
  Location,
  Business,
  Resident,
} from "./types";

/**
 * Builds the default small city, deterministically from the given RNG.
 *
 * Layout: a 4×3 grid of road intersections. Homes cluster on the left,
 * workplaces sit on the right, so residents visibly commute across town.
 */

const COLS = 4;
const ROWS = 3;
const SPACING = 160;
const ORIGIN = 80;

const FIRST_NAMES = [
  "Ada", "Bo", "Cy", "Dot", "Eli", "Fay", "Gus", "Hana",
  "Ivo", "Joy", "Kit", "Lux", "Mo", "Nia", "Oz", "Pip",
];

function nodeId(c: number, r: number): string {
  return `n_${c}_${r}`;
}

function buildGrid(): { nodes: MapNode[]; roads: Road[] } {
  const nodes: MapNode[] = [];
  const roads: Road[] = [];
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      nodes.push({ id: nodeId(c, r), x: ORIGIN + c * SPACING, y: ORIGIN + r * SPACING });
      if (c > 0) roads.push({ a: nodeId(c - 1, r), b: nodeId(c, r) });
      if (r > 0) roads.push({ a: nodeId(c, r - 1), b: nodeId(c, r) });
    }
  }
  return { nodes, roads };
}

export interface CityOptions {
  residentCount?: number;
}

export function buildCity(rng: SeededRNG, options: CityOptions = {}): World {
  const residentCount = options.residentCount ?? 12;
  const world = new World();
  const { nodes, roads } = buildGrid();
  world.nodes = nodes;
  world.roads = roads;

  // --- Workplaces on the right column (c = 3) ---
  const locations: Location[] = [];
  const businesses: Business[] = [];

  const dinerLoc: Location = { id: "loc_diner", name: "The Corner Diner", type: "workplace", nodeId: nodeId(3, 0) };
  const goodsLoc: Location = { id: "loc_goods", name: "Maker Goods Co.", type: "workplace", nodeId: nodeId(3, 2) };
  const landlordLoc: Location = { id: "loc_landlord", name: "Keystone Housing", type: "workplace", nodeId: nodeId(3, 1) };
  locations.push(dinerLoc, goodsLoc, landlordLoc);

  businesses.push(
    { id: "biz_diner", name: dinerLoc.name, kind: "diner", locationId: dinerLoc.id, cash: 4000, inventory: 200, price: 14, employeeIds: [], wagePerTick: 0.5, pnl: { revenue: 0, wagesPaid: 0, rentCollected: 0 } },
    { id: "biz_goods", name: goodsLoc.name, kind: "goods", locationId: goodsLoc.id, cash: 4000, inventory: 120, price: 25, employeeIds: [], wagePerTick: 0.55, pnl: { revenue: 0, wagesPaid: 0, rentCollected: 0 } },
    { id: "biz_landlord", name: landlordLoc.name, kind: "landlord", locationId: landlordLoc.id, cash: 4000, inventory: 0, price: 0, employeeIds: [], wagePerTick: 0.5, pnl: { revenue: 0, wagesPaid: 0, rentCollected: 0 } },
  );

  // --- Homes on the left/middle columns (c = 0,1) ---
  const homeNodes: string[] = [];
  for (let c = 0; c <= 1; c++) for (let r = 0; r < ROWS; r++) homeNodes.push(nodeId(c, r));
  const homeCount = Math.min(homeNodes.length, Math.ceil(residentCount / 2));
  for (let i = 0; i < homeCount; i++) {
    locations.push({ id: `loc_home_${i}`, name: `Home ${i + 1}`, type: "home", nodeId: homeNodes[i]! });
  }
  const homes = locations.filter((l) => l.type === "home");

  world.locations = locations;
  world.businesses = businesses;
  world.reindex();

  // --- Residents: assign a home and a job, start asleep at home ---
  const residents: Resident[] = [];
  for (let i = 0; i < residentCount; i++) {
    const home = homes[i % homes.length]!;
    const biz = businesses[i % businesses.length]!;
    biz.employeeIds.push(`res_${i}`);
    const homeNode = world.getNode(home.nodeId);
    residents.push({
      id: `res_${i}`,
      name: FIRST_NAMES[i % FIRST_NAMES.length]!,
      money: 500,
      homeId: home.id,
      jobId: biz.id,
      needs: {
        hunger: 70 + rng.int(0, 20),
        energy: 80 + rng.int(0, 15),
        social: 60 + rng.int(0, 25),
      },
      activity: "sleeping",
      destinationId: home.id,
      move: { x: homeNode.x, y: homeNode.y, atNodeId: home.nodeId, path: [], segmentProgress: 0 },
    });
  }
  world.residents = residents;
  world.reindex();
  return world;
}
