use super::PathScratch;

impl PathScratch {
    // Private actual-codec damage stays in the ADT owner rather than exposing
    // mutable backing arrays to a production admission caller.
    pub(in crate::physics3d) fn damage_character_payload_for_test(&mut self, case: usize) {
        assert_eq!(self.preview.len(), 2);
        assert_eq!(self.characters.len(), 2);
        match case {
            0 => self.preview[0].input.velocity[0] = f32::NAN,
            1 => self.preview[0].input.jump_speed = f32::NAN,
            2 => self.preview[0].state.translation[0] = f32::NAN,
            3 => self.preview[0].state.ground.as_mut().unwrap().sensor = true,
            4 => self.preview[0].external_velocity[0] = f32::NAN,
            5 => self.preview[0].pending_impulse[0] = f32::NAN,
            6 => self.preview[0].contact_velocity[0] = f32::NAN,
            7 => self.preview[0].id.slot = u32::MAX,
            8 => {
                self.preview.pop();
            }
            9 => self.characters[0].1.translation[0] = f32::NAN,
            10 => self.characters[0].1.carry_translation[0] = f32::NAN,
            11 => self.characters[0].1.velocity[0] = 0.1,
            12 => self.characters[0].1.vertical_speed = 0.1,
            13 => self.characters[0].1.sliding = true,
            14 => {
                self.preview[1].id = self.preview[0].id;
                self.characters[1].0 = self.characters[0].0;
            }
            15 => self.characters.swap(0, 1),
            16 => {
                self.preview[0].state.failed_moving_obstacle_contacts =
                    self.preview[0].state.moving_obstacle_contact_checks + 1
            }
            17 => self.preview[0].input.jump_speed = 10001.,
            18 => {
                self.characters[0].1.failed_pair_casts =
                    self.characters[0].1.character_pair_casts + 1
            }
            19 => self.characters[0].1.grounded = true,
            _ => unreachable!(),
        }
    }
}

#[test]
fn precise_path_scratch_codec_keeps_sub_f32_cuts_stops_and_stale_history_readonly() {
    use crate::physics3d::BodyId;
    let next = 0.5_f64.next_up();
    let scratch = PathScratch {
        cuts: vec![0.5, next, 1.],
        ids: vec![BodyId {
            slot: 912,
            generation: 84,
        }],
        stopped: vec![Some(next)],
        ..Default::default()
    };
    assert!(PathScratch::default().saved_time_payload_valid());
    assert_eq!(scratch.saved_time_payload_counts(), (3, 1, 1));
    let bytes = crate::checkpoint_codec::encode(&scratch).unwrap();
    let restored: PathScratch = crate::checkpoint_codec::decode(&bytes).unwrap();
    assert!(restored.saved_time_payload_valid());
    assert_eq!(restored.cuts[1].to_bits(), next.to_bits());
    assert_eq!(restored.stopped[0].unwrap().to_bits(), next.to_bits());
    assert_eq!(restored.cuts[0] as f32, restored.cuts[1] as f32);
    assert_eq!(crate::checkpoint_codec::encode(&restored).unwrap(), bytes);
}

#[test]
fn precise_path_scratch_valid_codec_corruption_is_rejected_without_repair() {
    use crate::physics3d::BodyId;
    for case in 0..10 {
        let mut scratch = PathScratch {
            cuts: vec![0.5, 1.],
            ids: vec![BodyId {
                slot: 12,
                generation: 9,
            }],
            stopped: vec![Some(0.5)],
            ..Default::default()
        };
        match case {
            0 => scratch.cuts[0] = f64::NAN,
            1 => scratch.cuts[0] = f64::INFINITY,
            2 => scratch.cuts.swap(0, 1),
            3 => scratch.cuts[0] = 0.,
            4 => scratch.cuts[1] = 0.9,
            5 => scratch.cuts.clear(),
            6 => scratch.stopped[0] = Some(f64::NAN),
            7 => scratch.stopped[0] = Some(1_f64.next_up()),
            8 => scratch.stopped.clear(),
            9 => {
                scratch.ids.push(scratch.ids[0]);
                scratch.stopped.push(None);
            }
            _ => unreachable!(),
        }
        let before = crate::checkpoint_codec::encode(&scratch).unwrap();
        let restored: PathScratch = crate::checkpoint_codec::decode(&before).unwrap();
        assert!(!restored.saved_time_payload_valid(), "case={case}");
        assert_eq!(crate::checkpoint_codec::encode(&restored).unwrap(), before);
    }
}
