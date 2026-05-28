use crate::components::Velocity;

const DEFAULT_RIGID_BODY_GRAVITY_Y: f32 = 980.0;
const DEFAULT_RIGID_BODY_VELOCITY_ITERATIONS: u32 = 6;
const DEFAULT_RIGID_BODY_POSITION_ITERATIONS: u32 = 3;
const DEFAULT_POSITION_CORRECTION_PERCENT: f32 = 0.8;
const DEFAULT_POSITION_CORRECTION_SLOP: f32 = 0.01;
pub(super) const DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR: f32 = 0.2;
pub(super) const MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY: f32 = 120.0;
pub(super) const DEFAULT_RESTITUTION_VELOCITY_THRESHOLD: f32 = 1.0;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RigidBodyStepConfig {
    pub gravity: Velocity,
    pub velocity_iterations: u32,
    pub position_iterations: u32,
    pub position_correction_percent: f32,
    pub position_correction_slop: f32,
    pub restitution_velocity_threshold: f32,
    pub contact_baumgarte_bias_factor: f32,
    pub max_contact_baumgarte_bias_velocity: f32,
    pub contact_split_impulse: bool,
}

impl Default for RigidBodyStepConfig {
    fn default() -> Self {
        Self {
            gravity: Velocity {
                vx: 0.0,
                vy: DEFAULT_RIGID_BODY_GRAVITY_Y,
            },
            velocity_iterations: DEFAULT_RIGID_BODY_VELOCITY_ITERATIONS,
            position_iterations: DEFAULT_RIGID_BODY_POSITION_ITERATIONS,
            position_correction_percent: DEFAULT_POSITION_CORRECTION_PERCENT,
            position_correction_slop: DEFAULT_POSITION_CORRECTION_SLOP,
            restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
            contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
            max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
            contact_split_impulse: false,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct RigidBodyStepStats {
    pub substeps: u32,
    pub dynamic_bodies: u32,
    pub angular_bodies: u32,
    pub island_count: u32,
    pub island_bodies: u32,
    pub active_islands: u32,
    pub sleeping_islands: u32,
    pub largest_island_bodies: u32,
    pub contact_checks: u32,
    pub velocity_impulses: u32,
    pub contact_block_solves: u32,
    pub baumgarte_velocity_biases: u32,
    pub split_velocity_impulses: u32,
    pub restitution_velocity_threshold_skips: u32,
    pub warm_start_impulses: u32,
    pub contact_cache_entries: u32,
    pub sleeping_bodies: u32,
    pub bodies_put_to_sleep: u32,
    pub bodies_woken: u32,
    pub islands_woken: u32,
    pub islands_put_to_sleep: u32,
    pub ccd_checks: u32,
    pub ccd_hits: u32,
    pub position_corrections: u32,
    pub split_position_corrections: u32,
    pub constraint_velocity_corrections: u32,
    pub constraint_position_corrections: u32,
    pub broken_joints: u32,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct RigidBodyIslandStats {
    pub island_count: u32,
    pub island_bodies: u32,
    pub active_islands: u32,
    pub sleeping_islands: u32,
    pub largest_island_bodies: u32,
}
