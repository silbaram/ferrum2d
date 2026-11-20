//! Native geometry feeds the existing flat/XYZ debug buffers; it never falls
//! back to World collision geometry. Cold import and extraction have separate costs.
use super::{Engine, Space};
use crate::collision::PhysicsDebugLine;
use crate::physics3d::{DebugDrawOptions, DebugDrawStatistics, DebugLine3d};
use wasm_bindgen::prelude::wasm_bindgen;

const MAX_LINES: u32 = 16_384;
const MAX_WORK: u32 = 65_536;
const ACTIVE: u32 = 1;
const TRUNCATED: u32 = 2;
const REJECTED: u32 = 4;
const SPATIAL: u32 = 8;
const XZ_FOOTPRINT: u32 = 16;

#[wasm_bindgen]
impl Engine {
    /// Four fixed u32s: emitted lines, extraction work, flags, unsupported shapes.
    /// Flags: active1, truncated2, admission rejected4, XYZ route8, flat XZ16.
    pub fn unified_physics_debug_version(&self) -> u32 {
        1
    }
    pub fn unified_physics_debug_state_ptr(&self) -> *const u32 {
        self.frame_buffers.native_debug_state.as_ptr()
    }
}

impl Engine {
    /// Returns true whenever native owns physics, including disabled or rejected
    /// requests, so callers cannot draw misleading legacy colliders instead.
    pub(in crate::engine) fn build_unified_physics_debug_lines(
        &mut self,
        flat_requested: bool,
    ) -> bool {
        if self.unified_physics.is_none() {
            return false;
        }
        self.frame_buffers.clear_physics_debug_lines();
        let spatial = self.spatial_scene.frame_active;
        let mut flags = if flat_requested && self.physics_debug_lines_enabled {
            self.physics_debug_line_flags
        } else {
            0
        };
        if spatial {
            flags |= self.spatial_scene.debug.native_physics_flags();
        }
        if flags == 0 {
            return true;
        }
        if spatial {
            self.spatial_scene.debug.begin_native_physics();
        }
        self.refresh_native_built_in_owners();
        let Some(runtime) = &mut self.unified_physics else {
            return true;
        };
        let space = runtime.physics.config().space;
        let route = if spatial {
            SPATIAL
        } else if space == Space::Spatial {
            XZ_FOOTPRINT
        } else {
            0
        };
        // Match public cold geometry queries: synchronize admitted components
        // without advancing time or consuming force/impulse commands. Joint
        // authoring still follows its own admission/tick path.
        if let Err(error) = runtime.prepare_query(
            &mut self.world,
            self.auto_rigid_body_step_config,
            &self.tilemap,
            &self.spatial_scene,
        ) {
            runtime.last_error = Some(error);
            self.frame_buffers.native_debug_state =
                [0, 0, ACTIVE | TRUNCATED | REJECTED | route, 0];
            if spatial {
                self.spatial_scene.debug.truncated = true;
            }
            return true;
        }
        let max_lines = if spatial {
            self.spatial_scene.debug.remaining_native_lines()
        } else {
            let out = &mut self.frame_buffers.physics_debug_lines;
            if out.capacity() < MAX_LINES as usize {
                out.reserve(MAX_LINES as usize - out.len());
            }
            MAX_LINES
        };
        let options = DebugDrawOptions {
            flags,
            max_lines,
            max_work: MAX_WORK,
        };
        let mut stats: DebugDrawStatistics = if spatial {
            runtime.physics.debug_draw(
                options,
                runtime.statistics.debug_ccd_geometry(),
                |line: DebugLine3d| {
                    let project = |p: [f32; 3]| match space {
                        Space::Spatial => p,
                        // This is the native extrusion, not an authored height-span.
                        Space::PlanarXy => [p[0], p[2], -p[1]],
                    };
                    self.spatial_scene.debug.native_line(
                        project(line.from),
                        project(line.to),
                        line.color,
                    )
                },
            )
        } else {
            runtime.physics.debug_draw(
                options,
                runtime.statistics.debug_ccd_geometry(),
                |line: DebugLine3d| {
                    let project = |p: [f32; 3]| match space {
                        Space::PlanarXy => [p[0], p[1]],
                        Space::Spatial => [p[0], -p[2]],
                    };
                    let [x0, y0] = project(line.from);
                    let [x1, y1] = project(line.to);
                    self.frame_buffers
                        .physics_debug_lines
                        .push(PhysicsDebugLine {
                            x0,
                            y0,
                            x1,
                            y1,
                            r: line.color[0],
                            g: line.color[1],
                            b: line.color[2],
                            a: line.color[3],
                        });
                    true
                },
            )
        };
        if flags & crate::collision::PHYSICS_DEBUG_CCD != 0
            && (runtime.statistics.frame.ccd_observations_dropped != 0
                || runtime.statistics.frame.totals.ccd_clamps_dropped != 0)
        {
            stats.truncated = true;
        }
        self.frame_buffers.native_debug_state = [
            stats.lines,
            stats.work,
            ACTIVE | route | if stats.truncated { TRUNCATED } else { 0 },
            stats.unsupported_shapes,
        ];
        if spatial {
            self.spatial_scene.debug.truncated |= stats.truncated;
        }
        true
    }
}
