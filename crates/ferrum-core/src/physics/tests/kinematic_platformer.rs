use super::*;
use crate::tilemap::Tilemap;

mod controller_slope_step;
mod controller_state;
mod ground_probe;
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
