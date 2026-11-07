use super::{data_scene_visuals::sprite, *};
use crate::components::Rotation2D;

#[test]
fn spatial_shadow_only_proxy_follows_a_billboard_root_and_captures_its_yaw() {
    let mut e = Engine::new();
    e.use_data_scene();
    let actor = sprite(&mut e, 71, 0., 0., 0);
    let proxy = sprite(&mut e, 0, 0., 0., 0);
    let nested = sprite(&mut e, 0, 0., 0., 0);
    assert!(e.configure_data_scene_body(actor.id, actor.generation, 1, true, 2, 10., 32.));
    e.world.clear_collider(proxy);
    e.world.clear_collider(nested);
    assert!(e.configure_spatial_scene_models(
        &[0., 0., 160., 200., 0., 0., 0., 128., 0.1, 1000., 400., 300.],
        &[],
        &[],
        &[actor.id, actor.generation],
        &[1., 0.5, 0.],
        &[],
        &[],
        &[],
        &[],
        &[],
        &[],
        &[
            proxy.id,
            proxy.generation,
            1,
            5,
            1,
            12,
            nested.id,
            nested.generation,
            1,
            5,
            1,
            12,
        ],
        &[0., 0., 1., -4., 0., -4., 4., 24., 4., 0., 0., 1., -4., 0., -4., 4., 24., 4.],
    ));
    assert!(e.configure_spatial_attachments(
        &[
            proxy.id,
            proxy.generation,
            actor.id,
            actor.generation,
            1,
            nested.id,
            nested.generation,
            proxy.id,
            proxy.generation,
            0,
        ],
        &[3., 0., 2., 0., 0., 2., 3., 0.],
    ));
    e.world.set_transform(actor, Transform2D { x: 8., y: 4. });
    e.world.set_rotation(
        actor,
        Rotation2D {
            radians: std::f32::consts::FRAC_PI_2,
        },
    );
    e.build_render_commands();
    let draw = e
        .spatial_scene
        .models
        .draw_snapshot((proxy.id, proxy.generation));
    assert!((f32::from_bits(draw[16]) - 8.).abs() < 1e-5);
    assert_eq!(f32::from_bits(draw[17]), 12.);
    assert!((f32::from_bits(draw[18]) + 7.).abs() < 1e-5);
    assert_eq!(e.world.rigid_body(proxy), None);
    assert_eq!(e.world.collider_layer_at(proxy.id as usize), None);
    assert_eq!(e.world.height_span(proxy), None);
    assert_eq!(
        e.world
            .render_height_span_at(proxy.id as usize)
            .unwrap()
            .floor
            .0,
        2
    );
    let nested_draw = e
        .spatial_scene
        .models
        .draw_snapshot((nested.id, nested.generation));
    assert!((f32::from_bits(nested_draw[16]) - 6.).abs() < 1e-5);
    assert_eq!(f32::from_bits(nested_draw[17]), 15.);
    assert!((f32::from_bits(nested_draw[18]) + 7.).abs() < 1e-5);
    assert_eq!(e.world.rigid_body(nested), None);
    assert_eq!(e.world.collider_layer_at(nested.id as usize), None);
    assert_eq!(e.world.height_span(nested), None);
    assert_eq!(
        e.world
            .render_height_span_at(nested.id as usize)
            .unwrap()
            .floor
            .0,
        0
    );
    // A render-only child's elevation is still derived when interpolation is enabled.
    e.world.set_render_interpolation_alpha(Some(0.5));
    e.build_render_commands();
    assert_eq!(
        e.spatial_scene
            .models
            .draw_snapshot((proxy.id, proxy.generation)),
        draw
    );
    let rotations = e.capture_data_scene_spatial_rotations(
        e.data_scene_epoch(),
        &[actor.id, actor.generation, proxy.id, proxy.generation],
    );
    assert_eq!(rotations, vec![f64::from(std::f32::consts::FRAC_PI_2), 0.]);
}

#[test]
fn spatial_shadow_only_model_keeps_world_caster_pose_and_existing_output_abi() {
    let mut e = Engine::new();
    e.use_data_scene();
    let proxy = sprite(&mut e, 71, 0., 0., 0);
    e.world.set_aabb_collider(
        proxy,
        AabbCollider::new(2., 2., false, CollisionLayer::Wall),
    );
    assert!(e.configure_data_scene_body(proxy.id, proxy.generation, 0, true, 0, 0., 16.));
    let body = e.world.rigid_body(proxy);
    let collider = e.world.collider(proxy);
    let at = e.world.transform(proxy);
    let mut environment = vec![0.; 112];
    environment[0] = 1.;
    environment[2] = -1.;
    environment[60..76].copy_from_slice(&[
        100., 10., 8., 8., 0., 1., 1., 0., 1., 1., 1., 0., 1000., 0., 0., 0.,
    ]);
    environment[83..95].copy_from_slice(&[1., 0., 1., 0., 1., 1., 1., 1., 256., 128., 0.05, 64.]);
    let camera = [0., 0., 160., 200., 0., 0., 0., 128., 0.1, 1000., 400., 300.];
    let configure = |e: &mut Engine, flags| {
        e.configure_spatial_scene_models(
            &camera,
            &[],
            &[],
            &[],
            &[],
            &[],
            &[],
            &[],
            &environment,
            &[],
            &[],
            &[proxy.id, proxy.generation, 1, flags, 1, 12],
            &[0., 0., 1., -4., 0., -4., 4., 16., 4.],
        )
    };
    assert!(
        configure(&mut e, 5),
        "cast + shadow-only configuration rejected"
    );
    e.build_render_commands();
    let first = e
        .spatial_scene
        .models
        .draw_snapshot((proxy.id, proxy.generation));
    assert_eq!(first.len(), 20);
    assert_eq!(first[1], 1, "authoring-only bit leaked into render flags");
    assert_eq!(first[2] & 1, 0, "proxy entered the main camera pass");
    assert_eq!(
        first[2] & 128,
        128,
        "proxy did not reach the sun shadow pass"
    );
    assert!(e.configure_spatial_camera(&[
        0., 200., 160., 0., 0., 0., 0., 128., 0.1, 1000., 400., 300.,
    ]));
    e.build_render_commands();
    assert_eq!(
        e.spatial_scene
            .models
            .draw_snapshot((proxy.id, proxy.generation)),
        first,
        "camera orbit changed shadow-only geometry or visibility"
    );
    assert_eq!(e.world.rigid_body(proxy), body);
    assert_eq!(e.world.collider(proxy), collider);
    assert_eq!(e.world.transform(proxy), at);
    assert!(!configure(&mut e, 8), "unknown flags accepted");
    e.build_render_commands();
    assert_eq!(
        e.spatial_scene
            .models
            .draw_snapshot((proxy.id, proxy.generation)),
        first,
        "invalid replacement mutated the scene"
    );
    assert!(configure(&mut e, 1));
    e.build_render_commands();
    let visible = e
        .spatial_scene
        .models
        .draw_snapshot((proxy.id, proxy.generation));
    assert_eq!(visible[2] & 1, 1, "ordinary model lost camera visibility");
    assert_eq!(&visible[4..], &first[4..]);
    assert!(configure(&mut e, 4));
    e.build_render_commands();
    assert_eq!(
        e.spatial_scene
            .models
            .draw_snapshot((proxy.id, proxy.generation))[2],
        0,
        "disabled proxy cast shadows or appeared in the main pass"
    );
}
