use super::{data_scene_visuals::sprite, *};
use crate::spatial_scene::{SpatialMaterial, SpatialReceiverMasks};

fn setup() -> (Engine, [Entity; 4]) {
    let mut engine = Engine::new();
    engine.use_data_scene();
    engine.set_viewport_size(400., 300.);
    let entities = std::array::from_fn(|i| sprite(&mut engine, 71, i as f32 * 2., 0., 0));
    (engine, entities)
}

fn configure(
    engine: &mut Engine,
    entities: &[Entity; 4],
    terrain: &[u32],
    billboards: &[u32],
    models: &[u32],
) -> bool {
    let [a, b, c, d] = *entities;
    engine.configure_spatial_scene_receiver_masks(
        &[
            0., 0., 100., 200., 0., 16., 0., 200., 0.1, 1000., 400., 300.,
        ],
        &[
            -32., -32., 64., 64., 0., 16., 16., 1., 1., 1., 1., 96., -32., 32., 64., 0., 16., 16.,
            1., 1., 1., 1.,
        ],
        &[1, 0, 16_777_215, 1, 2, 0, 16_777_215, 17],
        &[b.id, b.generation, a.id, a.generation],
        &[1., 0.5, 0., 1., 0.5, 0.],
        &[],
        &[],
        &[],
        &[],
        &[3, 0],
        &[],
        &[
            d.id,
            d.generation,
            1,
            3,
            1,
            8,
            c.id,
            c.generation,
            1,
            3,
            1,
            8,
        ],
        &[
            0., 0., 1., -2., 0., -2., 2., 4., 2., 0., 0., 1., -2., 0., -2., 2., 4., 2.,
        ],
        terrain,
        billboards,
        models,
    )
}

fn masks(light_mask: u32, shadow_mask: u32) -> SpatialReceiverMasks {
    SpatialReceiverMasks {
        light_mask,
        shadow_mask,
    }
}

#[test]
fn spatial_receiver_mask_streams_preserve_old_abis_and_follow_sorted_instances() {
    let (mut engine, entities) = setup();
    assert!(configure(&mut engine, &entities, &[], &[], &[]));
    engine.build_render_commands();
    assert_eq!(engine.spatial_receiver_mask_abi_version(), 1);
    assert_eq!(engine.spatial_receiver_mask_size(), 8);
    assert_eq!(std::mem::size_of::<SpatialMaterial>(), 8);
    assert_eq!(engine.spatial_material_abi_version(), 1);
    assert_eq!(engine.spatial_model_abi_version(), 1);
    assert_eq!(engine.spatial_model_stride(), 20);
    assert_eq!(engine.spatial_terrain_receiver_mask_len(), 0);
    assert_eq!(engine.spatial_billboard_receiver_mask_len(), 0);
    assert_eq!(engine.spatial_model_receiver_mask_len(), 0);
    assert_eq!(engine.spatial_scene.billboard_receiver_masks.capacity(), 0);
    assert_eq!(engine.spatial_scene.models.receiver_masks.capacity(), 0);

    assert!(configure(
        &mut engine,
        &entities,
        &[255; 4],
        &[255; 4],
        &[255; 4]
    ));
    engine.build_render_commands();
    assert_eq!(engine.spatial_terrain_receiver_mask_len(), 0);
    assert_eq!(engine.spatial_billboard_receiver_mask_len(), 0);
    assert_eq!(engine.spatial_model_receiver_mask_len(), 0);

    assert!(configure(
        &mut engine,
        &entities,
        &[0, 1, 255, 255],
        &[255, 255, 1, 0],
        &[255, 255, 2, 3]
    ));
    engine.build_render_commands();
    assert_eq!(
        engine.spatial_scene.terrain_receiver_masks,
        [masks(0, 1), masks(255, 255)]
    );
    assert_eq!(
        engine.spatial_scene.billboard_receiver_masks,
        [masks(1, 0), masks(255, 255)]
    );
    assert_eq!(
        engine.spatial_scene.models.receiver_masks,
        [masks(2, 3), masks(255, 255)]
    );
    assert_eq!(engine.spatial_billboard_receiver_mask_len(), 2);
    assert_eq!(engine.spatial_model_receiver_mask_len(), 2);
    // SAFETY: borrowed aligned two-word records, read before the next native mutation.
    let terrain =
        unsafe { std::slice::from_raw_parts(engine.spatial_terrain_receiver_mask_ptr(), 4) };
    assert_eq!(terrain, [0, 1, 255, 255]);
    let models =
        unsafe { std::slice::from_raw_parts(engine.spatial_model_ptr().cast::<u32>(), 40) };
    assert_eq!(
        [models[3], models[23]],
        [0, 0],
        "v1 model reserved words stay zero"
    );
}

#[test]
fn spatial_receiver_mask_configuration_rejects_bad_channels_counts_and_proxies_atomically() {
    let (mut engine, entities) = setup();
    let terrain = [0, 1, 255, 255];
    let billboards = [255, 255, 1, 0];
    let models = [255, 255, 2, 3];
    assert!(configure(
        &mut engine,
        &entities,
        &terrain,
        &billboards,
        &models
    ));
    engine.build_render_commands();
    let revision = engine.spatial_terrain_revision();
    let camera = engine.spatial_scene.camera.unwrap().parameters;
    for (t, b, m) in [
        (&[256, 1, 255, 255][..], &billboards[..], &models[..]),
        (&terrain[..], &[255, 255, 1][..], &models[..]),
        (&terrain[..], &billboards[..], &[255, 255, 2, u32::MAX][..]),
        (&[0, 1, 0, 0][..], &billboards[..], &models[..]),
    ] {
        assert!(!configure(&mut engine, &entities, t, b, m));
        assert_eq!(engine.spatial_terrain_revision(), revision);
        assert_eq!(engine.spatial_scene.camera.unwrap().parameters, camera);
        engine.build_render_commands();
        assert_eq!(
            engine.spatial_scene.terrain_receiver_masks,
            [masks(0, 1), masks(255, 255)]
        );
        assert_eq!(
            engine.spatial_scene.billboard_receiver_masks,
            [masks(1, 0), masks(255, 255)]
        );
        assert_eq!(
            engine.spatial_scene.models.receiver_masks,
            [masks(2, 3), masks(255, 255)]
        );
    }
}

#[test]
fn spatial_receiver_masks_skip_stale_generations_and_clear_with_scene_or_default_configuration() {
    let (mut engine, entities) = setup();
    assert!(configure(
        &mut engine,
        &entities,
        &[0, 1, 255, 255],
        &[255, 255, 1, 0],
        &[255, 255, 2, 3]
    ));
    engine.world.despawn(entities[0]);
    engine.world.despawn(entities[2]);
    let reused = sprite(&mut engine, 71, 0., 0., 0);
    assert!(entities
        .iter()
        .any(|old| old.id == reused.id && old.generation != reused.generation));
    engine.build_render_commands();
    assert_eq!(engine.spatial_scene.billboard_materials.len(), 1);
    assert_eq!(engine.spatial_model_len(), 1);
    assert_eq!(engine.spatial_billboard_receiver_mask_len(), 0);
    assert_eq!(engine.spatial_model_receiver_mask_len(), 0);
    assert!(!configure(&mut engine, &entities, &[], &[], &[]));
    assert_eq!(engine.spatial_scene.terrain_receiver_masks[0], masks(0, 1));
    engine.clear_spatial_scene();
    assert_eq!(engine.spatial_terrain_receiver_mask_len(), 0);
    assert_eq!(engine.spatial_billboard_receiver_mask_len(), 0);
    assert_eq!(engine.spatial_model_receiver_mask_len(), 0);

    let (mut engine, entities) = setup();
    assert!(configure(
        &mut engine,
        &entities,
        &[0, 1, 255, 255],
        &[255, 255, 1, 0],
        &[255, 255, 2, 3]
    ));
    assert!(configure(&mut engine, &entities, &[], &[], &[]));
    engine.build_render_commands();
    assert_eq!(engine.spatial_terrain_receiver_mask_len(), 0);
    assert_eq!(engine.spatial_billboard_receiver_mask_len(), 0);
    assert_eq!(engine.spatial_model_receiver_mask_len(), 0);
}

#[test]
fn generated_spatial_quad_gaps_keep_materials_and_mask_streams_aligned() {
    let (mut engine, entities) = setup();
    assert!(configure(
        &mut engine,
        &entities,
        &[],
        &[255, 255, 1, 0],
        &[]
    ));
    engine.build_render_commands();
    let scene = &mut engine.spatial_scene;
    let quad = scene.billboards[..6].to_vec();
    scene.billboards.extend_from_slice(&quad); // An unbound generated glyph.
    scene.pad_billboard_receiver_masks();
    assert_eq!(
        scene.billboard_materials.len(),
        2,
        "glyphs keep the legacy default material fallback"
    );
    assert_eq!(
        scene.billboard_receiver_masks.len(),
        3,
        "a trailing glyph still has neutral receiver metadata"
    );
    scene.billboards.extend_from_slice(&quad); // A generated particle with flags0.
    scene.push_billboard_material(
        SpatialMaterial {
            normal_texture: 16_777_215,
            flags: 0,
        },
        Default::default(),
    );
    assert_eq!(scene.billboard_materials.len(), 4);
    assert_eq!(scene.billboard_materials[2], SpatialMaterial::default());
    assert_eq!(scene.billboard_materials[3].flags, 0);
    assert_eq!(
        scene.billboard_receiver_masks,
        [
            masks(1, 0),
            masks(255, 255),
            masks(255, 255),
            masks(255, 255)
        ]
    );
}

#[test]
fn spatial_receiver_streams_pad_defaults_before_the_first_visible_custom_instance() {
    let (mut engine, entities) = setup();
    assert!(configure(
        &mut engine,
        &entities,
        &[],
        &[9, 1, 255, 255],
        &[9, 1, 255, 255]
    ));
    engine.build_render_commands();
    assert_eq!(
        engine.spatial_scene.billboard_receiver_masks,
        [masks(255, 255), masks(9, 1)]
    );
    assert_eq!(
        engine.spatial_scene.models.receiver_masks,
        [masks(255, 255), masks(9, 1)]
    );
}

#[test]
fn native_spatial_progress_restores_poses_without_losing_authored_receiver_masks() {
    let (mut engine, entities) = setup();
    assert!(configure(
        &mut engine,
        &entities,
        &[0, 1, 255, 255],
        &[255, 255, 1, 0],
        &[255, 255, 2, 3]
    ));
    let handles: Vec<_> = entities
        .iter()
        .flat_map(|entity| [entity.id, entity.generation])
        .collect();
    let epoch = engine.data_scene_epoch();
    let states = engine.capture_data_scene_progress(epoch, &handles);
    let spatial = engine.capture_data_scene_spatial_progress(epoch, &handles);
    assert!(!states.is_empty() && !spatial.is_empty());
    engine
        .world
        .set_transform(entities[0], Transform2D { x: 15., y: 7. });
    assert!(engine.restore_data_scene_progress_with_spatial(
        epoch,
        &handles,
        &states,
        &[],
        &spatial
    ));
    assert_eq!(engine.world.transform(entities[0]).unwrap().x, 0.);
    engine.build_render_commands();
    assert_eq!(
        engine.spatial_scene.terrain_receiver_masks,
        [masks(0, 1), masks(255, 255)]
    );
    assert_eq!(
        engine.spatial_scene.billboard_receiver_masks,
        [masks(1, 0), masks(255, 255)]
    );
    assert_eq!(
        engine.spatial_scene.models.receiver_masks,
        [masks(2, 3), masks(255, 255)]
    );
}
