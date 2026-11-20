use super::*;
use serde::Serialize;
fn limits() -> Limits {
    Limits {
        max_work: 10_000_000,
        max_scratch_bytes: 10_000_000,
    }
}
struct Saved<'a>(&'a Tilemap);
impl Serialize for Saved<'_> {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        checkpoint_state::State::serialize(self.0, s)
    }
}
#[derive(serde::Deserialize)]
struct Restored(#[serde(with = "checkpoint_state::State")] Tilemap);
fn encoded(t: &Tilemap) -> Vec<u8> {
    crate::checkpoint_codec::encode(&Saved(t)).unwrap()
}
fn check(t: &Tilemap) {
    let b = encoded(t);
    validate(t, limits()).unwrap();
    assert_eq!(encoded(t), b);
    let r = crate::checkpoint_codec::decode::<Restored>(&b).unwrap().0;
    validate(&r, limits()).unwrap();
    assert_eq!(encoded(&r), b);
}
fn fixture() -> Tilemap {
    let mut t = Tilemap::with_half_open_hd2d_surfaces();
    t.set_tile_definition(1, u32::MAX, 0.0, 0.0, 1.0, 1.0, -1.0, 3.0, 0.5, 1.0);
    t.set_tile_slope_definition(4, 1.0, 0.2, 0.0, 0.2);
    t.set_tile_one_way_platform(5);
    assert!(t.set_tile_height_span_definition(6, u32::MAX, -8.0, 0.0));
    assert!(t.set_tile_hd2d_definition(3, 4, false, true, false, 0.0, false, 0, 0.0, 0.0));
    assert!(t.set_tile_hd2d_definition(8, 2, true, true, true, 0.0, true, 1, -2.0, -2.0));
    assert!(t.set_tile_bridge_portal_definition(7, u32::MAX, 0, -8.0, -3.0, 0));
    let mut cells = vec![1; 18 * 3];
    for (i, id) in [0, 3, 4, 5, 6, 7, 8, 999].into_iter().enumerate() {
        cells[i] = id;
    }
    t.set_layer(0, 18, 3, 10.0, 7.0, -100.0, -0.0, true, cells);
    t.set_layer(
        3,
        2,
        1,
        f32::MIN_POSITIVE,
        f32::MAX,
        -5.0,
        4.0,
        false,
        vec![u32::MAX, 0],
    );
    assert!(t.set_navigation_cost(0, 0, 0, u32::MAX));
    t
}
#[test]
fn file_tilemap_all_definition_layer_cache_leaves_memory_codec_and_edit_history() {
    let mut t = fixture();
    check(&t);
    for i in 0..24 {
        let x = i % 18;
        let y = (i / 18) % 3;
        t.set_tile(0, x, y, [0, 1, 3, 4, 5, 6, 999][i as usize % 7]);
        check(&t);
    }
    t.clear_tile_slope_definition(4);
    t.clear_tile_one_way_platform(5);
    t.clear_tile_height_span_definition(6);
    t.clear_tile_hd2d_definition(3);
    t.clear_tile_bridge_portal_definition(7);
    check(&t);
    let before = t.physics_revision;
    t.clear();
    assert_ne!(t.physics_revision, before);
    check(&t);
}
#[test]
fn file_tilemap_exact_work_scratch_and_one_below_preserve_bytes() {
    let t = fixture();
    let before = encoded(&t);
    let used = validate(&t, limits()).unwrap();
    assert!(used.scratch_bytes > 0);
    assert_eq!(
        validate(
            &t,
            Limits {
                max_work: used.work,
                max_scratch_bytes: used.scratch_bytes
            }
        ),
        Ok(used)
    );
    assert_eq!(
        validate(
            &t,
            Limits {
                max_work: used.work - 1,
                max_scratch_bytes: used.scratch_bytes
            }
        ),
        Err(Error::WorkLimit)
    );
    assert_eq!(
        validate(
            &t,
            Limits {
                max_work: used.work,
                max_scratch_bytes: used.scratch_bytes - 1
            }
        ),
        Err(Error::ScratchLimit)
    );
    assert_eq!(encoded(&t), before);
}
#[test]
fn file_tilemap_typed_definition_and_grid_corruption_are_readonly() {
    let source = fixture();
    type Corruption = (Field, fn(&mut Tilemap));
    let cases: [Corruption; 9] = [
        (Field::Definitions, |t| t.definitions[0] = t.definitions[1]),
        (Field::Slopes, |t| {
            t.slope_definitions[4].as_mut().unwrap().local_x1 = 1.0
        }),
        (Field::OneWay, |t| t.one_way_platform_definitions[0] = true),
        (Field::Heights, |t| {
            t.height_span_definitions[6].as_mut().unwrap().height = -1.0
        }),
        (Field::Hd2d, |t| {
            t.hd2d_definitions[8].as_mut().unwrap().ramp = None
        }),
        (Field::Portals, |t| {
            t.bridge_portal_definitions[7]
                .as_mut()
                .unwrap()
                .navigation_cost = 0
        }),
        (Field::Layers, |t| t.layers[0].as_mut().unwrap().columns = 0),
        (Field::Layers, |t| {
            t.layers[0].as_mut().unwrap().origin_x = f32::NAN
        }),
        (Field::Layers, |t| {
            t.collision_rects.pop();
        }),
    ];
    for (field, corrupt) in cases {
        let mut t = source.clone();
        corrupt(&mut t);
        let before = encoded(&t);
        assert!(matches!(validate(&t,limits()),Err(Error::Invalid{field:f,..})if f==field));
        assert_eq!(encoded(&t), before);
        assert_eq!(
            validate(
                &t,
                Limits {
                    max_work: 0,
                    max_scratch_bytes: 0
                }
            ),
            Err(Error::WorkLimit)
        );
    }
}
#[test]
fn file_tilemap_collision_cache_shape_membership_coverage_and_history_corruption() {
    let source = fixture();
    let cases: [fn(&mut Tilemap); 6] = [
        |t| t.collision_rects[0].as_mut().unwrap()[0].columns = 0,
        |t| {
            t.collision_rects[0].as_mut().unwrap().remove(0);
        },
        |t| t.collision_rect_chunks[0].as_mut().unwrap().chunk_columns = 0,
        |t| {
            t.collision_rect_chunks[0].as_mut().unwrap().chunks[0].clear();
        },
        |t| {
            t.collision_rect_chunks[0]
                .as_mut()
                .unwrap()
                .last_rebuilt_chunks = u32::MAX
        },
        |t| {
            t.collision_rect_chunks[0]
                .as_mut()
                .unwrap()
                .total_rebuilt_chunks = 0
        },
    ];
    for corrupt in cases {
        let mut t = source.clone();
        corrupt(&mut t);
        let before = encoded(&t);
        assert!(validate(&t, limits()).is_err());
        assert_eq!(encoded(&t), before);
    }
}
#[test]
fn file_tilemap_split_or_nonmaximal_rectangles_reject_even_when_both_caches_cover_same_grid() {
    for horizontal in [true, false] {
        let mut t = Tilemap::default();
        t.set_layer(0, 2, 2, 1.0, 1.0, 0.0, 0.0, true, vec![1; 4]);
        let mut a = t.collision_rects[0].as_ref().unwrap()[0];
        let mut b = a;
        if horizontal {
            a.columns = 1;
            b.columns = 1;
            b.min_column = 1;
            b.tile_index = 1;
        } else {
            a.rows = 1;
            b.rows = 1;
            b.min_row = 1;
            b.tile_index = 2;
        }
        t.collision_rects[0] = Some(vec![a, b]);
        t.collision_rect_chunks[0].as_mut().unwrap().chunks[0] = vec![a, b];
        assert!(matches!(
            validate(&t, limits()),
            Err(Error::Invalid {
                field: Field::Rectangles,
                problem: Problem::Shape,
                ..
            })
        ));
    }
}
#[test]
fn file_tilemap_signed_degenerate_and_unregistered_ids_remain_raw() {
    let mut t = fixture();
    t.physics_revision = u64::MAX;
    let before = encoded(&t);
    check(&t);
    assert_eq!(encoded(&t), before);
    assert_eq!(t.definitions[1].unwrap().texture_id, u32::MAX);
    assert_eq!(t.height_span_definitions[6].unwrap().height, 0.0);
    assert_eq!(
        t.hd2d_definitions[8].unwrap().ramp.unwrap().start_elevation,
        -2.0
    );
    assert_eq!(t.bridge_portal_definitions[7].unwrap().navigation_cost, 1);
}

impl Tilemap {
    pub(crate) fn corrupt_file_fixture(&mut self, case: u32) {
        match case {
            0 => self.definitions[1].as_mut().unwrap().frame.u1 = 0.0,
            1 => self.slope_definitions[4].as_mut().unwrap().local_x1 = 1.0,
            2 => {
                self.collision_rect_chunks[0]
                    .as_mut()
                    .unwrap()
                    .chunk_columns = 0
            }
            _ => self.collision_rects[0].as_mut().unwrap()[0].columns = 0,
        }
    }
}
