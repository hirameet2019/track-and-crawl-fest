/**
 * What kind of vehicle a vehicle ticket (requires_vehicle) is for, read from its
 * name, so the form says "motorcycle" and "rider" for a motorcycle registration
 * and "car" and "driver" for everything else.
 */
export type VehicleKind = "car" | "motorcycle";

export function vehicleKind(t: { name: string }): VehicleKind {
  return /motor|moto|bike|scooter/i.test(t.name) ? "motorcycle" : "car";
}

export const VEHICLE_WORDS: Record<VehicleKind, { noun: string; person: string; example: string }> = {
  car: { noun: "car", person: "driver", example: "Toyota Corolla AE101" },
  motorcycle: { noun: "motorcycle", person: "rider", example: "Honda Click 125i" },
};

export const vehicleWords = (t: { name: string }) => VEHICLE_WORDS[vehicleKind(t)];
