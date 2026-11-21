//! Last proposal for an otherwise rejected passive angular graze. The old
//! safe prefix and the encountered Native clock stay exact. Only a complete
//! original pair cast may select a proposal; the caller still checks the scene.
use super::ground_rate::CorrectionRange;
use super::*;
use crate::physics3d::character_constraints::{self, Plane};

const MAX_PLANES: usize = 8;
// Fractions of the existing skin / remaining time, not a new clearance.
// Try the largest admitted repair first: an almost-tangent candidate may spend
// the shared full-pair proof budget before the remaining repairs are visited.
// Every candidate still needs its whole-interval displacement and pair proof.
const GAIN_SIXTEENTHS: [u8; 7] = [16, 12, 10, 8, 4, 2, 1];

fn rate_cells(value: f32, locked: bool) -> [Option<f32>; 3] {
    if locked {
        [Some(value), None, None]
    } else {
        neighbors(value).map(Some)
    }
}

#[allow(clippy::too_many_arguments)]
fn propose(
    old: Curve,
    geometry: rp::Vector,
    normal: rp::Vector,
    locked: [bool; 3],
    planes: &[Plane],
    safe: Time,
    end: Time,
    skin: f32,
    work: &mut Work,
    accept: &mut impl FnMut(Proposal, &mut Work) -> Result<bool, TrajectoryError>,
) -> Result<Option<Proposal>, TrajectoryError> {
    work.charge(1024)?;
    if !safe.is_finite() || !end.is_finite() || end <= safe {
        return Err(TrajectoryError::InvalidTime);
    }
    if !geometry.is_finite() || !normal.is_finite() || !skin.is_finite() {
        return Err(TrajectoryError::NonFinite);
    }
    if skin <= 0. || planes.len() > MAX_PLANES {
        return Ok(None);
    }
    let Curve::Anchored {
        carrier,
        anchor,
        offset: old_offset,
        linear_velocity: old_relative,
        rotation,
    } = old
    else {
        return Ok(None);
    };
    Kernel::from_native(carrier.native, carrier.domain)?;
    if anchor != rp::Vector::ZERO
        || carrier.native.angular_velocity == rp::Vector::ZERO
        || safe < carrier.domain.start
        || end > carrier.domain.end
    {
        return Ok(None);
    }
    work.charge(planes.len() as u64 * 8)?;
    if planes
        .iter()
        .any(|p| !p.normal.is_finite() || !p.offset.is_finite())
    {
        return Err(TrajectoryError::NonFinite);
    }
    let Some(normal) = normal.try_normalize() else {
        return Err(TrajectoryError::NonFinite);
    };
    let pose = old.com_pose(safe);
    if !pose.is_finite() {
        return Err(TrajectoryError::NonFinite);
    }
    let mut ranges = [None; 3];
    for (axis, range) in ranges.iter_mut().enumerate() {
        *range = Some(CorrectionRange::from_curve(
            carrier,
            rp::Vector::ZERO,
            rotation,
            safe,
            end,
            axis,
            work,
        )?);
    }
    let at = carrier.position_at_time(safe);
    let base = at.translation + at.rotation * rp::Vector::ZERO;
    let seconds = (safe - carrier.domain.start).clamp(0., carrier.domain.duration()) as f32;
    let skin2 = f64::from(skin) * f64::from(skin);
    for numerator in GAIN_SIXTEENTHS {
        work.charge(128)?;
        let gain = (f64::from(skin) / (end - safe) * f64::from(numerator) / 16.) as f32;
        if !gain.is_finite() || gain <= 0. {
            continue;
        }
        let mut desired = geometry + normal * gain;
        for (axis, &is_locked) in locked.iter().enumerate() {
            if is_locked {
                desired[axis] = geometry[axis];
            }
        }
        // This bounded, pre-existing 3D plane projection is proposal arithmetic.
        // Pay each actual invocation's conservative dot/enumeration bound;
        // untried gains and shape casts are never reserved here.
        let n = planes.len().max(1) as u64;
        work.charge(n.pow(4) * 64 + 128)?;
        let Some(projected) = character_constraints::project(desired, planes) else {
            continue;
        };
        let cells = [
            rate_cells(if locked[0] { geometry.x } else { projected.x }, locked[0]),
            rate_cells(if locked[1] { geometry.y } else { projected.y }, locked[1]),
            rate_cells(if locked[2] { geometry.z } else { projected.z }, locked[2]),
        ];
        for x in cells[0].into_iter().flatten() {
            for y in cells[1].into_iter().flatten() {
                for z in cells[2].into_iter().flatten() {
                    work.charge(1024)?;
                    let target = rp::Vector::new(x, y, z);
                    if !target.is_finite() || (target - geometry).dot(normal) <= 0. {
                        continue;
                    }
                    let Some(relative) = fit_relative(carrier.linear_velocity_at_time(), target)
                    else {
                        continue;
                    };
                    let Some(offset) = fit_offset(base, relative * seconds, pose.translation)
                    else {
                        continue;
                    };
                    let mut correction2 = 0_f64;
                    let mut bounded = true;
                    for (axis, range) in ranges.iter().enumerate() {
                        let range = range.ok_or(TrajectoryError::InvalidReference)?;
                        let Some(delta) = range.difference(
                            old_offset[axis],
                            offset[axis],
                            old_relative[axis],
                            relative[axis],
                        ) else {
                            bounded = false;
                            break;
                        };
                        if delta != 0. {
                            correction2 = (correction2 + (delta * delta).next_up()).next_up();
                        }
                    }
                    if !bounded || !correction2.is_finite() || correction2 > skin2 {
                        continue;
                    }
                    let curve = Curve::Anchored {
                        carrier,
                        anchor: rp::Vector::ZERO,
                        offset,
                        linear_velocity: relative,
                        rotation,
                    };
                    if !same_pose(curve.com_pose(safe), pose) {
                        continue;
                    }
                    let (rate, omega) = curve_velocity(curve, safe)?;
                    if omega != rp::Vector::ZERO
                        || (0..3).any(|axis| {
                            locked[axis] && rate[axis].to_bits() != geometry[axis].to_bits()
                        })
                    {
                        continue;
                    }
                    let proposal = Proposal { curve, rate };
                    if accept(proposal, work)? {
                        return Ok(Some(proposal));
                    }
                }
            }
        }
    }
    Ok(None)
}

impl BackendMotionScratch {
    /// Called only after the ordinary response would reject every unchanged
    /// participant. It adds no stop, ground, transport tag or physical impulse.
    #[allow(clippy::too_many_arguments)]
    pub(in crate::physics3d::character_motion::backend) fn angular_grazing_response(
        &mut self,
        hit: actual_scene::Hit,
        safe: Time,
        end: Time,
        bodies: &rp::RigidBodySet,
        colliders: &rp::ColliderSet,
        characters: &BTreeMap<BodyId, CharacterRuntime>,
        planar: bool,
        work: &mut Work,
        scratch: usize,
    ) -> Result<bool, TrajectoryError> {
        work.charge(512 + self.character_rows.len() as u64 * 8)?;
        if !hit.cast.contact.dist.is_finite()
            || !hit.cast.contact.normal1.is_finite()
            || !hit.cast.contact.point1.is_finite()
            || !hit.cast.contact.point2.is_finite()
        {
            return Err(TrajectoryError::NonFinite);
        }
        if !self.rows.is_empty()
            || hit.a.sensor
            || hit.b.sensor
            || hit.cast.safe_time != safe
            || hit.cast.hit_time != safe
            || hit.cast.contact.dist <= 0.
        {
            return Ok(false);
        }
        let (source, driver, normal) = match (hit.a.role, hit.b.role) {
            (Role::Character(_), Role::Prescribed) => (hit.a, hit.b, -hit.cast.contact.normal1),
            (Role::Prescribed, Role::Character(_)) => (hit.b, hit.a, hit.cast.contact.normal1),
            _ => return Ok(false),
        };
        let Role::Character(id) = source.role else {
            return Ok(false);
        };
        let Some(runtime) = characters.get(&id).filter(|r| r.config.push_mass == 0.) else {
            return Ok(false);
        };
        let index = self
            .entry_index(source.parent)
            .ok_or(TrajectoryError::InvalidReference)?;
        let other = self
            .entry_index(driver.parent)
            .ok_or(TrajectoryError::InvalidReference)?;
        let entry = self.entries[index];
        if entry.support.is_some()
            || entry.carry_correction != rp::Vector::ZERO
            || bodies[entry.value.handle].body_type() != rp::RigidBodyType::KinematicPositionBased
            || self.entries[other].stopped_at.is_some()
            || bodies[self.entries[other].value.handle].body_type()
                != rp::RigidBodyType::KinematicVelocityBased
        {
            return Ok(false);
        }
        let Curve::Anchored {
            carrier, anchor, ..
        } = entry.curve
        else {
            return Ok(false);
        };
        let Curve::Integrated(driver_kernel) = self.entries[other].curve else {
            return Ok(false);
        };
        if anchor != rp::Vector::ZERO
            || !same_kernel(carrier, driver_kernel)
            || carrier.domain.start.to_bits() != driver_kernel.domain.start.to_bits()
            || carrier.domain.end.to_bits() != driver_kernel.domain.end.to_bits()
            || carrier.native.linear_velocity.to_array().map(f32::to_bits)
                != driver_kernel
                    .native
                    .linear_velocity
                    .to_array()
                    .map(f32::to_bits)
            || carrier.native.angular_velocity.to_array().map(f32::to_bits)
                != driver_kernel
                    .native
                    .angular_velocity
                    .to_array()
                    .map(f32::to_bits)
        {
            return Ok(false);
        }
        let value = self
            .character_values
            .binary_search_by_key(&id, |v| v.0)
            .map_err(|_| TrajectoryError::InvalidReference)?;
        let geometry = self.character_values[value].1;
        if curve_velocity(entry.curve, safe)? != (geometry, rp::Vector::ZERO) {
            return Ok(false);
        }
        let flags = bodies[entry.value.handle].locked_axes();
        let locked = [
            flags.contains(rp::LockedAxes::TRANSLATION_LOCKED_X),
            flags.contains(rp::LockedAxes::TRANSLATION_LOCKED_Y),
            planar || flags.contains(rp::LockedAxes::TRANSLATION_LOCKED_Z),
        ];
        let required = std::mem::size_of::<[Plane; MAX_PLANES]>()
            + std::mem::size_of::<[Option<CorrectionRange>; 3]>()
            + 2 * std::mem::size_of::<Proposal>();
        if required > scratch {
            return Err(TrajectoryError::WorkLimit);
        }
        let mut planes = [Plane::default(); MAX_PLANES];
        let mut count = 0;
        for row in &self.character_rows {
            let (normal, target) = if row.a == value {
                let target = match row.b {
                    Some(peer) => {
                        self.character_values
                            .get(peer)
                            .ok_or(TrajectoryError::InvalidReference)?
                            .1
                    }
                    None => row.velocity,
                };
                (row.normal, target)
            } else if row.b == Some(value) {
                (
                    -row.normal,
                    self.character_values
                        .get(row.a)
                        .ok_or(TrajectoryError::InvalidReference)?
                        .1,
                )
            } else {
                continue;
            };
            if count == MAX_PLANES {
                return Ok(false);
            }
            planes[count] = Plane {
                normal,
                offset: normal.dot(target),
            };
            count += 1;
        }
        for (axis, &is_locked) in locked.iter().enumerate() {
            if !is_locked {
                continue;
            }
            if count + 2 > MAX_PLANES {
                return Ok(false);
            }
            let mut normal = rp::Vector::ZERO;
            normal[axis] = 1.;
            planes[count] = Plane {
                normal,
                offset: geometry[axis],
            };
            planes[count + 1] = Plane {
                normal: -normal,
                offset: -geometry[axis],
            };
            count += 2;
        }
        let clearance = effective_pair_clearance(characters, &self.origins, &hit.a, &hit.b);
        if hit.cast.contact.dist > clearance || clearance <= 0. {
            return Ok(false);
        }
        let source_collider = colliders
            .get(source.collider)
            .ok_or(TrajectoryError::InvalidReference)?;
        let driver_collider = colliders
            .get(driver.collider)
            .ok_or(TrajectoryError::InvalidReference)?;
        let tolerance = f64::from(
            ((driver_kernel.native.motion.end_time - driver_kernel.native.motion.start_time)
                * 1e-6)
                .max(f32::MIN_POSITIVE),
        );
        let proposal = propose(
            entry.curve,
            geometry,
            normal,
            locked,
            &planes[..count],
            safe,
            end,
            runtime.config.skin_width,
            work,
            &mut |proposal, work| {
                work.charge(self.character_rows.len() as u64 * 16)?;
                if !self.proposal_rows_feasible(Some((id, proposal.rate)))? {
                    return Ok(false);
                }
                let motion = crate::physics3d::solver_trajectory::ShapeMotion {
                    curve: proposal.curve,
                    ..source.motion
                };
                let (a, sa, b, sb) = if source.collider == hit.a.collider {
                    (
                        motion,
                        source_collider.shape(),
                        driver.motion,
                        driver_collider.shape(),
                    )
                } else {
                    (
                        driver.motion,
                        driver_collider.shape(),
                        motion,
                        source_collider.shape(),
                    )
                };
                Ok(
                    crate::physics3d::solver_trajectory::cast_full_shapes_policy(
                        a, sa, b, sb, safe, end, clearance, tolerance, work, true,
                    )?
                    .is_none(),
                )
            },
        )?;
        let Some(proposal) = proposal else {
            return Ok(false);
        };
        let participant = *self
            .participants
            .get(index)
            .ok_or(TrajectoryError::InvalidReference)?;
        // All typed queries and metadata guards precede publishing a candidate.
        // The ordinary caller still certifies other pairs and the final endpoint.
        self.stage_curve(entry, entry.domain_start, safe, bodies, work)?;
        self.character_values[value].1 = proposal.rate;
        let entry = &mut self.entries[index];
        entry.curve = proposal.curve;
        entry.domain_start = safe;
        entry.value.end = proposal.curve.com_pose(end);
        entry.value.linear_velocity = participant.linear_velocity;
        entry.value.angular_velocity = participant.angular_velocity;
        entry.value.keep_integrated_endpoint = true;
        entry.blocked_moving = true;
        entry.hit_ceiling |= normal.dot(rp::Vector::from(runtime.config.up)) < -0.01;
        Ok(true)
    }
}

#[cfg(test)]
mod tests;
