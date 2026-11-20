//! Private complete runtime schema. One field list controls encoding, decoding
//! and exhaustiveness. Each decoded field has a separate cold stack frame.
use super::*;

macro_rules! state_schema {
    ($( $(#[$attribute:meta])* $name:ident: $ty:ty, )*) => {
        #[derive(serde::Serialize)]
        #[serde(remote = "Engine")]
        pub(crate) struct State {
            #[serde(skip)]
            checkpoint_owner: std::sync::Arc<()>,
            $( $(#[$attribute])* $name: $ty, )*
            #[serde(skip)]
            physics_restore_transaction: Option<crate::world::WorldTransactionSnapshot>,
        }
        struct Restore(Box<Engine>);
        impl<'de> serde::Deserialize<'de> for Restore {
            fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
                struct Visitor;
                impl<'de> serde::de::Visitor<'de> for Visitor {
                    type Value = Restore;
                    fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                        f.write_str("complete Engine checkpoint sequence")
                    }
                    fn visit_seq<A: serde::de::SeqAccess<'de>>(self, mut sequence: A) -> Result<Restore, A::Error> {
                        // Conservative fixed allowance for the bare candidate's default
                        // queues/scene before saved fields replace them.
                        crate::checkpoint_decode::reserve_bytes(64 * 1024 * 1024)
                            .map_err(|_| serde::de::Error::custom("checkpoint candidate budget exceeded"))?;
                        let mut engine = Box::new(Engine::new_checkpoint_candidate());
                        $( assign::$name(&mut sequence, &mut engine)?; )*
                        Ok(Restore(engine))
                    }
                }
                deserializer.deserialize_tuple([$( stringify!($name) ),*].len(), Visitor)
            }
        }
        mod assign {
            use super::*;
            $(
                #[inline(never)]
                pub(super) fn $name<'de, A: serde::de::SeqAccess<'de>>(sequence: &mut A, engine: &mut Engine) -> Result<(), A::Error> {
                    #[derive(serde::Deserialize)]
                    struct Field($(#[$attribute])* $ty);
                    engine.$name = sequence.next_element::<Field>()?
                        .ok_or_else(|| serde::de::Error::custom(concat!("missing Engine field: ", stringify!($name))))?.0;
                    Ok(())
                }
            )*
        }
        fn assert_complete_schema(engine: &Engine) {
            let Engine { checkpoint_owner: _, physics_restore_transaction: _, $( $name: _, )* } = engine;
        }
    }
}
state_schema! {
    checkpoint_revision: u32,
    unified_physics: Option<unified_physics::UnifiedPhysicsRuntime>,
    default_unified_physics: Option<crate::physics3d::WorldConfig>,
    default_unified_physics_fixed: bool,
    #[serde(with = "crate::checkpoint_codec::vector")]
    unified_physics_body_states: Vec<unified_physics::web_bridge::BodyStateRecord>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    unified_physics_character_states: Vec<unified_physics::web_bridge::CharacterStateRecord>,
    unified_physics_queries: unified_physics::web_bridge::QueryBuffers,
    unified_physics_collisions: unified_physics::CollisionBuffers,
    unified_physics_observations: unified_physics::ObservationBuffers,
    unified_physics_joints: unified_physics::JointBuffers,
    elapsed_seconds: f64,
    input: InputState,
    input_actions: InputActionRegistry,
    previous_input_sample: InputState,
    fixed_timestep_input_latch: FixedTimestepInputLatch,
    scene_mode: SceneMode,
    scenes: BuiltInSceneSlots,
    data_scene: DataSceneRuntime,
    spatial_scene: crate::spatial_scene::SpatialScene,
    authoring_continuity: data_scene_authoring_continuity::AuthoringContinuity,
    camera: Camera2D,
    #[serde(with = "crate::world::persistence::State")]
    world: World,
    data_scene_entity: Option<Entity>,
    ground_sun: crate::world::ground_shadow::GroundSun,
    ground_shadow_stats: [u32; 5],
    gameplay_authoring_snapshot: Option<GameplayAuthoringSnapshot>,
    #[serde(with = "crate::tilemap::checkpoint_state::State")]
    tilemap: Tilemap,
    #[serde(with = "crate::particles::checkpoint_state::State")]
    particles: ParticleSystem,
    bitmap_text: BitmapTextSystem,
    tweens: TweenSystem,
    #[serde(with = "crate::checkpoint_codec::vector")]
    particle_presets: Vec<Option<ParticlePreset>>,
    impact_feedback: physics_impact_feedback::ImpactFeedback,
    shooter_hit_particle_preset: Option<u32>,
    frame_buffers: EngineFrameBuffers,
    tilemap_navigation_scratch: TilemapNavigationScratch,
    physics_debug_collision_scratch: CollisionScratch,
    physics_debug_lines_enabled: bool,
    collision_lifecycle_events_enabled: bool,
    physics_debug_line_flags: u32,
    #[serde(with = "crate::collision_event::checkpoint_state::State")]
    collision_event_tracker: CollisionEventTracker,
    collision_event_counts: CollisionEventCounts,
    physics_counters: PhysicsCounters,
    physics_query_result: PhysicsQueryResult,
    #[serde(with = "crate::checkpoint_codec::vector")]
    physics_query_hits: Vec<PhysicsQueryEntityHit>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    physics_raycast_hits: Vec<PhysicsRaycastBodyHit>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    physics_tile_shape_cast_hits: Vec<PhysicsTileShapeCastHit>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    physics_tile_contact_hits: Vec<PhysicsTileContactHit>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    physics_tile_manifold_hits: Vec<PhysicsTileManifoldHit>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    physics_body_contact_hits: Vec<PhysicsBodyContactHit>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    physics_body_manifold_hits: Vec<PhysicsBodyManifoldHit>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    physics_rigid_contact_impulse_hits: Vec<PhysicsRigidContactImpulseHit>,
    physics_collision_query_scratch: CollisionScratch,
    #[serde(with = "crate::checkpoint_codec::vector")]
    physics_point_query_scratch: Vec<PointQueryHit>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    physics_aabb_query_scratch: Vec<AabbQueryHit>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    physics_circle_query_scratch: Vec<CircleQueryHit>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    physics_shape_query_scratch: Vec<ShapeQueryHit>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    physics_raycast_scratch: Vec<RaycastHit>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    physics_shape_cast_scratch: Vec<ShapeCastHit>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    physics_body_contact_scratch: Vec<CollisionContact>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    physics_body_manifold_scratch: Vec<CollisionManifold>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    physics_tile_shape_cast_scratch: Vec<TilemapShapeCastHit>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    physics_tile_contact_scratch: Vec<TilemapContactHit>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    physics_tile_manifold_scratch: Vec<TilemapContactManifoldHit>,
    physics_entity_snapshot: PhysicsEntitySnapshot,
    physics_body_collider_snapshot: PhysicsBodyColliderSnapshot,
    physics_joint_snapshot: PhysicsJointSnapshot,
    #[serde(with = "crate::checkpoint_codec::vector")]
    physics_body_snapshot_floats: Vec<f32>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    physics_body_snapshot_u32s: Vec<u32>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    shooter_snapshot_header_floats: Vec<f32>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    shooter_snapshot_header_u32s: Vec<u32>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    shooter_snapshot_entity_floats: Vec<f32>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    shooter_snapshot_entity_u32s: Vec<u32>,
    rigid_body_step_stats: RigidBodyStepStats,
    rigid_body_frame_stats: RigidBodyFrameStats,
    rigid_body_step_scratch: RigidBodyStepScratch,
    hd2d_kinematic_elevation_delta: f32,
    hd2d_kinematic_flags: u32,
    hd2d_kinematic_hit_count: u32,
    auto_rigid_body_step_enabled: bool,
    auto_rigid_body_step_config: RigidBodyStepConfig,
    #[serde(with = "crate::physics::fixed_timestep::checkpoint_state::State")]
    fixed_timestep: FixedTimestep,
    fixed_timestep_enabled: bool,
    render_interpolation_enabled: bool,
    last_fixed_update: FixedTimestepUpdate,
}

#[derive(serde::Serialize)]
struct Capture<'a> {
    #[serde(with = "State")]
    engine: &'a Engine,
}
pub(super) fn encode(engine: &Engine) -> Result<Vec<u8>, RuntimeCheckpointError> {
    assert_complete_schema(engine);
    crate::checkpoint_codec::encode(&Capture { engine })
}
#[cfg(test)]
pub(super) fn decode(bytes: &[u8]) -> Result<Box<Engine>, RuntimeCheckpointError> {
    decode_with_limits(bytes, crate::checkpoint_decode::Limits::default())
}
pub(super) fn decode_with_limits(
    bytes: &[u8],
    limits: crate::checkpoint_decode::Limits,
) -> Result<Box<Engine>, RuntimeCheckpointError> {
    let Restore(engine) = crate::checkpoint_codec::decode_with_limits(bytes, limits)?;
    Ok(engine)
}

pub(super) fn decode_in_scope(bytes: &[u8]) -> Result<Box<Engine>, RuntimeCheckpointError> {
    let Restore(engine) = crate::checkpoint_codec::decode_in_scope(bytes)?;
    Ok(engine)
}

#[cfg(test)]
pub(in crate::engine) fn assert_encoding_roundtrip(engine: &Engine) {
    let bytes = encode(engine).unwrap();
    let restored = decode(&bytes).unwrap();
    assert_eq!(encode(&restored).unwrap(), bytes);
}

#[cfg(test)]
#[test]
fn engine_serialization_complete_builtin_and_native_payload_roundtrip_is_canonical() {
    let mut engine = Engine::new();
    engine.update(0.017);
    assert_encoding_roundtrip(&engine);
    for space in [
        crate::physics3d::Space::PlanarXy,
        crate::physics3d::Space::Spatial,
    ] {
        engine.use_data_scene();
        engine
            .configure_unified_physics(crate::physics3d::WorldConfig {
                space,
                ..Default::default()
            })
            .unwrap();
        let body = engine
            .create_unified_body(
                crate::physics3d::BodyDesc::default(),
                crate::physics3d::ColliderDesc::new(crate::physics3d::Shape::Sphere {
                    radius: 0.4,
                }),
                [0.; 3],
            )
            .unwrap();
        engine
            .apply_unified_body_impulse(body, [1., 2., 0.])
            .unwrap();
        engine.update(0.021);
        assert_encoding_roundtrip(&engine);
    }
}
