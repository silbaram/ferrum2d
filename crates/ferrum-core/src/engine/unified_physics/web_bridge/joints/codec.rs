use super::super::authoring::{pose, v3};
use crate::physics3d::{BodyId, JointDesc, JointKind, JointMotor, SpringResponse};

pub(super) fn kind_code(kind: &JointKind) -> u32 {
    match kind {
        JointKind::Fixed => 0,
        JointKind::Spherical => 1,
        JointKind::Revolute { .. } => 2,
        JointKind::Prismatic { .. } => 3,
        JointKind::Distance { .. } => 4,
        JointKind::Rope { .. } => 5,
        JointKind::FrequencySpring { .. } => 6,
        JointKind::AccelerationSpring { .. } => 7,
        JointKind::Spring { .. } => 8,
        JointKind::ElasticRope { .. } => 9,
        JointKind::Gear { .. } => 10,
        JointKind::Pulley { .. } => 11,
        JointKind::ContinuousRevolute { .. } => 12,
    }
}
fn spring(v: &[f32]) -> SpringResponse {
    SpringResponse {
        stiffness: v[0],
        damping: v[1],
    }
}
fn absent(flags: u32, bit: u32, v: &[f32]) -> bool {
    flags & bit == 0 && v.iter().any(|x| *x != 0.0)
}

/// Fixed 20-float header then kind-specific values. Unknown flags and nonzero absent
/// fields reject; physical ranges, frame orientation and axis constraints remain native.
pub(super) fn decode(a: BodyId, b: BodyId, m: &[u32], v: &[f32]) -> Result<JointDesc, String> {
    if m.len() != 2 || v.iter().any(|x| !x.is_finite()) {
        return Err("Invalid unified joint payload".into());
    }
    let (count, extra) = match m[0] {
        0 | 1 => (0, 0),
        2 | 3 | 12 => (7, 64 | 128),
        4 | 5 => (1, 0),
        6..=9 => (3, 0),
        10 => (4, 256),
        11 => (10, 256 | 512),
        _ => return Err("Invalid unified joint kind".into()),
    };
    let flags = m[1];
    if v.len() != 20 + count || flags & !(63 | extra) != 0 {
        return Err("Invalid unified joint payload length or flags".into());
    }
    if absent(flags, 4, &v[14..15])
        || absent(flags, 8, &v[15..16])
        || absent(flags, 16, &v[16..18])
        || absent(flags, 32, &v[18..20])
    {
        return Err("Unexpected absent unified joint setting".into());
    }
    let p = &v[20..];
    let kind = match m[0] {
        0 => JointKind::Fixed,
        1 => JointKind::Spherical,
        2 | 3 | 12 => {
            if absent(flags, 64, &p[..2])
                || absent(flags, 128, &p[2..])
                || (m[0] == 12 && flags & 64 == 0)
            {
                return Err("Invalid unified joint actuator flags".into());
            }
            let limits = (flags & 64 != 0).then_some([p[0], p[1]]);
            let motor = (flags & 128 != 0).then_some(JointMotor {
                target_position: p[2],
                target_velocity: p[3],
                stiffness: p[4],
                damping: p[5],
                max_force: p[6],
            });
            match m[0] {
                2 => JointKind::Revolute { limits, motor },
                3 => JointKind::Prismatic { limits, motor },
                _ => JointKind::ContinuousRevolute {
                    limits: [p[0], p[1]],
                    motor,
                },
            }
        }
        4 => JointKind::Distance { length: p[0] },
        5 => JointKind::Rope { max_length: p[0] },
        6 => JointKind::FrequencySpring {
            rest_length: p[0],
            frequency_hz: p[1],
            damping_ratio: p[2],
        },
        7 => JointKind::AccelerationSpring {
            rest_length: p[0],
            stiffness: p[1],
            damping: p[2],
        },
        8 => JointKind::Spring {
            rest_length: p[0],
            stiffness: p[1],
            damping: p[2],
        },
        9 => JointKind::ElasticRope {
            max_length: p[0],
            spring: spring(&p[1..]),
        },
        10 => {
            if absent(flags, 256, &p[2..]) {
                return Err("Unexpected gear spring".into());
            }
            JointKind::Gear {
                ratio: p[0],
                reference_angle: p[1],
                spring: (flags & 256 != 0).then(|| spring(&p[2..])),
            }
        }
        11 => {
            if absent(flags, 256, &p[8..]) {
                return Err("Unexpected pulley spring".into());
            }
            JointKind::Pulley {
                ground_a: v3(p),
                ground_b: v3(&p[3..]),
                length: p[6],
                ratio: p[7],
                slack: flags & 512 != 0,
                spring: (flags & 256 != 0).then(|| spring(&p[8..])),
            }
        }
        _ => return Err("Invalid unified joint kind".into()),
    };
    Ok(JointDesc {
        body_a: a,
        body_b: b,
        local_frame_a: pose(v),
        local_frame_b: pose(&v[7..]),
        kind,
        linear_spring: (flags & 16 != 0).then(|| spring(&v[16..])),
        angular_spring: (flags & 32 != 0).then(|| spring(&v[18..])),
        contacts_enabled: flags & 2 != 0,
        enabled: flags & 1 != 0,
        break_force: (flags & 4 != 0).then_some(v[14]),
        break_torque: (flags & 8 != 0).then_some(v[15]),
    })
}
