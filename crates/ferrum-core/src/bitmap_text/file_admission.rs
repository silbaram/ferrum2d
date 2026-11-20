use super::*;
use crate::engine::file_presentation_admission::{
    entity_history, invalid, Budget, Error, Owner, Problem,
};
impl BitmapTextSystem {
    pub(crate) fn validate_file(&self, world: &World, budget: &mut Budget) -> Result<(), Error> {
        budget.work(self.fonts.capacity())?;
        budget.work(self.texts.capacity())?;
        budget.work(1)?;
        if self.fonts.len() > MAX_BITMAP_FONTS || self.texts.len() > MAX_WORLD_TEXTS {
            return Err(invalid(Owner::Fonts, 0, Problem::Count));
        }
        for (index, font) in self.fonts.values().enumerate() {
            budget.work(font.glyphs.capacity())?;
            budget.work(font.kernings.capacity())?;
            if font.glyphs.is_empty()
                || font.glyphs.len() > MAX_BITMAP_FONT_GLYPHS
                || font.kernings.len() > MAX_BITMAP_FONT_KERNING_PAIRS
            {
                return Err(invalid(Owner::Fonts, index, Problem::Count));
            }
            if !font.line_height.is_finite() || font.line_height <= 0.0 {
                return Err(invalid(Owner::Fonts, index, Problem::Number));
            }
            budget.sort_work(font.glyphs.len())?;
            let mut keys = budget.scratch::<char>(font.glyphs.len())?;
            for (&character, g) in &font.glyphs {
                if BitmapGlyph::from_metrics(&[
                    g.u0, g.v0, g.u1, g.v1, g.width, g.height, g.offset_x, g.offset_y, g.advance,
                ])
                .is_none()
                {
                    return Err(invalid(Owner::Fonts, index, Problem::Frame));
                }
                keys.push(character);
            }
            keys.sort_unstable();
            if font
                .fallback
                .is_some_and(|c| keys.binary_search(&c).is_err())
            {
                return Err(invalid(Owner::Fonts, index, Problem::Reference));
            }
            let search_levels = (usize::BITS - keys.len().leading_zeros()) as usize;
            budget.work(
                font.kernings
                    .len()
                    .checked_mul(search_levels * 2 + 1)
                    .ok_or(Error::WorkLimit)?,
            )?;
            for (&(left, right), amount) in &font.kernings {
                if !amount.is_finite()
                    || keys.binary_search(&left).is_err()
                    || keys.binary_search(&right).is_err()
                {
                    return Err(invalid(Owner::Fonts, index, Problem::Reference));
                }
            }
        }
        let mut previous = None;
        for (index, (id, text)) in self.texts.iter().enumerate() {
            if *id > MAX_WORLD_TEXT_ID || previous.is_some_and(|p| p >= *id) {
                return Err(invalid(Owner::Texts, index, Problem::Order));
            }
            previous = Some(*id);
            budget.work(text.spec.text.len())?;
            budget.work(text.cached_commands.capacity())?;
            // Bound UTF-8 bytes BEFORE chars().count()/is_valid() could scan it.
            if text.spec.text.len() > MAX_WORLD_TEXT_GLYPHS * 4
                || text.cached_commands.len() > MAX_WORLD_TEXT_GLYPHS
            {
                return Err(invalid(Owner::Texts, index, Problem::Count));
            }
            let characters = text.spec.text.chars().count();
            if characters > MAX_WORLD_TEXT_GLYPHS || text.cached_commands.len() > characters {
                return Err(invalid(Owner::Texts, index, Problem::Count));
            }
            let s = &text.spec;
            if !s.x.is_finite()
                || !s.y.is_finite()
                || !s.scale.is_finite()
                || s.scale <= 0.0
                || s.color
                    .iter()
                    .any(|c| !c.is_finite() || !(0.0..=1.0).contains(c))
                || !s.max_width.is_finite()
                || s.max_width < 0.0
                || !s.elevation.is_finite()
                || !text.block_height.is_finite()
                || text.block_height < 0.0
            {
                return Err(invalid(Owner::Texts, index, Problem::Number));
            }
            if let WorldTextAnchor::Entity(entity) = s.anchor {
                if !entity_history(world, entity) {
                    return Err(invalid(Owner::Texts, index, Problem::Reference));
                }
            }
            // HashMap lookup has capacity-derived work reserved before access.
            budget.work(self.fonts.capacity())?;
            let font = self.fonts.get(&s.font_id);
            if font.is_none() && (!text.cached_commands.is_empty() || text.block_height != 0.0) {
                return Err(invalid(Owner::Texts, index, Problem::Font));
            }
            if s.text.is_empty() && (!text.cached_commands.is_empty() || text.block_height != 0.0) {
                return Err(invalid(Owner::Texts, index, Problem::Cache));
            }
            for c in &text.cached_commands {
                let values = [
                    c.x,
                    c.y,
                    c.width,
                    c.height,
                    c.u0,
                    c.v0,
                    c.u1,
                    c.v1,
                    c.r,
                    c.g,
                    c.b,
                    c.a,
                    c.texture_id,
                    c.effect_flags,
                    c.rotation_radians,
                ];
                if values.iter().any(|n| !n.is_finite())
                    || c.width < 0.0
                    || c.height < 0.0
                    || crate::components::SpriteFrame::from_values(c.u0, c.v0, c.u1, c.v1).is_none()
                    || c.effect_flags != SPRITE_EFFECT_NONE
                    || c.rotation_radians != 0.0
                    || [c.r, c.g, c.b, c.a] != s.color
                    || font.is_none_or(|f| c.texture_id != f.texture_id as f32)
                {
                    return Err(invalid(Owner::Texts, index, Problem::Cache));
                }
            }
            // Cache positions and block height remain saved output; do NOT run
            // layout/render to replace or normalize them against a fresh count.
        }
        Ok(())
    }
    #[cfg(test)]
    pub(crate) fn corrupt_file_fixture(&mut self) {
        self.fonts.values_mut().next().unwrap().fallback = Some('\u{10ffff}');
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::file_presentation_admission::Limits;
    fn budget() -> Budget {
        Budget::new(Limits {
            max_work: 1_000_000,
            max_scratch_bytes: 100_000,
        })
    }
    fn fixture() -> BitmapTextSystem {
        let mut s = BitmapTextSystem::default();
        assert!(s.register_font(
            1,
            2,
            8.0,
            u32::MAX,
            &[65],
            &[0.0, 0.0, 1.0, 1.0, 3.0, 4.0, 0.0, 0.0, 3.0],
            &[],
            &[]
        ));
        let spec = WorldTextSpec {
            font_id: 1,
            text: "A".into(),
            x: 0.0,
            y: 0.0,
            scale: 1.0,
            color: [1.0; 4],
            max_width: 0.0,
            alignment: WorldTextAlignment::Left,
            render_layer: 0,
            floor_id: 0,
            elevation: 0.0,
            anchor: WorldTextAnchor::World,
        };
        assert!(s.set_text(0, spec.clone()));
        assert!(s.set_text(1, spec));
        s
    }
    #[test]
    fn file_presentation_font_private_glyph_fallback_and_kerning_corruption() {
        let world = World::default();
        let source = fixture();
        for case in 0..3 {
            let mut s = source.clone();
            let f = s.fonts.get_mut(&1).unwrap();
            match case {
                0 => f.fallback = Some('Z'),
                1 => {
                    f.kernings.insert(('A', 'Z'), 0.0);
                }
                _ => f.glyphs.get_mut(&'A').unwrap().advance = f32::INFINITY,
            }
            assert!(matches!(
                s.validate_file(&world, &mut budget()),
                Err(Error::Invalid {
                    owner: Owner::Fonts,
                    ..
                })
            ));
        }
    }
    #[test]
    fn file_presentation_text_private_order_font_cache_and_generation_corruption() {
        let world = World::default();
        let source = fixture();
        let cases: [fn(&mut BitmapTextSystem); 6] = [
            |s| s.texts[1].0 = 0,
            |s| {
                s.texts[0].1.spec.anchor = WorldTextAnchor::Entity(Entity {
                    id: u32::MAX,
                    generation: 0,
                })
            },
            |s| s.texts[0].1.cached_commands[0].width = f32::NAN,
            |s| s.texts[0].1.block_height = f32::INFINITY,
            |s| {
                s.fonts.clear();
            },
            |s| s.texts[0].1.spec.max_width = -1.0,
        ];
        for corrupt in cases {
            let mut s = source.clone();
            corrupt(&mut s);
            let before = crate::checkpoint_codec::encode(&s).unwrap();
            assert!(matches!(
                s.validate_file(&world, &mut budget()),
                Err(Error::Invalid {
                    owner: Owner::Texts,
                    ..
                })
            ));
            assert_eq!(crate::checkpoint_codec::encode(&s).unwrap(), before);
        }
    }
    #[test]
    fn file_presentation_text_bytes_are_admitted_before_character_traversal() {
        let world = World::default();
        let mut s = fixture();
        s.texts[0].1.spec.text = "x".repeat(MAX_WORLD_TEXT_GLYPHS * 4 + 1);
        assert_eq!(
            s.validate_file(
                &world,
                &mut Budget::new(Limits {
                    max_work: 0,
                    max_scratch_bytes: 0
                })
            ),
            Err(Error::WorkLimit)
        );
        assert_eq!(
            s.validate_file(&world, &mut budget()),
            Err(invalid(Owner::Texts, 0, Problem::Count))
        );
    }
}
