use super::*;
use crate::engine::file_physics_output_admission::{self as f, Budget, Error, Problem};
fn numbers(v: &[f32], field: &'static str, i: usize) -> Result<(), Error> {
    f::require(f::finite(v), "legacy_output", field, i, Problem::Number)
}
pub(in crate::engine) fn validate_legacy(e: &Engine, b: &mut Budget) -> Result<(), Error> {
    let v = e.physics_query_result;
    b.work(7)?;
    numbers(&[v.point_x, v.point_y, v.distance], "query_result", 0)?;
    f::require(
        v.distance >= 0.0,
        "legacy_output",
        "query_result",
        0,
        Problem::Number,
    )?;
    b.vector(&e.physics_query_hits)?;
    b.vector(&e.physics_raycast_hits)?;
    for (i, v) in e.physics_raycast_hits.iter().enumerate() {
        b.work(7)?;
        numbers(
            &[v.distance, v.point_x, v.point_y, v.normal_x, v.normal_y],
            "raycast_hits",
            i,
        )?;
        f::require(
            v.distance >= 0.0,
            "legacy_output",
            "raycast_hits",
            i,
            Problem::Number,
        )?;
    }
    b.vector(&e.physics_tile_shape_cast_hits)?;
    for (i, v) in e.physics_tile_shape_cast_hits.iter().enumerate() {
        b.work(7)?;
        numbers(
            &[v.distance, v.point_x, v.point_y, v.normal_x, v.normal_y],
            "tile_shape_hits",
            i,
        )?;
        f::require(
            v.distance >= 0.0,
            "legacy_output",
            "tile_shape_hits",
            i,
            Problem::Number,
        )?;
    }
    b.vector(&e.physics_tile_contact_hits)?;
    for (i, v) in e.physics_tile_contact_hits.iter().enumerate() {
        b.work(7)?;
        numbers(
            &[v.normal_x, v.normal_y, v.penetration, v.point_x, v.point_y],
            "tile_contacts",
            i,
        )?;
    }
    b.vector(&e.physics_tile_manifold_hits)?;
    for (i, v) in e.physics_tile_manifold_hits.iter().enumerate() {
        b.work(12)?;
        numbers(
            &[
                v.normal_x,
                v.normal_y,
                v.penetration,
                v.point0_x,
                v.point0_y,
                v.point0_penetration,
                v.point1_x,
                v.point1_y,
                v.point1_penetration,
            ],
            "tile_manifolds",
            i,
        )?;
        f::require(
            v.point_count <= 2,
            "legacy_output",
            "tile_manifolds",
            i,
            Problem::Length,
        )?;
    }
    b.vector(&e.physics_body_contact_hits)?;
    for (i, v) in e.physics_body_contact_hits.iter().enumerate() {
        b.work(9)?;
        f::require(
            v.a_entity_id != v.b_entity_id,
            "legacy_output",
            "physics_body_contact_hits_pair",
            i,
            Problem::Reference,
        )?;
        numbers(
            &[v.normal_x, v.normal_y, v.penetration, v.point_x, v.point_y],
            "body_contacts",
            i,
        )?;
    }
    b.vector(&e.physics_body_manifold_hits)?;
    for (i, v) in e.physics_body_manifold_hits.iter().enumerate() {
        b.work(14)?;
        f::require(
            v.a_entity_id != v.b_entity_id,
            "legacy_output",
            "physics_body_manifold_hits_pair",
            i,
            Problem::Reference,
        )?;
        numbers(
            &[
                v.normal_x,
                v.normal_y,
                v.penetration,
                v.point0_x,
                v.point0_y,
                v.point0_penetration,
                v.point1_x,
                v.point1_y,
                v.point1_penetration,
            ],
            "body_manifolds",
            i,
        )?;
        f::require(
            v.point_count <= 2,
            "legacy_output",
            "body_manifolds",
            i,
            Problem::Length,
        )?;
    }
    b.vector(&e.physics_rigid_contact_impulse_hits)?;
    for (i, v) in e.physics_rigid_contact_impulse_hits.iter().enumerate() {
        b.work(10)?;
        f::require(
            v.a_entity_id != v.b_entity_id,
            "legacy_output",
            "physics_rigid_contact_impulse_hits_pair",
            i,
            Problem::Reference,
        )?;
        numbers(
            &[
                v.point_x,
                v.point_y,
                v.normal_x,
                v.normal_y,
                v.normal_impulse,
                v.tangent_impulse,
            ],
            "contact_impulses",
            i,
        )?;
    }
    // Geometric entity queries emit at most one hit per entity. Their order may
    // be alive-index order or sorted native order; stale full u32 IDs remain data.
    b.vector(&e.physics_point_query_scratch)?;
    b.vector(&e.physics_aabb_query_scratch)?;
    b.vector(&e.physics_circle_query_scratch)?;
    b.vector(&e.physics_shape_query_scratch)?;
    b.vector(&e.physics_raycast_scratch)?;
    for (i, v) in e.physics_raycast_scratch.iter().enumerate() {
        b.work(7)?;
        numbers(
            &[v.distance, v.point_x, v.point_y, v.normal_x, v.normal_y],
            "raycast_scratch",
            i,
        )?;
        f::require(
            v.distance >= 0.0,
            "legacy_output",
            "raycast_scratch",
            i,
            Problem::Number,
        )?;
    }
    b.vector(&e.physics_shape_cast_scratch)?;
    for (i, v) in e.physics_shape_cast_scratch.iter().enumerate() {
        b.work(7)?;
        numbers(
            &[v.distance, v.point_x, v.point_y, v.normal_x, v.normal_y],
            "shape_cast_scratch",
            i,
        )?;
        f::require(
            v.distance >= 0.0,
            "legacy_output",
            "shape_cast_scratch",
            i,
            Problem::Number,
        )?;
    }
    b.vector(&e.physics_body_contact_scratch)?;
    for (i, v) in e.physics_body_contact_scratch.iter().enumerate() {
        b.work(9)?;
        f::require(
            v.pair.a.id != v.pair.b.id,
            "legacy_output",
            "physics_body_contact_scratch_pair",
            i,
            Problem::Reference,
        )?;
        numbers(
            &[v.normal_x, v.normal_y, v.penetration, v.point_x, v.point_y],
            "body_contact_scratch",
            i,
        )?;
    }
    b.vector(&e.physics_body_manifold_scratch)?;
    for (i, v) in e.physics_body_manifold_scratch.iter().enumerate() {
        b.work(14)?;
        f::require(
            v.pair.a.id != v.pair.b.id,
            "legacy_output",
            "physics_body_manifold_scratch_pair",
            i,
            Problem::Reference,
        )?;
        numbers(
            &[v.normal_x, v.normal_y, v.penetration],
            "body_manifold_scratch",
            i,
        )?;
        f::require(
            v.point_count <= 2,
            "legacy_output",
            "body_manifold_scratch",
            i,
            Problem::Length,
        )?;
        for p in &v.points {
            numbers(
                &[p.point_x, p.point_y, p.penetration],
                "body_manifold_points",
                i,
            )?;
        }
    }
    b.vector(&e.physics_tile_shape_cast_scratch)?;
    for (i, v) in e.physics_tile_shape_cast_scratch.iter().enumerate() {
        b.work(7)?;
        numbers(
            &[v.distance, v.point_x, v.point_y, v.normal_x, v.normal_y],
            "tile_shape_scratch",
            i,
        )?;
        f::require(
            v.distance >= 0.0,
            "legacy_output",
            "tile_shape_scratch",
            i,
            Problem::Number,
        )?;
    }
    b.vector(&e.physics_tile_contact_scratch)?;
    for (i, v) in e.physics_tile_contact_scratch.iter().enumerate() {
        b.work(7)?;
        numbers(
            &[v.normal_x, v.normal_y, v.penetration, v.point_x, v.point_y],
            "tile_contact_scratch",
            i,
        )?;
    }
    b.vector(&e.physics_tile_manifold_scratch)?;
    for (i, v) in e.physics_tile_manifold_scratch.iter().enumerate() {
        b.work(12)?;
        numbers(
            &[v.normal_x, v.normal_y, v.penetration],
            "tile_manifold_scratch",
            i,
        )?;
        f::require(
            v.point_count <= 2,
            "legacy_output",
            "tile_manifold_scratch",
            i,
            Problem::Length,
        )?;
        for p in &v.points {
            numbers(
                &[p.point_x, p.point_y, p.penetration],
                "tile_manifold_points",
                i,
            )?;
        }
    }
    unique_ids(
        e.physics_query_hits.iter().map(|v| v.entity_id),
        b,
        "query_hits",
    )?;
    unique_ids(
        e.physics_point_query_scratch.iter().map(|v| v.entity.id),
        b,
        "point_scratch",
    )?;
    unique_ids(
        e.physics_aabb_query_scratch.iter().map(|v| v.entity.id),
        b,
        "aabb_scratch",
    )?;
    unique_ids(
        e.physics_circle_query_scratch.iter().map(|v| v.entity.id),
        b,
        "circle_scratch",
    )?;
    unique_ids(
        e.physics_shape_query_scratch.iter().map(|v| v.entity.id),
        b,
        "shape_scratch",
    )?;
    ordered_linear(
        e.physics_raycast_hits.iter().map(|v| {
            (
                v.distance,
                v.entity_id as usize,
                v.entity_generation as usize,
            )
        }),
        b,
        "ray_hits_order",
    )?;
    ordered_linear(
        e.physics_raycast_scratch.iter().map(|v| {
            (
                v.distance,
                v.entity.id as usize,
                v.entity.generation as usize,
            )
        }),
        b,
        "ray_scratch_order",
    )?;
    ordered_linear(
        e.physics_shape_cast_scratch.iter().map(|v| {
            (
                v.distance,
                v.entity.id as usize,
                v.entity.generation as usize,
            )
        }),
        b,
        "shape_scratch_order",
    )?;
    ordered_linear(
        e.physics_tile_shape_cast_hits.iter().map(|v| {
            (
                v.distance,
                v.tile_layer_index as usize,
                v.tile_index as usize,
            )
        }),
        b,
        "tile_hits_order",
    )?;
    ordered_linear(
        e.physics_tile_shape_cast_scratch
            .iter()
            .map(|v| (v.distance, v.layer_index, v.tile_index)),
        b,
        "tile_scratch_order",
    )?;
    ordered_tile(
        e.physics_tile_contact_hits
            .iter()
            .map(|v| (v.tile_layer_index as usize, v.tile_index as usize)),
        b,
        "tile_contacts_order",
    )?;
    ordered_tile(
        e.physics_tile_manifold_hits
            .iter()
            .map(|v| (v.tile_layer_index as usize, v.tile_index as usize)),
        b,
        "tile_manifolds_order",
    )?;
    ordered_tile(
        e.physics_tile_contact_scratch
            .iter()
            .map(|v| (v.layer_index, v.tile_index)),
        b,
        "tile_contact_scratch_order",
    )?;
    ordered_tile(
        e.physics_tile_manifold_scratch
            .iter()
            .map(|v| (v.layer_index, v.tile_index)),
        b,
        "tile_manifold_scratch_order",
    )?;
    Ok(())
}
fn unique_ids(
    ids: impl ExactSizeIterator<Item = u32>,
    b: &mut Budget,
    field: &'static str,
) -> Result<(), Error> {
    let n = ids.len();
    b.work(n)?;
    b.sort(n)?;
    let mut keys = b.reserve::<u32>(n)?;
    keys.extend(ids);
    keys.sort_unstable();
    b.work(n)?;
    f::require(
        !keys.windows(2).any(|w| w[0] == w[1]),
        "legacy_output",
        field,
        0,
        Problem::Duplicate,
    )
}
fn ordered_linear(
    rows: impl ExactSizeIterator<Item = (f32, usize, usize)>,
    b: &mut Budget,
    field: &'static str,
) -> Result<(), Error> {
    b.work(rows.len())?;
    let mut previous: Option<(f32, usize, usize)> = None;
    for (i, v) in rows.enumerate() {
        f::require(
            previous.is_none_or(|p| {
                p.0.total_cmp(&v.0)
                    .then((p.1, p.2).cmp(&(v.1, v.2)))
                    .is_le()
            }),
            "legacy_output",
            field,
            i,
            Problem::Order,
        )?;
        previous = Some(v);
    }
    Ok(())
}
fn ordered_tile(
    rows: impl ExactSizeIterator<Item = (usize, usize)>,
    b: &mut Budget,
    field: &'static str,
) -> Result<(), Error> {
    b.work(rows.len())?;
    let mut previous = None;
    for (i, v) in rows.enumerate() {
        f::require(
            previous.is_none_or(|p| p <= v),
            "legacy_output",
            field,
            i,
            Problem::Order,
        )?;
        previous = Some(v);
    }
    Ok(())
}
pub(in crate::engine) fn validate_snapshots(e: &Engine, b: &mut Budget) -> Result<(), Error> {
    entity_snapshot(&e.physics_entity_snapshot, b)?;
    collider_snapshot(&e.physics_body_collider_snapshot, b)?;
    joint_snapshot(&e.physics_joint_snapshot, b)
}
pub(in crate::engine) fn validate_packed(e: &Engine, b: &mut Budget) -> Result<(), Error> {
    let floats = &e.physics_body_snapshot_floats;
    let words = &e.physics_body_snapshot_u32s;
    b.vector(floats)?;
    b.vector(words)?;
    f::require(
        floats.len().is_multiple_of(31)
            && words.len().is_multiple_of(5)
            && floats.len() / 31 == words.len() / 5,
        "body_bulk",
        "layout",
        0,
        Problem::Length,
    )?;
    for (i, (v, m)) in floats
        .chunks_exact(31)
        .zip(words.chunks_exact(5))
        .enumerate()
    {
        b.work(36)?;
        f::require(
            m[2] <= 2 && m[3] <= 7 && m[4] & !63 == 0,
            "body_bulk",
            "metadata",
            i,
            Problem::Flags,
        )?;
        for (j, &x) in v.iter().enumerate() {
            f::require(
                if j == 6 || j == 7 {
                    f::finite_or_pos_inf(x)
                } else {
                    x.is_finite()
                },
                "body_bulk",
                "values",
                i,
                Problem::Number,
            )?;
        }
        f::require(
            v[6] > 0.0
                && v[7] > 0.0
                && (m[2] != 2 || v[6].is_finite())
                && (m[2] != 2 || m[4] & 32 != 0 || v[7].is_finite()),
            "body_bulk",
            "mass_inertia",
            i,
            Problem::Number,
        )?;
    }
    Ok(())
}

fn entity_snapshot(v: &PhysicsEntitySnapshot, b: &mut Budget) -> Result<(), Error> {
    let PhysicsEntitySnapshot {
        entity_id: _,
        entity_generation: _,
        x: _,
        y: _,
        velocity_x: _,
        velocity_y: _,
        rotation_radians: _,
        angular_velocity_radians_per_second: _,
        body_type: _,
        body_enabled: _,
        is_sleeping: _,
        fixed_rotation: _,
        collider_type: _,
        collider_enabled: _,
        collider_is_trigger: _,
        collider_offset_x: _,
        collider_offset_y: _,
        collider_material_override: _,
        collider_restitution: _,
        collider_friction: _,
        collider_surface_velocity_x: _,
        collider_surface_velocity_y: _,
        collider_density: _,
        collider_contact_baumgarte_bias_scale: _,
        collider_max_contact_baumgarte_bias_velocity_scale: _,
        collider_contact_position_correction_scale: _,
        collider_contact_position_correction_slop_scale: _,
        mass: _,
        inverse_mass: _,
        inertia: _,
        inverse_inertia: _,
        gravity_scale: _,
        linear_damping: _,
        angular_damping: _,
        restitution: _,
        friction: _,
        surface_velocity_x: _,
        surface_velocity_y: _,
        density: _,
        contact_baumgarte_bias_scale: _,
        max_contact_baumgarte_bias_velocity_scale: _,
        contact_position_correction_scale: _,
        contact_position_correction_slop_scale: _,
    } = v;
    b.work(43)?;
    numbers(
        &[
            v.x,
            v.y,
            v.velocity_x,
            v.velocity_y,
            v.rotation_radians,
            v.angular_velocity_radians_per_second,
            v.collider_offset_x,
            v.collider_offset_y,
            v.collider_restitution,
            v.collider_friction,
            v.collider_surface_velocity_x,
            v.collider_surface_velocity_y,
            v.collider_density,
            v.collider_contact_baumgarte_bias_scale,
            v.collider_max_contact_baumgarte_bias_velocity_scale,
            v.collider_contact_position_correction_scale,
            v.collider_contact_position_correction_slop_scale,
            v.inverse_mass,
            v.inverse_inertia,
            v.gravity_scale,
            v.linear_damping,
            v.angular_damping,
            v.restitution,
            v.friction,
            v.surface_velocity_x,
            v.surface_velocity_y,
            v.density,
            v.contact_baumgarte_bias_scale,
            v.max_contact_baumgarte_bias_velocity_scale,
            v.contact_position_correction_scale,
            v.contact_position_correction_slop_scale,
        ],
        "entity_snapshot",
        0,
    )?;
    f::require(
        f::finite_or_pos_inf(v.inertia),
        "entity_snapshot",
        "inertia",
        0,
        Problem::Number,
    )?;
    f::require(
        f::finite_or_pos_inf(v.mass),
        "entity_snapshot",
        "mass",
        0,
        Problem::Number,
    )?;
    f::require(
        v.body_type <= 2 && v.collider_type <= 7,
        "entity_snapshot",
        "codes",
        0,
        Problem::Code,
    )?;
    let empty = v.entity_id == 0
        && v.entity_generation == 0
        && v.body_type == 0
        && v.collider_type == 0
        && !v.body_enabled
        && !v.is_sleeping
        && !v.fixed_rotation
        && !v.collider_enabled
        && !v.collider_is_trigger
        && !v.collider_material_override
        && v.x == 0.0
        && v.y == 0.0
        && v.velocity_x == 0.0
        && v.velocity_y == 0.0
        && v.rotation_radians == 0.0
        && v.angular_velocity_radians_per_second == 0.0
        && v.collider_offset_x == 0.0
        && v.collider_offset_y == 0.0
        && v.collider_restitution == 0.0
        && v.collider_friction == 0.0
        && v.collider_surface_velocity_x == 0.0
        && v.collider_surface_velocity_y == 0.0
        && v.collider_density == 0.0
        && v.collider_contact_baumgarte_bias_scale == 0.0
        && v.collider_max_contact_baumgarte_bias_velocity_scale == 0.0
        && v.collider_contact_position_correction_scale == 0.0
        && v.collider_contact_position_correction_slop_scale == 0.0
        && v.mass == 0.0
        && v.inverse_mass == 0.0
        && v.inertia == 0.0
        && v.inverse_inertia == 0.0
        && v.gravity_scale == 0.0
        && v.linear_damping == 0.0
        && v.angular_damping == 0.0
        && v.restitution == 0.0
        && v.friction == 0.0
        && v.surface_velocity_x == 0.0
        && v.surface_velocity_y == 0.0
        && v.density == 0.0
        && v.contact_baumgarte_bias_scale == 0.0
        && v.max_contact_baumgarte_bias_velocity_scale == 0.0
        && v.contact_position_correction_scale == 0.0
        && v.contact_position_correction_slop_scale == 0.0;
    f::require(
        empty
            || (v.mass > 0.0
                && v.inertia > 0.0
                && (v.body_type != 2 || v.mass.is_finite())
                && (v.body_type != 2 || v.fixed_rotation || v.inertia.is_finite())
                && v.inverse_mass >= 0.0
                && v.inverse_inertia >= 0.0),
        "entity_snapshot",
        "mass_inertia",
        0,
        Problem::Number,
    )?;
    Ok(())
}

fn collider_snapshot(v: &PhysicsBodyColliderSnapshot, b: &mut Budget) -> Result<(), Error> {
    let PhysicsBodyColliderSnapshot {
        collider_index: _,
        collider_type: _,
        collider_enabled: _,
        collider_is_trigger: _,
        collider_offset_x: _,
        collider_offset_y: _,
        collider_material_override: _,
        collider_restitution: _,
        collider_friction: _,
        collider_surface_velocity_x: _,
        collider_surface_velocity_y: _,
        collider_density: _,
        collider_contact_baumgarte_bias_scale: _,
        collider_max_contact_baumgarte_bias_velocity_scale: _,
        collider_contact_position_correction_scale: _,
        collider_contact_position_correction_slop_scale: _,
        collider_category_bits: _,
        collider_mask_bits: _,
    } = v;
    b.work(18)?;
    numbers(
        &[
            v.collider_offset_x,
            v.collider_offset_y,
            v.collider_restitution,
            v.collider_friction,
            v.collider_surface_velocity_x,
            v.collider_surface_velocity_y,
            v.collider_density,
            v.collider_contact_baumgarte_bias_scale,
            v.collider_max_contact_baumgarte_bias_velocity_scale,
            v.collider_contact_position_correction_scale,
            v.collider_contact_position_correction_slop_scale,
        ],
        "collider_snapshot",
        0,
    )?;
    f::require(
        v.collider_type <= 7,
        "collider_snapshot",
        "type",
        0,
        Problem::Code,
    )?;
    Ok(())
}

fn joint_snapshot(v: &PhysicsJointSnapshot, b: &mut Budget) -> Result<(), Error> {
    let PhysicsJointSnapshot {
        frequency_hz: _,
        damping_ratio: _,
        joint_type: _,
        joint_index: _,
        joint_generation: _,
        entity_a_id: _,
        entity_a_generation: _,
        entity_b_id: _,
        entity_b_generation: _,
        rest_length: _,
        max_length: _,
        ratio: _,
        slack: _,
        reference_angle: _,
        break_force: _,
        break_torque: _,
        break_distance: _,
        break_angle: _,
        stiffness: _,
        damping: _,
        angular_stiffness: _,
        angular_damping: _,
        local_anchor_a_x: _,
        local_anchor_a_y: _,
        local_anchor_b_x: _,
        local_anchor_b_y: _,
        local_axis_a_x: _,
        local_axis_a_y: _,
        ground_anchor_a_x: _,
        ground_anchor_a_y: _,
        ground_anchor_b_x: _,
        ground_anchor_b_y: _,
        limit_enabled: _,
        continuous_limit: _,
        lower_angle: _,
        upper_angle: _,
        lower_translation: _,
        upper_translation: _,
        motor_enabled: _,
        motor_speed: _,
        max_motor_force: _,
        max_motor_torque: _,
        enabled: _,
    } = v;
    b.work(43)?;
    numbers(
        &[
            v.damping_ratio,
            v.rest_length,
            v.max_length,
            v.ratio,
            v.reference_angle,
            v.stiffness,
            v.damping,
            v.angular_stiffness,
            v.angular_damping,
            v.local_anchor_a_x,
            v.local_anchor_a_y,
            v.local_anchor_b_x,
            v.local_anchor_b_y,
            v.local_axis_a_x,
            v.local_axis_a_y,
            v.ground_anchor_a_x,
            v.ground_anchor_a_y,
            v.ground_anchor_b_x,
            v.ground_anchor_b_y,
            v.lower_angle,
            v.upper_angle,
            v.lower_translation,
            v.upper_translation,
            v.motor_speed,
            v.max_motor_force,
            v.max_motor_torque,
        ],
        "joint_snapshot",
        0,
    )?;
    f::require(
        f::finite_or_pos_inf(v.break_force),
        "joint_snapshot",
        "break_force",
        0,
        Problem::Number,
    )?;
    f::require(
        f::finite_or_pos_inf(v.break_torque),
        "joint_snapshot",
        "break_torque",
        0,
        Problem::Number,
    )?;
    f::require(
        f::finite_or_pos_inf(v.break_distance),
        "joint_snapshot",
        "break_distance",
        0,
        Problem::Number,
    )?;
    f::require(
        f::finite_or_pos_inf(v.break_angle),
        "joint_snapshot",
        "break_angle",
        0,
        Problem::Number,
    )?;
    f::require(
        v.joint_type <= 7 && v.frequency_hz.is_none_or(|x| x.is_finite()),
        "joint_snapshot",
        "type_frequency",
        0,
        Problem::Code,
    )?;
    Ok(())
}
