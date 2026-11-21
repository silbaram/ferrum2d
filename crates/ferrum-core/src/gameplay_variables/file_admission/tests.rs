use super::*;
use crate::gameplay_variables::{GameplayVariable, MAX_SAFE_INTEGER};
use crate::world::World;

#[derive(serde::Serialize)]
struct Capture<'a> {
    #[serde(with = "crate::world::persistence::State")]
    world: &'a World,
}

#[derive(serde::Deserialize)]
struct Restore {
    #[serde(with = "crate::world::persistence::State")]
    world: World,
}

fn bytes(world: &World) -> Vec<u8> {
    crate::checkpoint_codec::encode(&Capture { world }).unwrap()
}

fn restored(input: &[u8]) -> World {
    crate::checkpoint_codec::decode::<Restore>(input)
        .unwrap()
        .world
}

fn sparse() -> World {
    let mut world = World::default();
    // Configure in non-slot order. Include unrelated private entity storage.
    world.spawn_entity();
    assert!(world.configure_gameplay_variable(
        7,
        GameplayVariableType::Integer,
        GameplayVariableScope::Global,
        -MAX_SAFE_INTEGER,
        MAX_SAFE_INTEGER,
    ));
    assert!(world.configure_gameplay_variable(
        2,
        GameplayVariableType::Real,
        GameplayVariableScope::Scene,
        -0.0,
        f64::MAX,
    ));
    assert!(world.configure_gameplay_variable(
        64,
        GameplayVariableType::Bool,
        GameplayVariableScope::Scene,
        1.0,
        0.0,
    ));
    world
}

fn check(world: &World) -> Layout {
    let before = bytes(world);
    let layout = world.gameplay_variable_slab().admit_file_layout().unwrap();
    assert_eq!(bytes(world), before);
    let candidate = restored(&before);
    assert_eq!(
        candidate
            .gameplay_variable_slab()
            .admit_file_layout()
            .unwrap(),
        layout
    );
    assert_eq!(bytes(&candidate), before);
    layout
}

#[test]
fn file_variable_layout_sparse_candidate_preserves_values_and_whole_world_bytes() {
    let mut world = sparse();
    let mut candidate = restored(&bytes(&world));
    let layout = check(&world);
    let configured: Vec<_> = layout.into_iter().flatten().collect();
    assert_eq!(
        configured
            .iter()
            .map(|entry| entry.slot)
            .collect::<Vec<_>>(),
        [2, 7, 64]
    );
    assert_eq!(
        configured[0],
        LayoutEntry {
            slot: 2,
            variable_type: GameplayVariableType::Real,
            scope: GameplayVariableScope::Scene,
            default_value: 0.0,
        }
    );
    assert_eq!(configured[1].default_value, -MAX_SAFE_INTEGER);
    assert_eq!(configured[2].default_value, 1.0);
    assert_eq!(world.gameplay_variable_value(2), Some(f64::MAX));
    assert_eq!(world.gameplay_variable_value(7), Some(MAX_SAFE_INTEGER));
    assert_eq!(world.gameplay_variable_value(64), Some(0.0));
    // Extraction is observational: subsequent actual set/increment/reset paths
    // have the same values and complete private encoding as the decoded control.
    for world in [&mut world, &mut candidate] {
        assert!(world.set_gameplay_variable_value(2, f64::from_bits(1)));
        assert!(world.increment_gameplay_variable_value(7, -1.0));
        assert!(world.set_gameplay_variable_value(64, 1.0));
    }
    assert_eq!(bytes(&world), bytes(&candidate));
    check(&world);
    world.reset_preserving_gameplay_variables();
    candidate.reset_preserving_gameplay_variables();
    assert_eq!(bytes(&world), bytes(&candidate));
    assert_eq!(world.gameplay_variable_value(2), Some(0.0));
    assert_eq!(
        world.gameplay_variable_value(7),
        Some(MAX_SAFE_INTEGER - 1.0)
    );
    assert_eq!(world.gameplay_variable_value(64), Some(1.0));
    check(&world);
}

#[test]
fn file_variable_layout_empty_and_full_64_slots_include_all_typed_boundaries() {
    assert_eq!(check(&World::default()), [None; MAX_GAMEPLAY_VARIABLES]);
    let mut world = World::default();
    for slot in 1..=MAX_GAMEPLAY_VARIABLES as u32 {
        let (variable_type, default, value) = match slot % 3 {
            0 => (
                GameplayVariableType::Integer,
                MAX_SAFE_INTEGER,
                -MAX_SAFE_INTEGER,
            ),
            1 => (GameplayVariableType::Real, -f64::MAX, f64::from_bits(1)),
            _ => (GameplayVariableType::Bool, 0.0, 1.0),
        };
        let scope = if slot % 2 == 0 {
            GameplayVariableScope::Scene
        } else {
            GameplayVariableScope::Global
        };
        assert!(world.configure_gameplay_variable(slot, variable_type, scope, default, value));
    }
    let layout = check(&world);
    assert_eq!(layout.iter().flatten().count(), MAX_GAMEPLAY_VARIABLES);
    for (index, entry) in layout.into_iter().enumerate() {
        assert_eq!(entry.unwrap().slot, (index + 1) as u32);
    }
    let before = bytes(&world);
    assert!(!world.configure_gameplay_variable(
        0,
        GameplayVariableType::Real,
        GameplayVariableScope::Global,
        0.0,
        0.0
    ));
    assert!(!world.configure_gameplay_variable(
        65,
        GameplayVariableType::Real,
        GameplayVariableScope::Global,
        0.0,
        0.0
    ));
    assert_eq!(bytes(&world), before);
    world.clear_gameplay_variables();
    assert_eq!(check(&world), [None; MAX_GAMEPLAY_VARIABLES]);
}

#[test]
fn file_variable_layout_actual_producers_store_positive_zero_for_every_type() {
    for variable_type in [
        GameplayVariableType::Integer,
        GameplayVariableType::Real,
        GameplayVariableType::Bool,
    ] {
        let mut slab = GameplayVariableSlab::default();
        assert!(slab.configure(1, variable_type, GameplayVariableScope::Scene, -0.0, -0.0));
        let assert_zero = |slab: &GameplayVariableSlab| {
            let entry = slab.slots[0].unwrap();
            assert_eq!(entry.default_value.to_bits(), 0.0f64.to_bits());
            assert_eq!(entry.value.to_bits(), 0.0f64.to_bits());
            assert_eq!(
                slab.admit_file_layout().unwrap()[0]
                    .unwrap()
                    .default_value
                    .to_bits(),
                0.0f64.to_bits()
            );
        };
        assert_zero(&slab);
        assert!(slab.set(1, -0.0));
        assert_zero(&slab);
        if variable_type != GameplayVariableType::Bool {
            assert!(slab.increment(1, -0.0));
            assert_zero(&slab);
        }
        assert!(slab.set(1, 1.0));
        slab.reset_scene_values();
        assert_zero(&slab);
    }
}

#[test]
fn file_variable_layout_private_codec_rejects_malformed_scalars_without_repair_or_commit() {
    let live = sparse();
    let live_before = bytes(&live);
    let mut count = 0;
    for variable_type in [
        GameplayVariableType::Integer,
        GameplayVariableType::Real,
        GameplayVariableType::Bool,
    ] {
        let mut invalid = vec![
            (f64::NAN, InvalidValue::NonFinite),
            (
                f64::from_bits(0xfff8_0000_0000_0017),
                InvalidValue::NonFinite,
            ),
            (f64::INFINITY, InvalidValue::NonFinite),
            (f64::NEG_INFINITY, InvalidValue::NonFinite),
            (-0.0, InvalidValue::NonCanonicalZero),
        ];
        match variable_type {
            GameplayVariableType::Integer => invalid.extend([
                (0.5, InvalidValue::NonInteger),
                (-0.5, InvalidValue::NonInteger),
                (MAX_SAFE_INTEGER + 1.0, InvalidValue::UnsafeInteger),
                (-MAX_SAFE_INTEGER - 1.0, InvalidValue::UnsafeInteger),
                (f64::MAX, InvalidValue::UnsafeInteger),
            ]),
            GameplayVariableType::Bool => invalid.extend([
                (-1.0, InvalidValue::InvalidBool),
                (2.0, InvalidValue::InvalidBool),
                (0.5, InvalidValue::InvalidBool),
                (f64::EPSILON, InvalidValue::InvalidBool),
            ]),
            GameplayVariableType::Real => {}
        }
        for (value, reason) in invalid {
            for field in [Field::Default, Field::Current] {
                let mut candidate = restored(&live_before);
                let mut slab = candidate.gameplay_variable_slab().clone();
                let mut entry = GameplayVariable {
                    variable_type,
                    scope: GameplayVariableScope::Scene,
                    default_value: 1.0,
                    value: 1.0,
                };
                match field {
                    Field::Default => entry.default_value = value,
                    Field::Current => entry.value = value,
                }
                slab.slots[6] = Some(entry);
                candidate.replace_gameplay_variable_slab(slab);
                let malformed_bytes = bytes(&candidate);
                // Actual private envelope, CRC and bounded decoder: the numeric
                // cold guard, rather than a synthetic parser, rejects the state.
                let decoded = restored(&malformed_bytes);
                let expected = Err(Error {
                    slot: 7,
                    field,
                    reason,
                });
                assert_eq!(
                    candidate.gameplay_variable_slab().admit_file_layout(),
                    expected
                );
                assert_eq!(
                    decoded.gameplay_variable_slab().admit_file_layout(),
                    expected
                );
                assert_eq!(bytes(&candidate), malformed_bytes);
                assert_eq!(bytes(&decoded), malformed_bytes);
                assert_eq!(bytes(&live), live_before);
                // Never reset, run gameplay against, or publish malformed state.
                count += 1;
            }
        }
    }
    assert_eq!(count, 48);
}
