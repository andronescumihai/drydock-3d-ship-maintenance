/**
 * The slice of the vessel model the engine reads.
 *
 * Declared here rather than imported from `lib/data` so the engine depends on
 * a shape, not on a loader: tests hand it small fixtures, the app hands it the
 * validated sample vessel, and neither needs the other.
 */

import type {
  AccessNetwork,
  AccessNode,
  AccessNodeId,
  Compartment,
  CompartmentId,
  ComponentId,
  ShipSystem,
  SystemId,
  VesselComponent,
} from './types';

export interface EngineModel {
  readonly components: readonly VesselComponent[];
  readonly componentById: ReadonlyMap<ComponentId, VesselComponent>;
  readonly systemById: ReadonlyMap<SystemId, ShipSystem>;
  readonly compartmentById: ReadonlyMap<CompartmentId, Compartment>;
  readonly access: AccessNetwork;
  readonly accessNodeById: ReadonlyMap<AccessNodeId, AccessNode>;
}
