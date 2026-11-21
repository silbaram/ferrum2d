//! Test-only wire candidates. The real private codec decodes each owner ADT and
//! the complete World; no admission helper generates or repairs these fixtures.
use super::*;
fn owner<T: serde::Serialize, U: serde::Serialize + serde::de::DeserializeOwned>(raw: &T) -> U {
    let bytes = crate::checkpoint_codec::encode(raw).unwrap();
    let decoded: U = crate::checkpoint_codec::decode(&bytes).unwrap();
    assert_eq!(
        bytes,
        crate::checkpoint_codec::encode(&decoded).unwrap(),
        "private owner codec must preserve candidate verbatim"
    );
    decoded
}
#[derive(serde::Serialize)]
struct RawMachine {
    current_state: u32,
    #[serde(with = "crate::checkpoint_codec::array")]
    transitions: [Option<BehaviorStateTransition>; 32],
    len: usize,
}
fn machine() -> RawMachine {
    let mut transitions = [None; 32];
    transitions[0] = Some(BehaviorStateTransition::new(1, 2, 0));
    RawMachine {
        current_state: 1,
        transitions,
        len: 1,
    }
}
#[derive(serde::Serialize)]
struct RawBindings {
    #[serde(with = "crate::checkpoint_codec::array")]
    bindings: [Option<ActionBinding>; 16],
    len: usize,
}
#[derive(serde::Serialize)]
struct RawReactions {
    #[serde(with = "crate::checkpoint_codec::array")]
    reactions: [Option<CollisionReaction>; 16],
    #[serde(with = "crate::checkpoint_codec::array")]
    guards: [GameplayVariableComparison; 16],
    len: usize,
}
#[derive(serde::Serialize)]
struct RawEnter {
    #[serde(with = "crate::checkpoint_codec::array")]
    actions: [Option<BehaviorStateEnterAction>; 32],
    len: usize,
}
#[derive(serde::Serialize)]
struct RawMutation {
    #[serde(with = "crate::checkpoint_codec::array")]
    triggers: [Option<GameplayVariableMutationTrigger>; 16],
    len: usize,
}
#[derive(serde::Serialize)]
struct RawGuard {
    enabled: bool,
    left_slot: u32,
    operator: GameplayVariableComparisonOperator,
    right_slot: u32,
    right_literal: f64,
}
#[test]
fn fixed_adt_backing_lengths_holes_duplicates_and_hidden_guards_are_rejected() {
    let mut raw = machine();
    raw.len = 33;
    let mut w = coverage();
    w.behavior_state_machines[0] = Some(owner(&raw));
    rejected(&w);
    let mut raw = machine();
    raw.len = 0;
    let mut w = coverage();
    w.behavior_state_machines[0] = Some(owner(&raw));
    rejected(&w);
    let mut raw = machine();
    raw.transitions[2] = raw.transitions[0];
    raw.transitions[0] = None;
    let mut w = coverage();
    w.behavior_state_machines[0] = Some(owner(&raw));
    rejected(&w);
    let mut raw = machine();
    raw.transitions[1] = raw.transitions[0];
    raw.len = 2;
    let mut w = coverage();
    w.behavior_state_machines[0] = Some(owner(&raw));
    rejected(&w);
    let binding = ActionBinding::dash(1, 0.1, -2.);
    for (len, second) in [(17, false), (0, false), (2, true)] {
        let mut raw = RawBindings {
            bindings: [None; 16],
            len,
        };
        raw.bindings[0] = Some(binding);
        if second {
            raw.bindings[1] = Some(binding);
        }
        let mut w = coverage();
        w.action_bindings[0] = Some(owner(&raw));
        rejected(&w);
    }
    let enter =
        BehaviorStateEnterAction::new(1, 2, BehaviorStateEnterActionPhase::NextFramePrePhysics);
    for (len, second) in [(33, false), (0, false), (2, true)] {
        let mut raw = RawEnter {
            actions: [None; 32],
            len,
        };
        raw.actions[0] = Some(enter);
        if second {
            raw.actions[1] = Some(enter);
        }
        let mut w = coverage();
        w.behavior_state_enter_actions[0] = Some(owner(&raw));
        rejected(&w);
    }
    let reaction = CollisionReaction::Damage {
        target: CollisionTarget::OtherEntity,
    };
    for (len, second) in [(17, false), (0, false), (2, true)] {
        let mut raw = RawReactions {
            reactions: [None; 16],
            guards: [GameplayVariableComparison::always(); 16],
            len,
        };
        raw.reactions[0] = Some(reaction);
        if second {
            raw.reactions[1] = Some(reaction);
        }
        let mut w = coverage();
        w.collision_reactions[0] = Some(owner(&raw));
        rejected(&w);
    }
    let trigger =
        GameplayVariableMutationTrigger::new(1, 2, 64, GameplayVariableMutationOperation::Set, 3.)
            .unwrap();
    for (len, second) in [(17, false), (0, false), (2, true)] {
        let mut raw = RawMutation {
            triggers: [None; 16],
            len,
        };
        raw.triggers[0] = Some(trigger);
        if second {
            raw.triggers[1] = Some(trigger);
        }
        let mut w = coverage();
        w.gameplay_variable_mutation_triggers[0] = Some(owner(&raw));
        rejected(&w);
    }
    for raw in [
        RawGuard {
            enabled: true,
            left_slot: 0,
            operator: GameplayVariableComparisonOperator::Equal,
            right_slot: 0,
            right_literal: 0.,
        },
        RawGuard {
            enabled: false,
            left_slot: 1,
            operator: GameplayVariableComparisonOperator::Equal,
            right_slot: 0,
            right_literal: 0.,
        },
        RawGuard {
            enabled: true,
            left_slot: 1,
            operator: GameplayVariableComparisonOperator::Equal,
            right_slot: 65,
            right_literal: 0.,
        },
        RawGuard {
            enabled: true,
            left_slot: 1,
            operator: GameplayVariableComparisonOperator::Equal,
            right_slot: 2,
            right_literal: 1.,
        },
    ] {
        let guard: GameplayVariableComparison = owner(&raw);
        let mut w = coverage();
        w.interactions[0].as_mut().unwrap().guard = guard;
        rejected(&w);
        let mut w = coverage();
        let mut raw = machine();
        raw.transitions[0].as_mut().unwrap().guard = guard;
        w.behavior_state_machines[0] = Some(owner(&raw));
        rejected(&w);
    }
    let mut raw = RawReactions {
        reactions: [None; 16],
        guards: [GameplayVariableComparison::always(); 16],
        len: 0,
    };
    raw.guards[15] =
        GameplayVariableComparison::new(1, GameplayVariableComparisonOperator::Equal, 0, 0.)
            .unwrap();
    let mut w = coverage();
    w.collision_reactions[0] = Some(owner(&raw));
    rejected(&w);
    let mut raw = RawMutation {
        triggers: [None; 16],
        len: 1,
    };
    let mut bad = trigger;
    bad.slot = 0;
    raw.triggers[0] = Some(bad);
    let mut w = coverage();
    w.gameplay_variable_mutation_triggers[0] = Some(owner(&raw));
    rejected(&w);
}
#[derive(serde::Serialize)]
struct RawTimeline {
    #[serde(with = "crate::checkpoint_codec::vector")]
    order: Vec<usize>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    ends: Vec<f64>,
}
#[derive(serde::Serialize)]
struct RawClip {
    id: u32,
    #[serde(with = "crate::checkpoint_codec::vector")]
    frames: Vec<SpriteFrame>,
    fps: f32,
    looping: bool,
    emit_events: bool,
    timeline: Option<RawTimeline>,
}
fn clip() -> RawClip {
    RawClip {
        id: 4,
        frames: vec![SpriteFrame::FULL; 3],
        fps: 0.,
        looping: true,
        emit_events: true,
        timeline: Some(RawTimeline {
            order: vec![0, 1, 2, 1],
            ends: vec![0.001, 0.003, 0.006, 0.008],
        }),
    }
}
fn with_clip(raw: &RawClip) -> World {
    let mut w = coverage();
    w.sprite_playbacks[0].as_mut().unwrap().clips = Arc::from([owner::<_, SpriteClip>(raw)]);
    w
}
#[test]
fn private_clip_timeline_order_ends_frames_and_playback_indices_are_checked() {
    admitted(&copied(&with_clip(&clip())));
    let mut raw = clip();
    raw.timeline.as_mut().unwrap().ends.clear();
    rejected(&with_clip(&raw));
    let mut raw = clip();
    raw.timeline.as_mut().unwrap().order[1] = 3;
    rejected(&with_clip(&raw));
    let mut raw = clip();
    raw.timeline.as_mut().unwrap().ends[1] = 0.0005;
    rejected(&with_clip(&raw));
    let mut raw = clip();
    raw.timeline.as_mut().unwrap().ends[1] = f64::NAN;
    rejected(&with_clip(&raw));
    let mut raw = clip();
    raw.timeline.as_mut().unwrap().order = vec![0, 1, 1, 2];
    rejected(&with_clip(&raw));
    let mut raw = clip();
    raw.frames.clear();
    rejected(&with_clip(&raw));
    let mut raw = clip();
    raw.frames[2].u1 = raw.frames[2].u0;
    rejected(&with_clip(&raw));
    let mut raw = clip();
    raw.timeline = None;
    rejected(&with_clip(&raw));
    let mut w = coverage();
    w.sprite_playbacks[0].as_mut().unwrap().active = 1;
    rejected(&w);
    let mut w = coverage();
    w.sprite_playbacks[0].as_mut().unwrap().elapsed = f64::INFINITY;
    rejected(&w);
    let mut w = coverage();
    w.sprite_playbacks[0].as_mut().unwrap().elapsed = -0.01;
    rejected(&w);
    let mut w = coverage();
    w.sprite_playbacks[0].as_mut().unwrap().clips = Arc::from([
        SpriteClip::uniform(1, vec![SpriteFrame::FULL], 1., true),
        SpriteClip::uniform(1, vec![SpriteFrame::FULL], 2., true),
    ]);
    rejected(&w);
    // Full producer direction/timing matrix and phase updates, including the
    // reverse UVs accepted by ProjectilePrefab, one-frame and ping-pong cases.
    for n in [1, 2, 3, 32, 256] {
        for looping in [false, true] {
            for direction in 0..3 {
                for timed in [false, true] {
                    let frames = vec![
                        SpriteFrame {
                            u0: 1.,
                            v0: 1.,
                            u1: 0.,
                            v1: 0.
                        };
                        n
                    ];
                    let times = vec![1.; n];
                    let clip =
                        SpriteClip::uniform(65535, frames, if timed { 0. } else { 1000. }, looping)
                            .extended(direction, if timed { Some(&times) } else { None }, true)
                            .unwrap();
                    let mut w = coverage();
                    w.sprite_playbacks[0].as_mut().unwrap().clips = Arc::from([clip]);
                    for _ in 0..20 {
                        w.sprite_playbacks[0].as_mut().unwrap().advance(0.003);
                        admitted(&copied(&w));
                    }
                }
            }
        }
    }
}
#[test]
fn variable_clip_work_is_precharged_before_malformed_content_walk() {
    let mut raw = clip();
    raw.timeline.as_mut().unwrap().order = vec![usize::MAX; 100_000];
    let w = with_clip(&raw);
    let before = bytes(&w);
    assert_eq!(
        w.validate_payload_admission(WorldPayloadAdmissionLimits {
            max_nested_items: 8,
            ..limits()
        }),
        Err(WorldPayloadAdmissionError::NestedItems)
    );
    assert_eq!(before, bytes(&w));
}
#[test]
fn legacy_frame_state_time_and_sequence_backing_are_checked_without_new_fps_cutoff() {
    let mut w = coverage();
    w.sprite_animations[0].as_mut().unwrap().current_frame = 1;
    rejected(&w);
    let mut w = coverage();
    w.sprite_animations[0].as_mut().unwrap().elapsed_seconds = 1.;
    rejected(&w);
    let mut w = coverage();
    w.sprite_animations[0].as_mut().unwrap().idle.frame_count = 0;
    rejected(&w);
    let mut w = coverage();
    w.sprite_animations[0].as_mut().unwrap().columns = 0;
    rejected(&w);
    let mut w = coverage();
    w.sprite_animations[0] = SpriteAnimation::horizontal(2, f32::MAX);
    admitted(&copied(&w)); // Do not step the known unbounded while path.
    #[derive(serde::Serialize)]
    struct Frames {
        #[serde(with = "crate::checkpoint_codec::array")]
        frames: [SpriteFrame; 32],
        frame_count: u32,
    }
    let mut raw = Frames {
        frames: [SpriteFrame::FULL; 32],
        frame_count: 1,
    };
    raw.frames[31].v1 = f32::NAN;
    let sequence: SpriteAnimationFrameSequence = owner(&raw);
    let mut w = coverage();
    w.sprite_animations[0].as_mut().unwrap().idle_frames = Some(sequence);
    rejected(&w);
    raw.frame_count = 0;
    assert!(
        crate::checkpoint_codec::decode::<SpriteAnimationFrameSequence>(
            &crate::checkpoint_codec::encode(&raw).unwrap()
        )
        .is_err()
    );
}
#[derive(serde::Serialize)]
enum RawGeometry {
    Sprite(SpriteRenderCommand),
    Volume(crate::world::ground_shadow::GroundShadowHull),
}
#[derive(serde::Serialize)]
struct RawCaster {
    shape: GroundShadowShape,
    width: f32,
    height: f32,
    opacity: f32,
    layer: i32,
    cache: Option<([f32; 15], RawGeometry)>,
}
#[test]
fn ground_shadow_private_cache_bounds_and_real_cache_history_are_inspected() {
    use crate::world::ground_shadow::{GroundShadowHull, GroundShadowVolume, GroundSun};
    let mut w = coverage();
    let t = w.transforms[0].unwrap();
    let sprite = w.sprites[0].unwrap();
    w.ground_shadows[0]
        .as_mut()
        .unwrap()
        .geometry(t, sprite, GroundSun::default(), 1.);
    admitted(&copied(&w));
    w.ground_shadows[0] = Some(GroundShadowCaster::new(
        GroundShadowShape::Volume(GroundShadowVolume {
            depth: 2.,
            roof_height: 1.,
            offset_x: -1.,
            offset_y: 2.,
        }),
        4.,
        3.,
        0.5,
        0,
    ));
    w.ground_shadows[0]
        .as_mut()
        .unwrap()
        .volume_geometry(t, sprite, GroundSun::default(), 1.)
        .unwrap();
    admitted(&copied(&w));
    let hull = GroundShadowHull {
        foot: [0.; 2],
        points: [[0.; 2]; 10],
        len: 11,
    };
    let mut raw = RawCaster {
        shape: GroundShadowShape::Box,
        width: 2.,
        height: 3.,
        opacity: 0.5,
        layer: 0,
        cache: Some(([0.; 15], RawGeometry::Volume(hull))),
    };
    let mut w = coverage();
    w.ground_shadows[0] = Some(owner(&raw));
    rejected(&w);
    raw.cache = Some((
        [f32::NAN; 15],
        RawGeometry::Volume(GroundShadowHull { len: 0, ..hull }),
    ));
    let mut w = coverage();
    w.ground_shadows[0] = Some(owner(&raw));
    rejected(&w);
    let command = SpriteRenderCommand {
        x: 0.,
        y: 0.,
        width: 2.,
        height: 2.,
        u0: 0.,
        v0: 0.,
        u1: 1.,
        v1: 1.,
        r: 1.,
        g: 1.,
        b: 1.,
        a: 1.,
        texture_id: 0.,
        effect_flags: 0.,
        rotation_radians: f32::NAN,
    };
    raw.cache = Some(([0.; 15], RawGeometry::Sprite(command)));
    let mut w = coverage();
    w.ground_shadows[0] = Some(owner(&raw));
    rejected(&w);
}

#[test]
fn known_legacy_extreme_fps_runtime_nonprogress_is_kept_separate_from_payload_admission() {
    let mut w = coverage();
    let fps = f32::MAX;
    w.sprite_animations[0] = SpriteAnimation::horizontal(2, fps);
    admitted(&copied(&w));
    let elapsed = 1.0_f32 / 60.0;
    let frame_duration = 1.0 / fps;
    assert!(elapsed >= frame_duration);
    assert_eq!(
        (elapsed - frame_duration).to_bits(),
        elapsed.to_bits(),
        "the existing advance while would not make progress"
    );
    // Do not call advance/World::update with this admitted finite constructor
    // state. Root's sealed Candidate exposes no execution path; runtime repair
    // is a required separate task before external-file execution is published.
}
