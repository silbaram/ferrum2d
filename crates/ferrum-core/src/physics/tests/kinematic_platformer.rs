use super::*;
use crate::components::{HeightSpan, PhysicsFloorId};
use crate::tilemap::{Hd2dRampAxis, Hd2dTileKind, Tilemap};

mod controller_slope_step;
mod controller_state;
mod ground_probe;
mod hd2d_kinematic;
mod move_and_slide;
mod moving_platforms;
mod one_way_platforms;

fn platformer_test_config(solid_mask: CollisionMask) -> PlatformerControllerConfig {
    PlatformerControllerConfig::new(solid_mask, 4)
        .with_horizontal_speed(8.0)
        .with_gravity(20.0)
        .with_jump_speed(12.0)
        .with_max_fall_speed(100.0)
        .with_ground_probe_distance(1.0)
}

fn single_wall_tilemap() -> Tilemap {
    let mut tilemap = Tilemap::default();
    tilemap.set_layer(0, 3, 1, 10.0, 10.0, 0.0, 0.0, true, vec![0, 1, 0]);
    tilemap
}

fn single_one_way_tilemap() -> Tilemap {
    let mut tilemap = Tilemap::default();
    tilemap.set_layer(0, 1, 1, 10.0, 10.0, 0.0, 0.0, true, vec![1]);
    tilemap.set_tile_one_way_platform(1);
    tilemap
}

fn single_nonblocking_hd2d_tilemap() -> Tilemap {
    let mut tilemap = single_wall_tilemap();
    tilemap.set_tile_hd2d_definition(
        1,
        Hd2dTileKind::Bridge.code(),
        false,
        false,
        false,
        0.0,
        false,
        0,
        0.0,
        0.0,
    );
    tilemap
}

fn set_nonblocking_flat_tile(
    tilemap: &mut Tilemap,
    tile_id: u32,
    floor_id: u32,
    elevation: f32,
    height: f32,
) {
    assert!(tilemap.set_tile_height_span_definition(tile_id, floor_id, elevation, height));
    assert!(tilemap.set_tile_hd2d_definition(
        tile_id,
        Hd2dTileKind::Flat.code(),
        false,
        false,
        false,
        height,
        false,
        0,
        0.0,
        0.0,
    ));
}

fn set_nonblocking_ramp_tile(
    tilemap: &mut Tilemap,
    tile_id: u32,
    floor_id: u32,
    height: f32,
    axis: Hd2dRampAxis,
    start_elevation: f32,
    end_elevation: f32,
) {
    assert!(tilemap.set_tile_height_span_definition(
        tile_id,
        floor_id,
        start_elevation.min(end_elevation),
        height,
    ));
    assert!(tilemap.set_tile_hd2d_definition(
        tile_id,
        Hd2dTileKind::Ramp.code(),
        false,
        false,
        false,
        height,
        true,
        axis.code(),
        start_elevation,
        end_elevation,
    ));
}
