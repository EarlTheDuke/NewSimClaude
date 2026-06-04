import type { SeededRNG } from "../utils/rng";
import { World } from "./World";
import type {
  MapNode,
  Road,
  Location,
  Business,
  Resident,
  WorkSchedule,
} from "./types";
import { RENT_PER_DAY, DINER_MEAL_PRICE, GOODS_PRICE } from "../systems/constants";

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

/**
 * Four staggered 8-hour shifts (Phase 10a). Keeping the length fixed at 8h
 * means a full working day pays exactly as before; only the start time fans out
 * so the morning commute spreads across the clock.
 */
const SHIFTS: ReadonlyArray<{ startHour: number; endHour: number }> = [
  { startHour: 7, endHour: 15 },
  { startHour: 8, endHour: 16 },
  { startHour: 9, endHour: 17 },
  { startHour: 10, endHour: 18 },
];

/**
 * A deterministic, varied work pattern per resident, derived from the index
 * (not the RNG) so that adding it leaves every resident's starting needs
 * byte-identical to before — the only new behaviour is the schedule itself. One
 * rotating day off per week (staggered by index) keeps the city from ever going
 * fully idle on the same weekday.
 */
function scheduleFor(i: number): WorkSchedule {
  const shift = SHIFTS[i % SHIFTS.length]!;
  return { startHour: shift.startHour, endHour: shift.endHour, daysOff: [i % 7] };
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
  /**
   * How many residents start jobless (jobId === ""). They live and spend but
   * draw no wage until a business hires them. Default 0 keeps Phase 1 intact.
   */
  unemployed?: number;
  /**
   * Opt in to a second, rival diner (Phase 11b). Adds `biz_diner_2` — a faithful
   * twin of the original diner under a different owner — at the bottom-right
   * retail node, so residents choose between two food sellers on price + distance.
   * Off by default, so every existing seed/test stays byte-identical.
   */
  secondDiner?: boolean;
}

export function buildCity(rng: SeededRNG, options: CityOptions = {}): World {
  const residentCount = options.residentCount ?? 12;
  const unemployed = Math.max(0, Math.min(options.unemployed ?? 0, residentCount));
  const employedCount = residentCount - unemployed;
  // One owner per business, by resident index (Phase 10g). With the default 12
  // residents the seven owners are res_0..res_6 (distinct); the modulo only
  // wraps for tiny cities, so an owner id always names a resident that exists.
  const ownerOf = (i: number) => `res_${i % Math.max(1, residentCount)}`;
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
  // Phase 4 producers/processors fill the previously empty middle column (c=2).
  // The factory shares the mine's node — materials flow next door to be worked.
  const farmLoc: Location = { id: "loc_farm", name: "Greenfield Farm", type: "workplace", nodeId: nodeId(2, 0) };
  const mineLoc: Location = { id: "loc_mine", name: "Iron Hollow Mine", type: "workplace", nodeId: nodeId(2, 1) };
  const bakeryLoc: Location = { id: "loc_bakery", name: "Hearth Bakery", type: "workplace", nodeId: nodeId(2, 2) };
  const factoryLoc: Location = { id: "loc_factory", name: "Ironworks Factory", type: "workplace", nodeId: nodeId(2, 1) };
  locations.push(dinerLoc, goodsLoc, landlordLoc, farmLoc, mineLoc, bakeryLoc, factoryLoc);

  const pnl = () => ({ revenue: 0, wagesPaid: 0, rentCollected: 0 });
  businesses.push(
    { id: "biz_diner", name: dinerLoc.name, kind: "diner", ownerId: ownerOf(0), locationId: dinerLoc.id, cash: 4000, inventory: 40, price: DINER_MEAL_PRICE, employeeIds: [], wagePerTick: 0.17, pnl: pnl(), resources: { food: 0 }, active: true },
    { id: "biz_goods", name: goodsLoc.name, kind: "goods", ownerId: ownerOf(1), locationId: goodsLoc.id, cash: 4000, inventory: 20, price: GOODS_PRICE, employeeIds: [], wagePerTick: 0.20, pnl: pnl(), resources: { wares: 0 }, active: true },
    { id: "biz_landlord", name: landlordLoc.name, kind: "landlord", ownerId: ownerOf(2), locationId: landlordLoc.id, cash: 4000, inventory: 0, price: 0, employeeIds: [], wagePerTick: 0.15, pnl: pnl(), resources: {}, active: true },
    { id: "biz_farm", name: farmLoc.name, kind: "farm", ownerId: ownerOf(3), locationId: farmLoc.id, cash: 3000, inventory: 0, price: 0, employeeIds: [], wagePerTick: 0.08, pnl: pnl(), resources: { grain: 50 }, active: true },
    { id: "biz_mine", name: mineLoc.name, kind: "mine", ownerId: ownerOf(4), locationId: mineLoc.id, cash: 3000, inventory: 0, price: 0, employeeIds: [], wagePerTick: 0.05, pnl: pnl(), resources: { materials: 24 }, active: true },
    { id: "biz_bakery", name: bakeryLoc.name, kind: "bakery", ownerId: ownerOf(5), locationId: bakeryLoc.id, cash: 3000, inventory: 0, price: 0, employeeIds: [], wagePerTick: 0.10, pnl: pnl(), resources: { food: 40 }, active: true },
    { id: "biz_factory", name: factoryLoc.name, kind: "factory", ownerId: ownerOf(6), locationId: factoryLoc.id, cash: 3000, inventory: 0, price: 0, employeeIds: [], wagePerTick: 0.10, pnl: pnl(), resources: { wares: 20 }, active: true },
  );

  // A rival diner across town (Phase 11b), co-located with the goods store at the
  // bottom-right node — a small strip mall, just as the factory shares the mine's
  // node. A faithful twin of biz_diner under a distinct owner: geography (top vs
  // bottom) splits the lunch crowd and price decides the middle. Appended last so
  // the seven core businesses keep their owners and staff; only this scenario's
  // residents see a reshuffled job cycle. Skipped entirely (byte-identical) when off.
  if (options.secondDiner) {
    const diner2Loc: Location = { id: "loc_diner_2", name: "Riverside Diner", type: "workplace", nodeId: nodeId(3, 2) };
    locations.push(diner2Loc);
    businesses.push(
      { id: "biz_diner_2", name: diner2Loc.name, kind: "diner", ownerId: ownerOf(7), locationId: diner2Loc.id, cash: 4000, inventory: 40, price: DINER_MEAL_PRICE, employeeIds: [], wagePerTick: 0.17, pnl: pnl(), resources: { food: 0 }, active: true },
    );
  }

  // --- Homes on the left/middle columns (c = 0,1) ---
  const homeNodes: string[] = [];
  for (let c = 0; c <= 1; c++) for (let r = 0; r < ROWS; r++) homeNodes.push(nodeId(c, r));
  const homeCount = Math.min(homeNodes.length, Math.ceil(residentCount / 2));
  for (let i = 0; i < homeCount; i++) {
    // Rents fan downward from the baseline (70, 66, 62, …) so re-homing always
    // has a cheaper option to move toward, and totals stay safely positive.
    const rent = Math.max(1, RENT_PER_DAY - i * 4);
    locations.push({ id: `loc_home_${i}`, name: `Home ${i + 1}`, type: "home", nodeId: homeNodes[i]!, rent });
  }
  const homes = locations.filter((l) => l.type === "home");

  world.locations = locations;
  world.businesses = businesses;
  world.reindex();

  // --- Residents: assign a home and a job, start asleep at home ---
  const residents: Resident[] = [];
  for (let i = 0; i < residentCount; i++) {
    const home = homes[i % homes.length]!;
    const employed = i < employedCount;
    const biz = businesses[i % businesses.length]!;
    if (employed) biz.employeeIds.push(`res_${i}`);
    const homeNode = world.getNode(home.nodeId);
    residents.push({
      id: `res_${i}`,
      name: FIRST_NAMES[i % FIRST_NAMES.length]!,
      money: 500,
      homeId: home.id,
      jobId: employed ? biz.id : "",
      wagePerTick: employed ? biz.wagePerTick : 0,
      hasVehicle: false,
      schedule: scheduleFor(i),
      earnedThisPeriod: 0,
      lastPaycheck: 0,
      savingsGoal: 0,
      luxuriesOwned: 0,
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
