use super::*;
use crate::components::gameplay::MovementTarget;
use crate::engine::file_controller_admission::{finite, pose, Budget, Owner, Result};
use crate::engine::unified_physics::spatial_actor::navigation::file_admission::point_valid;
fn target(t: MovementTarget) -> bool {
    match t {
        MovementTarget::NearestFaction(id) | MovementTarget::NearestTag(id) => id < 32,
        _ => true,
    }
}
fn pattern(p: MovementPattern) -> bool {
    match p {
        MovementPattern::Static => true,
        MovementPattern::TopdownInput { speed } => speed.is_finite(),
        MovementPattern::PlatformerInput {
            horizontal_speed,
            gravity,
            jump_speed,
            max_fall_speed,
            ground_probe_distance,
            step_offset,
            coyote_time_seconds,
            jump_buffer_seconds,
        } => finite(&[
            horizontal_speed,
            gravity,
            jump_speed,
            max_fall_speed,
            ground_probe_distance,
            step_offset,
            coyote_time_seconds,
            jump_buffer_seconds,
        ]),
        MovementPattern::Linear { vx, vy } => finite(&[vx, vy]),
        MovementPattern::Oscillate {
            origin_x,
            origin_y,
            amplitude_x,
            amplitude_y,
            phase_speed,
        } => finite(&[origin_x, origin_y, amplitude_x, amplitude_y, phase_speed]),
        MovementPattern::MoveToPoint { x, y, speed } => finite(&[x, y, speed]),
        MovementPattern::Chase { target: t, speed } => target(t) && speed.is_finite(),
        MovementPattern::SeekTarget {
            target: t,
            speed,
            turn_rate,
        } => target(t) && finite(&[speed, turn_rate]),
        MovementPattern::Orbit {
            target: t,
            speed,
            radius,
            radial_band,
        } => target(t) && finite(&[speed, radius, radial_band]),
        MovementPattern::Accelerate {
            acceleration_x,
            acceleration_y,
            max_speed,
        } => finite(&[acceleration_x, acceleration_y, max_speed]),
    }
}
impl NativeCombatNavigation {
    pub(in crate::engine) fn validate_file_controller(
        &self,
        scene: &SpatialScene,
        b: &mut Budget,
    ) -> Result {
        b.work(96)?;
        b.require(
            self.agents.len() <= 64
                && self.peers.len() <= 64
                && self.cursor < 64
                && self.used <= FRAME_WORK
                && self.frame_searches <= 1
                && self.frame_search_work <= SLICE_WORK as u32
                && self.request_status <= 8
                && self.nodes <= 4096
                && self.probes <= 32768
                && self.peak_work <= 8_000_000,
            Owner::Combat,
            "counts-counters",
            0,
        )?;
        b.work(
            ((self.agents.len() + self.peers.len()) as u64) * 256
                + ((self.agents.len() + self.peers.len()) as u64).pow(2) * 4,
        )?;
        for (i, a) in self.agents.iter().enumerate() {
            b.require(
                !self.agents[..i].iter().any(|p| p.entity == a.entity),
                Owner::Combat,
                "duplicate-agent",
                i,
            )?;
            b.require(
                finite(&a.goal)
                    && a.speed.is_finite()
                    && (0. ..=1e6).contains(&a.speed)
                    && a.cooldown.is_finite()
                    && (0. ..=60.).contains(&a.cooldown)
                    && finite(&[a.intent.vx, a.intent.vy])
                    && a.last_pose.is_none_or(pose)
                    && a.pattern.is_none_or(pattern),
                Owner::Combat,
                "agent-numeric",
                i,
            )?;
            b.require(
                a.detour.is_none_or(|(heading, left)| {
                    finite(&heading)
                        && left.is_finite()
                        && left >= 0.
                        && f64::from(heading[0]).hypot(f64::from(heading[1])) <= 1. + 1e-5
                }),
                Owner::Combat,
                "detour",
                i,
            )?;
            b.require(
                a.route.file_actor_token().is_none_or(|e| e == a.entity),
                Owner::Combat,
                "route-actor",
                i,
            )?;
            a.route.validate_file_controller(b)?;
        }
        for (i, p) in self.peers.iter().enumerate() {
            b.require(
                finite(&p.velocity) && !self.peers[..i].iter().any(|q| q.body == p.body),
                Owner::Combat,
                "peer",
                i,
            )?;
        }
        self.cache.validate_file_controller(b)?;
        if let Some(pending) = &self.pending {
            b.require(
                self.agents.iter().any(|a| a.entity == pending.entity),
                Owner::Combat,
                "pending-actor",
                0,
            )?;
            pending.key.validate_file_controller(b)?;
            pending.job.validate_file_controller(scene, b)?;
            b.require(
                pending
                    .key
                    .profile
                    .saved_controller_config_matches(pending.job.file_controller_config()),
                Owner::Combat,
                "pending-profile",
                0,
            )?;
            let connector = match &pending.kind {
                JobKind::Search => None,
                JobKind::Connector(points) => {
                    b.require(
                        !points.is_empty() && points.len() <= 4096,
                        Owner::Combat,
                        "connector-count",
                        0,
                    )?;
                    b.work((points.len() as u64) * 16)?;
                    for (i, p) in points.iter().enumerate() {
                        b.require(point_valid(*p), Owner::Combat, "connector-point", i)?;
                    }
                    points.first().copied()
                }
            };
            b.require(
                pending.job.file_controller_job_matches(
                    pending.key.cell,
                    pending.key.floor,
                    connector,
                ),
                Owner::Combat,
                "pending-kind",
                0,
            )?;
        }
        // current/stale Entity/BodyId targets and u32 diagnostics are retained verbatim.
        Ok(())
    }
}
