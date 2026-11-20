use super::*;
impl SpatialScene {
    /// Typed owner-only corruptions. The caller only validates/serializes these
    /// candidates, never renders, queries, updates or installs them.
    pub(crate) fn corrupt_file_fixture(&mut self, case: u32) {
        match case {
            0 => self.camera.as_mut().unwrap().matrix[0] = f32::NAN,
            1 => self.camera.as_mut().unwrap().frustum[0][0] += 1.,
            2 => self.frame_camera[0] += 1.,
            3 => self.presentation[5] = f32::NAN,
            4 => self.surfaces[0].bounds[2] = -1.,
            5 => self.terrain[0].position[0] = f32::INFINITY,
            6 => self.terrain[0].uv[0] = 0.25,
            7 => self.terrain_materials[0].flags = 4,
            8 => self.terrain_receiver_masks = vec![SpatialReceiverMasks::default()],
            9 => self.shadow_draw_ranges[0].face = 13,
            10 => self.shadow_quad_scratch.push(self.terrain[0]),
            11 => self.runtime_sprite_rotations.push((
                Entity {
                    id: u32::MAX,
                    generation: 0,
                },
                0.,
            )),
            12..=15 => self.models.corrupt_file_fixture(case - 12),
            16..=18 => self.models.streaming.corrupt_file_fixture(case - 16),
            19..=21 => self.attachments.corrupt_file_fixture(case - 19),
            22..=29 => self.environment.corrupt_file_fixture(case - 22),
            30..=32 => self.debug.corrupt_file_fixture(case - 30),
            33..=34 => self.navigation.corrupt_file_fixture(case - 33),
            35 => self.attachments.corrupt_file_fixture(3),
            _ => panic!("unknown owner fixture"),
        }
    }
}
