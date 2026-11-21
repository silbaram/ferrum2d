use super::*;
fn scalar(v: f32, sentinel: bool) -> bool {
    v.is_finite() || (sentinel && v == f32::INFINITY)
}
pub(super) fn validate(w: &World) -> Result {
    for (i, j) in w.distance_joints.iter().enumerate() {
        if let Some(j) = j {
            require(
                scalar(j.local_anchor_a_x, false)
                    && scalar(j.local_anchor_a_y, false)
                    && scalar(j.local_anchor_b_x, false)
                    && scalar(j.local_anchor_b_y, false)
                    && scalar(j.rest_length, false)
                    && scalar(j.break_force, true)
                    && scalar(j.break_torque, true)
                    && scalar(j.break_distance, true)
                    && scalar(j.stiffness, false)
                    && scalar(j.damping, false),
                "distance_joints",
                i,
                "numeric-and-break-sentinels",
            )?;
        }
    }
    for (i, j) in w.rope_joints.iter().enumerate() {
        if let Some(j) = j {
            require(
                scalar(j.local_anchor_a_x, false)
                    && scalar(j.local_anchor_a_y, false)
                    && scalar(j.local_anchor_b_x, false)
                    && scalar(j.local_anchor_b_y, false)
                    && scalar(j.max_length, false)
                    && scalar(j.break_force, true)
                    && scalar(j.break_torque, true)
                    && scalar(j.break_distance, true)
                    && scalar(j.stiffness, false)
                    && scalar(j.damping, false),
                "rope_joints",
                i,
                "numeric-and-break-sentinels",
            )?;
        }
    }
    for (i, j) in w.spring_joints.iter().enumerate() {
        if let Some(j) = j {
            require(
                scalar(j.damping_ratio, false)
                    && scalar(j.local_anchor_a_x, false)
                    && scalar(j.local_anchor_a_y, false)
                    && scalar(j.local_anchor_b_x, false)
                    && scalar(j.local_anchor_b_y, false)
                    && scalar(j.rest_length, false)
                    && scalar(j.break_force, true)
                    && scalar(j.break_torque, true)
                    && scalar(j.break_distance, true)
                    && scalar(j.stiffness, false)
                    && scalar(j.damping, false)
                    && j.frequency_hz.is_none_or(|v| v.is_finite()),
                "spring_joints",
                i,
                "numeric-and-break-sentinels",
            )?;
        }
    }
    for (i, j) in w.pulley_joints.iter().enumerate() {
        if let Some(j) = j {
            require(
                scalar(j.ground_anchor_a_x, false)
                    && scalar(j.ground_anchor_a_y, false)
                    && scalar(j.ground_anchor_b_x, false)
                    && scalar(j.ground_anchor_b_y, false)
                    && scalar(j.local_anchor_a_x, false)
                    && scalar(j.local_anchor_a_y, false)
                    && scalar(j.local_anchor_b_x, false)
                    && scalar(j.local_anchor_b_y, false)
                    && scalar(j.rest_length, false)
                    && scalar(j.ratio, false)
                    && scalar(j.break_force, true)
                    && scalar(j.break_torque, true)
                    && scalar(j.break_distance, true)
                    && scalar(j.stiffness, false)
                    && scalar(j.damping, false),
                "pulley_joints",
                i,
                "numeric-and-break-sentinels",
            )?;
        }
    }
    for (i, j) in w.revolute_joints.iter().enumerate() {
        if let Some(j) = j {
            require(
                scalar(j.local_anchor_a_x, false)
                    && scalar(j.local_anchor_a_y, false)
                    && scalar(j.local_anchor_b_x, false)
                    && scalar(j.local_anchor_b_y, false)
                    && scalar(j.break_force, true)
                    && scalar(j.break_torque, true)
                    && scalar(j.break_distance, true)
                    && scalar(j.lower_angle, false)
                    && scalar(j.upper_angle, false)
                    && scalar(j.motor_speed, false)
                    && scalar(j.max_motor_torque, false)
                    && scalar(j.stiffness, false)
                    && scalar(j.damping, false),
                "revolute_joints",
                i,
                "numeric-and-break-sentinels",
            )?;
        }
    }
    for (i, j) in w.prismatic_joints.iter().enumerate() {
        if let Some(j) = j {
            require(
                scalar(j.local_anchor_a_x, false)
                    && scalar(j.local_anchor_a_y, false)
                    && scalar(j.local_anchor_b_x, false)
                    && scalar(j.local_anchor_b_y, false)
                    && scalar(j.local_axis_a_x, false)
                    && scalar(j.local_axis_a_y, false)
                    && scalar(j.break_force, true)
                    && scalar(j.break_torque, true)
                    && scalar(j.break_distance, true)
                    && scalar(j.reference_angle, false)
                    && scalar(j.lower_translation, false)
                    && scalar(j.upper_translation, false)
                    && scalar(j.motor_speed, false)
                    && scalar(j.max_motor_force, false)
                    && scalar(j.stiffness, false)
                    && scalar(j.damping, false)
                    && scalar(j.angular_stiffness, false)
                    && scalar(j.angular_damping, false),
                "prismatic_joints",
                i,
                "numeric-and-break-sentinels",
            )?;
        }
    }
    for (i, j) in w.weld_joints.iter().enumerate() {
        if let Some(j) = j {
            require(
                scalar(j.local_anchor_a_x, false)
                    && scalar(j.local_anchor_a_y, false)
                    && scalar(j.local_anchor_b_x, false)
                    && scalar(j.local_anchor_b_y, false)
                    && scalar(j.reference_angle, false)
                    && scalar(j.break_force, true)
                    && scalar(j.break_torque, true)
                    && scalar(j.break_distance, true)
                    && scalar(j.break_angle, true)
                    && scalar(j.stiffness, false)
                    && scalar(j.damping, false)
                    && scalar(j.angular_stiffness, false)
                    && scalar(j.angular_damping, false),
                "weld_joints",
                i,
                "numeric-and-break-sentinels",
            )?;
        }
    }
    for (i, j) in w.gear_joints.iter().enumerate() {
        if let Some(j) = j {
            require(
                scalar(j.ratio, false)
                    && scalar(j.reference_angle, false)
                    && scalar(j.break_force, true)
                    && scalar(j.break_torque, true)
                    && scalar(j.break_angle, true)
                    && scalar(j.stiffness, false)
                    && scalar(j.damping, false),
                "gear_joints",
                i,
                "numeric-and-break-sentinels",
            )?;
        }
    }
    Ok(())
}
