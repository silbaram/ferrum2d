//! Authored platform progress belongs to the native fixed tick, not scene drawing.
use super::terrain::UnifiedTerrainSource;
use super::{UnifiedPhysicsError, UnifiedPhysicsRuntime};
use crate::physics3d::{BodyDesc, BodyKind, KinematicPath, PhysicsError, Pose, Space};
use crate::spatial_scene::{MovingPlatform, SpatialScene, Surface};
use crate::tilemap::Tilemap;

#[derive(Default, Clone, serde::Serialize, serde::Deserialize)]
struct PreparedPlatform {
    id: u32,
    phase: f64,
    start: f64,
    period: f64,
    #[serde(with = "crate::checkpoint_codec::vector")]
    knots: Vec<(f32, Pose)>,
}
#[derive(Default, Clone, serde::Serialize, serde::Deserialize)]
pub(super) struct PlatformMotion {
    #[serde(with = "crate::checkpoint_codec::vector")]
    history: Vec<RenderInterval>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    prepared: Vec<PreparedPlatform>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    paths: Vec<KinematicPath>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    phases: Vec<(u32, f64)>,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct RenderInterval {
    id: u32,
    body: crate::physics3d::BodyId,
    end: Pose,
    start: f64,
    end_phase: f64,
    dt: f32,
    stop: f32,
    configuration: u32,
}

#[cfg(test)]
impl PlatformMotion {
    pub(super) fn corrupt_render_history_fixture(&mut self) {
        self.history[0].stop = f32::NAN;
    }
    pub(in crate::engine) fn corrupt_runtime_payload_fixture(&mut self, case: usize) {
        match case {
            0 => self.prepared[0].phase = f64::NAN,
            1 => self.paths[0].knots[0].0 = f32::NAN,
            2 => self.phases[0].1 = f64::NAN,
            _ => unreachable!(),
        }
    }
}

fn pose(surface: Surface, space: Space) -> Pose {
    let [x, y, w, d] = surface.bounds;
    Pose {
        position: if space == Space::Spatial {
            [
                x + w * 0.5,
                (surface.base + surface.heights[0]) * 0.5,
                -y - d * 0.5,
            ]
        } else {
            [x + w * 0.5, y + d * 0.5, 0.0]
        },
        ..Pose::default()
    }
}

fn prepare(result: &mut PreparedPlatform, platform: MovingPlatform, dt: f32, space: Space) {
    let start = platform.phase;
    let end = start + f64::from(dt);
    let period = 2.0 * platform.duration;
    let mut boundary = ((start / platform.duration).floor() + 1.0) * platform.duration;
    let knots = &mut result.knots;
    knots.clear();
    while boundary < end {
        let fraction = ((boundary - start) / f64::from(dt)) as f32;
        if fraction > knots.last().map_or(0.0, |k: &(f32, Pose)| k.0) && fraction < 1.0 {
            knots.push((
                fraction,
                pose(platform.surface_at(boundary % period), space),
            ));
        }
        boundary += platform.duration;
    }
    let phase = end % period;
    knots.push((1.0, pose(platform.surface_at(phase), space)));
    result.id = platform.origin.id;
    result.phase = phase;
    result.start = start;
    result.period = period;
}

impl UnifiedPhysicsRuntime {
    pub(super) fn prepare_platform_motion(
        &mut self,
        scene: &SpatialScene,
    ) -> Result<(), UnifiedPhysicsError> {
        self.platform_motion
            .prepared
            .resize_with(scene.moving_platforms.len(), PreparedPlatform::default);
        self.platform_motion
            .history
            .try_reserve(
                scene
                    .moving_platforms
                    .len()
                    .saturating_sub(self.platform_motion.history.len()),
            )
            .map_err(|_| PhysicsError::CapacityExceeded)?;
        let space = self.physics.config().space;
        for (p, &platform) in self
            .platform_motion
            .prepared
            .iter_mut()
            .zip(&scene.moving_platforms)
        {
            prepare(p, platform, self.physics.config().step_seconds, space);
            for &(_, pose) in &p.knots {
                self.physics.validate_body_desc(&BodyDesc {
                    kind: BodyKind::KinematicPosition,
                    pose,
                    ..BodyDesc::default()
                })?;
            }
        }
        Ok(())
    }

    pub(super) fn step_native_platforms(
        &mut self,
        scene: &mut SpatialScene,
        tiles: &Tilemap,
    ) -> Result<(), UnifiedPhysicsError> {
        let motion = &mut self.platform_motion;
        motion.paths.truncate(motion.prepared.len());
        motion.phases.clear();
        for (index, p) in motion.prepared.iter().enumerate() {
            let binding = self
                .terrain
                .registered
                .get(&UnifiedTerrainSource::SpatialSurface { id: p.id })
                .ok_or(PhysicsError::StaleBody)?;
            if index == motion.paths.len() {
                motion.paths.push(KinematicPath {
                    sweep_sensors: false,
                    body: binding.body,
                    knots: Vec::with_capacity(3),
                });
            }
            let path = &mut motion.paths[index];
            path.body = binding.body;
            path.knots.clear();
            path.knots.extend_from_slice(&p.knots);
            motion.phases.push((p.id, p.phase));
        }
        let mut paths = std::mem::take(&mut motion.paths);
        let admission = self.begin_native_dashes(&mut paths);
        if let Err(error) = admission {
            self.finish_native_dashes(false);
            self.platform_motion.paths = paths;
            return Err(error);
        }
        let result = self.physics.step_with_kinematic_paths(&paths);
        self.finish_native_dashes(result.is_ok());
        self.platform_motion.paths = paths;
        let failure = result.err();
        let completed = if failure.is_some() {
            (self.physics.actual_motion_completed_time()
                / f64::from(self.physics.config().step_seconds))
            .clamp(0., 1.)
        } else {
            1.
        };
        if completed == 0. {
            if let Some(error) = failure {
                return Err(error.into());
            }
        }
        let motion = &mut self.platform_motion;
        let mut blocked = 0;
        for ((p, path), phase) in motion
            .prepared
            .iter()
            .zip(&motion.paths)
            .zip(&mut motion.phases)
        {
            let (fraction, stopped) = self.physics.kinematic_path_progress_precise(path.body);
            if stopped || failure.is_some() {
                phase.1 = (p.start
                    + f64::from(self.physics.config().step_seconds) * fraction.min(completed))
                    % p.period;
                blocked += u32::from(stopped);
            }
        }
        // Publish only the actual completed prefix. Phase is a future target
        // input, so it must not round-trip through an f32 observation getter.
        scene.finish_native_platform_step(
            &motion.phases,
            self.physics
                .carried_character_count(&motion.paths[..motion.prepared.len()]),
            blocked,
        );
        motion.history.clear();
        for (index, p) in motion.prepared.iter().enumerate() {
            let key = UnifiedTerrainSource::SpatialSurface { id: p.id };
            if let Some(binding) = self.terrain.registered.get_mut(&key) {
                let end = self.physics.body_state(binding.body)?.pose;
                binding.wanted.desc.body.pose = end;
                // This f32 stop belongs only to render interpolation. Future
                // platform targets use the precise phase published above.
                let (stop, _) = self.physics.kinematic_path_progress(binding.body);
                motion.history.push(RenderInterval {
                    id: p.id,
                    body: binding.body,
                    end,
                    start: p.start,
                    end_phase: motion.phases[index].1,
                    dt: self.physics.config().step_seconds,
                    stop,
                    configuration: scene.revision.wrapping_sub(scene.platform_revision),
                });
            }
        }
        self.terrain.revision =
            if self.physics.config().space == Space::PlanarXy && !motion.prepared.is_empty() {
                // XY authoring also projects the moving surface's logical height span.
                // Refresh that metadata before the next query/tick without teleporting.
                None
            } else {
                Some((tiles.physics_revision(), scene.revision))
            };
        if let Some(error) = failure {
            Err(error.into())
        } else {
            Ok(())
        }
    }
}

impl UnifiedPhysicsRuntime {
    // Authored position paths are authoritative. Sampling phase retains turns
    // inside a fixed tick and holds the accepted prefix after a CCD stop.
    pub(in crate::engine) fn terrain_render_offsets(
        &self,
        scene: &SpatialScene,
        alpha: Option<f32>,
    ) -> ([(u32, [f32; 3]); 16], usize) {
        let mut out = [(0, [0.; 3]); 16];
        let mut count = 0;
        let Some(alpha) = alpha else {
            return (out, count);
        };
        for h in &self.platform_motion.history {
            if h.configuration != scene.revision.wrapping_sub(scene.platform_revision) {
                continue;
            }
            let Some(platform) = scene
                .moving_platforms
                .iter()
                .find(|p| p.origin.id == h.id && p.phase == h.end_phase)
            else {
                continue;
            };
            let Some(binding) = self
                .terrain
                .registered
                .get(&UnifiedTerrainSource::SpatialSurface { id: h.id })
            else {
                continue;
            };
            if binding.body != h.body
                || self
                    .physics
                    .body_state(h.body)
                    .map_or(true, |s| s.pose != h.end)
            {
                continue;
            }
            let Some(current) = scene.surfaces.iter().find(|s| s.id == h.id) else {
                continue;
            };
            let at = platform.surface_at(
                (h.start + f64::from(h.dt) * f64::from(alpha.min(h.stop)))
                    % (platform.duration * 2.),
            );
            let delta = [
                at.bounds[0] - current.bounds[0],
                at.base - current.base,
                current.bounds[1] - at.bounds[1],
            ];
            if delta != [0.; 3] && count < out.len() {
                out[count] = (h.id, delta);
                count += 1;
            }
        }
        (out, count)
    }
}

mod file_payload_admission;
