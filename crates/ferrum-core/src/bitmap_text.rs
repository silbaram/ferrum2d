use std::collections::HashMap;

use crate::camera::Camera2D;
use crate::collision::AabbBounds;
use crate::components::Transform2D;
use crate::entity::Entity;
use crate::render_command::{
    SpriteRenderCommand, SpriteRenderItem, SpriteRenderSortKey, SPRITE_EFFECT_NONE,
};
use crate::world::World;

pub(crate) const BITMAP_FONT_GLYPH_METRIC_FLOATS: usize = 9;
pub(crate) const MAX_BITMAP_FONT_GLYPHS: usize = 4_096;
pub(crate) const MAX_BITMAP_FONT_KERNING_PAIRS: usize = 16_384;
pub(crate) const MAX_WORLD_TEXT_GLYPHS: usize = 4_096;
pub(crate) const MAX_WORLD_TEXT_ID: u32 = 0x0007_ffff;
const MAX_BITMAP_FONTS: usize = 256;
const MAX_WORLD_TEXTS: usize = 4_096;
const WORLD_TEXT_STABLE_ID_FLAG: u32 = 0x8000_0000;
const WORLD_TEXT_STABLE_ID_GLYPH_BITS: u32 = 12;

#[derive(Clone, Copy, Debug, PartialEq)]
struct BitmapGlyph {
    u0: f32,
    v0: f32,
    u1: f32,
    v1: f32,
    width: f32,
    height: f32,
    offset_x: f32,
    offset_y: f32,
    advance: f32,
}

#[derive(Debug)]
struct BitmapFont {
    texture_id: u32,
    line_height: f32,
    fallback: Option<char>,
    glyphs: HashMap<char, BitmapGlyph>,
    kernings: HashMap<(char, char), f32>,
}

impl BitmapFont {
    fn from_buffers(
        texture_id: u32,
        line_height: f32,
        fallback_code_point: u32,
        glyph_code_points: &[u32],
        glyph_metrics: &[f32],
        kerning_code_points: &[u32],
        kerning_amounts: &[f32],
    ) -> Option<Self> {
        if !line_height.is_finite()
            || line_height <= 0.0
            || glyph_code_points.is_empty()
            || glyph_code_points.len() > MAX_BITMAP_FONT_GLYPHS
            || glyph_metrics.len()
                != glyph_code_points
                    .len()
                    .checked_mul(BITMAP_FONT_GLYPH_METRIC_FLOATS)?
            || !kerning_code_points.len().is_multiple_of(2)
            || kerning_code_points.len() / 2 != kerning_amounts.len()
            || kerning_amounts.len() > MAX_BITMAP_FONT_KERNING_PAIRS
        {
            return None;
        }

        let mut glyphs = HashMap::with_capacity(glyph_code_points.len());
        for (&code_point, metrics) in glyph_code_points
            .iter()
            .zip(glyph_metrics.chunks_exact(BITMAP_FONT_GLYPH_METRIC_FLOATS))
        {
            let character = char::from_u32(code_point)?;
            let glyph = BitmapGlyph::from_metrics(metrics)?;
            if glyphs.insert(character, glyph).is_some() {
                return None;
            }
        }

        let fallback = if fallback_code_point == u32::MAX {
            None
        } else {
            let fallback = char::from_u32(fallback_code_point)?;
            Some(glyphs.contains_key(&fallback).then_some(fallback)?)
        };

        let mut kernings = HashMap::with_capacity(kerning_amounts.len());
        for (pair, &amount) in kerning_code_points
            .chunks_exact(2)
            .zip(kerning_amounts.iter())
        {
            let left = char::from_u32(pair[0])?;
            let right = char::from_u32(pair[1])?;
            if !amount.is_finite()
                || !glyphs.contains_key(&left)
                || !glyphs.contains_key(&right)
                || kernings.insert((left, right), amount).is_some()
            {
                return None;
            }
        }

        Some(Self {
            texture_id,
            line_height,
            fallback,
            glyphs,
            kernings,
        })
    }

    fn glyph(&self, character: char) -> Option<(char, BitmapGlyph)> {
        self.glyphs
            .get(&character)
            .copied()
            .map(|glyph| (character, glyph))
            .or_else(|| {
                let fallback = self.fallback?;
                self.glyphs
                    .get(&fallback)
                    .copied()
                    .map(|glyph| (fallback, glyph))
            })
    }

    fn kerning(&self, left: char, right: char) -> f32 {
        self.kernings.get(&(left, right)).copied().unwrap_or(0.0)
    }
}

impl BitmapGlyph {
    fn from_metrics(metrics: &[f32]) -> Option<Self> {
        let glyph = Self {
            u0: metrics[0],
            v0: metrics[1],
            u1: metrics[2],
            v1: metrics[3],
            width: metrics[4],
            height: metrics[5],
            offset_x: metrics[6],
            offset_y: metrics[7],
            advance: metrics[8],
        };
        let is_valid = metrics.iter().all(|value| value.is_finite())
            && (0.0..=1.0).contains(&glyph.u0)
            && (0.0..=1.0).contains(&glyph.v0)
            && (0.0..=1.0).contains(&glyph.u1)
            && (0.0..=1.0).contains(&glyph.v1)
            && glyph.width >= 0.0
            && glyph.height >= 0.0
            && glyph.advance >= 0.0
            && (glyph.width == 0.0 || glyph.u1 > glyph.u0)
            && (glyph.height == 0.0 || glyph.v1 > glyph.v0);
        is_valid.then_some(glyph)
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) enum WorldTextAlignment {
    #[default]
    Left,
    Center,
    Right,
}

impl WorldTextAlignment {
    pub(crate) fn from_code(code: u32) -> Option<Self> {
        match code {
            0 => Some(Self::Left),
            1 => Some(Self::Center),
            2 => Some(Self::Right),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum WorldTextAnchor {
    World,
    Entity(Entity),
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct WorldTextSpec {
    pub(crate) font_id: u32,
    pub(crate) text: String,
    pub(crate) x: f32,
    pub(crate) y: f32,
    pub(crate) scale: f32,
    pub(crate) color: [f32; 4],
    pub(crate) max_width: f32,
    pub(crate) alignment: WorldTextAlignment,
    pub(crate) render_layer: i32,
    pub(crate) floor_id: u32,
    pub(crate) elevation: f32,
    pub(crate) anchor: WorldTextAnchor,
}

impl WorldTextSpec {
    pub(crate) fn is_valid(&self) -> bool {
        self.text.chars().count() <= MAX_WORLD_TEXT_GLYPHS
            && self.x.is_finite()
            && self.y.is_finite()
            && self.scale.is_finite()
            && self.scale > 0.0
            && self.color.iter().all(|value| value.is_finite())
            && self.color.iter().all(|value| (0.0..=1.0).contains(value))
            && self.max_width.is_finite()
            && self.max_width >= 0.0
            && self.elevation.is_finite()
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct WorldTextUpdate {
    pub(crate) font_id: u32,
    pub(crate) x: f32,
    pub(crate) y: f32,
    pub(crate) scale: f32,
    pub(crate) color: [f32; 4],
    pub(crate) max_width: f32,
    pub(crate) alignment: WorldTextAlignment,
    pub(crate) render_layer: i32,
    pub(crate) floor_id: u32,
    pub(crate) elevation: f32,
    pub(crate) anchor: WorldTextAnchor,
}

impl WorldTextUpdate {
    fn is_valid(self) -> bool {
        self.x.is_finite()
            && self.y.is_finite()
            && self.scale.is_finite()
            && self.scale > 0.0
            && self.color.iter().all(|value| value.is_finite())
            && self.color.iter().all(|value| (0.0..=1.0).contains(value))
            && self.max_width.is_finite()
            && self.max_width >= 0.0
            && self.elevation.is_finite()
    }

    fn applies_to(self, text: String) -> WorldTextSpec {
        WorldTextSpec {
            font_id: self.font_id,
            text,
            x: self.x,
            y: self.y,
            scale: self.scale,
            color: self.color,
            max_width: self.max_width,
            alignment: self.alignment,
            render_layer: self.render_layer,
            floor_id: self.floor_id,
            elevation: self.elevation,
            anchor: self.anchor,
        }
    }
}

#[derive(Clone, Copy, Debug)]
struct PositionedGlyph {
    glyph: BitmapGlyph,
    pen_x: f32,
}

#[derive(Debug, Default)]
struct LayoutLine {
    glyphs: Vec<PositionedGlyph>,
    width: f32,
}

#[derive(Debug)]
struct WorldText {
    spec: WorldTextSpec,
    cached_commands: Vec<SpriteRenderCommand>,
    block_height: f32,
}

impl WorldText {
    fn new(spec: WorldTextSpec, font: &BitmapFont) -> Option<Self> {
        let (cached_commands, block_height) = Self::build_layout(&spec, font)?;
        Some(Self {
            spec,
            cached_commands,
            block_height,
        })
    }

    fn build_layout(
        spec: &WorldTextSpec,
        font: &BitmapFont,
    ) -> Option<(Vec<SpriteRenderCommand>, f32)> {
        if spec.text.is_empty() {
            return Some((Vec::new(), 0.0));
        }

        let scale = spec.scale;
        let scaled_line_height = finite_product(font.line_height, scale)?;
        let mut lines = vec![LayoutLine::default()];
        let mut previous = None;
        for character in spec.text.chars() {
            if character == '\r' {
                continue;
            }
            if character == '\n' {
                lines.push(LayoutLine::default());
                previous = None;
                continue;
            }
            let Some((resolved_character, glyph)) = font.glyph(character) else {
                previous = None;
                continue;
            };

            let line = lines
                .last_mut()
                .expect("layout always starts with one line");
            let (mut pen_x, mut next_width) = positioned_glyph_width(
                line.width,
                previous,
                resolved_character,
                glyph,
                font,
                scale,
            )?;
            if spec.max_width > 0.0 && !line.glyphs.is_empty() && next_width > spec.max_width {
                lines.push(LayoutLine::default());
                previous = None;
                (pen_x, next_width) =
                    positioned_glyph_width(0.0, previous, resolved_character, glyph, font, scale)?;
            }

            let line = lines
                .last_mut()
                .expect("layout always contains a current line");
            line.glyphs.push(PositionedGlyph { glyph, pen_x });
            line.width = next_width;
            previous = Some(resolved_character);
        }

        let block_height = finite_product(lines.len() as f32, scaled_line_height)?;
        let mut cached_commands = Vec::with_capacity(spec.text.chars().count());
        for (line_index, line) in lines.into_iter().enumerate() {
            let alignment_x = match spec.alignment {
                WorldTextAlignment::Left => 0.0,
                WorldTextAlignment::Center => finite_product(line.width, -0.5)?,
                WorldTextAlignment::Right => -line.width,
            };
            for positioned in line.glyphs {
                let glyph = positioned.glyph;
                if glyph.width == 0.0 || glyph.height == 0.0 {
                    continue;
                }
                cached_commands.push(SpriteRenderCommand {
                    x: finite_sum(
                        finite_sum(alignment_x, positioned.pen_x)?,
                        finite_product(glyph.offset_x, scale)?,
                    )?,
                    y: finite_sum(
                        finite_product(line_index as f32, scaled_line_height)?,
                        finite_product(glyph.offset_y, scale)?,
                    )?,
                    width: finite_product(glyph.width, scale)?,
                    height: finite_product(glyph.height, scale)?,
                    u0: glyph.u0,
                    v0: glyph.v0,
                    u1: glyph.u1,
                    v1: glyph.v1,
                    r: spec.color[0],
                    g: spec.color[1],
                    b: spec.color[2],
                    a: spec.color[3],
                    texture_id: font.texture_id as f32,
                    effect_flags: SPRITE_EFFECT_NONE,
                    rotation_radians: 0.0,
                });
            }
        }
        Some((cached_commands, block_height))
    }

    fn origin(&self, world: &World) -> Option<Transform2D> {
        let anchor = match self.spec.anchor {
            WorldTextAnchor::World => Transform2D::default(),
            WorldTextAnchor::Entity(entity) => world.transform(entity)?,
        };
        Some(Transform2D {
            x: anchor.x + self.spec.x,
            y: anchor.y + self.spec.y,
        })
    }
}

fn positioned_glyph_width(
    line_width: f32,
    previous: Option<char>,
    character: char,
    glyph: BitmapGlyph,
    font: &BitmapFont,
    scale: f32,
) -> Option<(f32, f32)> {
    let kerning = match previous {
        Some(left) => finite_product(font.kerning(left, character), scale)?,
        None => 0.0,
    };
    let pen_x = finite_sum(line_width, kerning)?;
    let next_width = finite_sum(pen_x, finite_product(glyph.advance, scale)?)?;
    Some((pen_x, next_width))
}

fn finite_product(left: f32, right: f32) -> Option<f32> {
    let value = left * right;
    value.is_finite().then_some(value)
}

fn finite_sum(left: f32, right: f32) -> Option<f32> {
    let value = left + right;
    value.is_finite().then_some(value)
}

#[derive(Debug, Default)]
pub(crate) struct BitmapTextSystem {
    fonts: HashMap<u32, BitmapFont>,
    // 변경은 저빈도이므로 id 정렬을 유지해 frame 순회와 alpha blending을 재현 가능하게 한다.
    texts: Vec<(u32, WorldText)>,
    layout_revision: u64,
}

impl BitmapTextSystem {
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn register_font(
        &mut self,
        font_id: u32,
        texture_id: u32,
        line_height: f32,
        fallback_code_point: u32,
        glyph_code_points: &[u32],
        glyph_metrics: &[f32],
        kerning_code_points: &[u32],
        kerning_amounts: &[f32],
    ) -> bool {
        if !self.fonts.contains_key(&font_id) && self.fonts.len() >= MAX_BITMAP_FONTS {
            return false;
        }
        let Some(font) = BitmapFont::from_buffers(
            texture_id,
            line_height,
            fallback_code_point,
            glyph_code_points,
            glyph_metrics,
            kerning_code_points,
            kerning_amounts,
        ) else {
            return false;
        };
        let mut rebuilt_texts = Vec::new();
        for (index, (_, text)) in self.texts.iter().enumerate() {
            if text.spec.font_id == font_id {
                let Some(rebuilt) = WorldText::new(text.spec.clone(), &font) else {
                    return false;
                };
                rebuilt_texts.push((index, rebuilt));
            }
        }
        let rebuilt = rebuilt_texts.len() as u64;
        self.fonts.insert(font_id, font);
        for (index, text) in rebuilt_texts {
            self.texts[index].1 = text;
        }
        self.layout_revision = self.layout_revision.saturating_add(rebuilt.max(1));
        true
    }

    pub(crate) fn remove_font(&mut self, font_id: u32) -> bool {
        if self.fonts.remove(&font_id).is_none() {
            return false;
        }
        for (_, text) in self
            .texts
            .iter_mut()
            .filter(|(_, text)| text.spec.font_id == font_id)
        {
            text.cached_commands.clear();
            text.block_height = 0.0;
        }
        self.layout_revision = self.layout_revision.saturating_add(1);
        true
    }

    pub(crate) fn clear_fonts(&mut self) {
        self.fonts.clear();
        for (_, text) in &mut self.texts {
            text.cached_commands.clear();
            text.block_height = 0.0;
        }
        self.layout_revision = self.layout_revision.saturating_add(1);
    }

    pub(crate) fn set_text(&mut self, text_id: u32, spec: WorldTextSpec) -> bool {
        if text_id > MAX_WORLD_TEXT_ID || !spec.is_valid() {
            return false;
        }
        let Some(font) = self.fonts.get(&spec.font_id) else {
            return false;
        };
        let index = self.texts.binary_search_by_key(&text_id, |(id, _)| *id);
        if index.is_err() && self.texts.len() >= MAX_WORLD_TEXTS {
            return false;
        }
        let Some(text) = WorldText::new(spec, font) else {
            return false;
        };
        match index {
            Ok(index) => self.texts[index].1 = text,
            Err(index) => self.texts.insert(index, (text_id, text)),
        }
        self.layout_revision = self.layout_revision.saturating_add(1);
        true
    }

    pub(crate) fn update_text(&mut self, text_id: u32, update: WorldTextUpdate) -> bool {
        if text_id > MAX_WORLD_TEXT_ID || !update.is_valid() {
            return false;
        }
        let Ok(index) = self.texts.binary_search_by_key(&text_id, |(id, _)| *id) else {
            return false;
        };
        let current = &self.texts[index].1;
        let rebuild_commands = current.spec.font_id != update.font_id
            || current.spec.scale != update.scale
            || current.spec.color != update.color
            || current.spec.max_width != update.max_width
            || current.spec.alignment != update.alignment;
        if rebuild_commands {
            let Some(font) = self.fonts.get(&update.font_id) else {
                return false;
            };
            let spec = update.applies_to(current.spec.text.clone());
            let Some(text) = WorldText::new(spec, font) else {
                return false;
            };
            self.texts[index].1 = text;
            self.layout_revision = self.layout_revision.saturating_add(1);
            return true;
        }

        let spec = &mut self.texts[index].1.spec;
        spec.x = update.x;
        spec.y = update.y;
        spec.render_layer = update.render_layer;
        spec.floor_id = update.floor_id;
        spec.elevation = update.elevation;
        spec.anchor = update.anchor;
        true
    }

    pub(crate) fn remove_text(&mut self, text_id: u32) -> bool {
        let removed = self
            .texts
            .binary_search_by_key(&text_id, |(id, _)| *id)
            .map(|index| self.texts.remove(index))
            .is_ok();
        if removed {
            self.layout_revision = self.layout_revision.saturating_add(1);
        }
        removed
    }

    pub(crate) fn clear_texts(&mut self) {
        if !self.texts.is_empty() {
            self.texts.clear();
            self.layout_revision = self.layout_revision.saturating_add(1);
        }
    }

    pub(crate) fn text_count(&self) -> usize {
        self.texts.len()
    }

    pub(crate) fn glyph_count(&self) -> usize {
        self.texts
            .iter()
            .map(|(_, text)| text.cached_commands.len())
            .sum()
    }

    pub(crate) fn has_hd2d_metadata(&self) -> bool {
        self.texts
            .iter()
            .any(|(_, text)| text.spec.floor_id != 0 || text.spec.elevation != 0.0)
    }

    pub(crate) fn append_render_items(
        &self,
        world: &World,
        camera: &Camera2D,
        _visible_bounds: AabbBounds,
        items: &mut Vec<SpriteRenderItem>,
    ) {
        for (text_id, text) in &self.texts {
            let Some(origin) = text.origin(world) else {
                continue;
            };
            // Glyphs stay upright: convert the block's uncompressed height to ground units.
            let foot_y = origin.y + text.block_height / camera.ground_y_scale;
            let anchor = camera.world_to_screen(origin);
            for (glyph_index, cached) in text.cached_commands.iter().enumerate() {
                let screen_top_left = Transform2D {
                    x: anchor.x + cached.x,
                    y: anchor.y + cached.y,
                };
                let Some(bounds) = AabbBounds::from_center(
                    Transform2D {
                        x: screen_top_left.x + cached.width * 0.5,
                        y: screen_top_left.y + cached.height * 0.5,
                    },
                    cached.width * 0.5,
                    cached.height * 0.5,
                ) else {
                    continue;
                };
                if !bounds.overlaps(AabbBounds {
                    min_x: 0.0,
                    min_y: 0.0,
                    max_x: camera.viewport_width,
                    max_y: camera.viewport_height,
                }) {
                    continue;
                }
                let mut command = *cached;
                command.x = screen_top_left.x;
                command.y = screen_top_left.y;
                items.push(SpriteRenderItem {
                    command,
                    sort_key: SpriteRenderSortKey {
                        floor_id: text.spec.floor_id,
                        elevation: text.spec.elevation,
                        foot_y,
                        render_layer: text.spec.render_layer,
                        sort_order: 0.0,
                        stable_id: world_text_stable_id(*text_id, glyph_index),
                    },
                });
            }
        }
    }

    #[cfg(test)]
    pub(crate) fn layout_revision(&self) -> u64 {
        self.layout_revision
    }
}

fn world_text_stable_id(text_id: u32, glyph_index: usize) -> u32 {
    WORLD_TEXT_STABLE_ID_FLAG | (text_id << WORLD_TEXT_STABLE_ID_GLYPH_BITS) | glyph_index as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn glyph_metrics_reject_non_finite_and_invalid_uv_values() {
        assert!(
            BitmapGlyph::from_metrics(&[0.0, 0.0, 1.0, 1.0, 8.0, 8.0, 0.0, 0.0, 8.0]).is_some()
        );
        assert!(
            BitmapGlyph::from_metrics(&[0.5, 0.0, 0.5, 1.0, 8.0, 8.0, 0.0, 0.0, 8.0]).is_none()
        );
        assert!(
            BitmapGlyph::from_metrics(&[0.0, 0.0, 1.0, 1.0, f32::NAN, 8.0, 0.0, 0.0, 8.0])
                .is_none()
        );
    }

    #[test]
    fn layout_applies_kerning_center_alignment_wrapping_and_color() {
        let font = test_font();
        let text = WorldText::new(
            WorldTextSpec {
                font_id: 0,
                text: "AVA".to_owned(),
                x: 0.0,
                y: 0.0,
                scale: 2.0,
                color: [0.25, 0.5, 0.75, 1.0],
                max_width: 40.0,
                alignment: WorldTextAlignment::Center,
                render_layer: 0,
                floor_id: 0,
                elevation: 0.0,
                anchor: WorldTextAnchor::World,
            },
            &font,
        )
        .expect("finite layout should be accepted");

        assert_eq!(text.cached_commands.len(), 3);
        assert_eq!(text.block_height, 40.0);
        assert_eq!(text.cached_commands[0].x, -18.0);
        assert_eq!(text.cached_commands[1].x, -2.0);
        assert_eq!(text.cached_commands[2].x, -10.0);
        assert_eq!(text.cached_commands[2].y, 20.0);
        assert_eq!(text.cached_commands[0].r, 0.25);
        assert_eq!(text.cached_commands[0].width, 16.0);
    }

    #[test]
    fn layout_supports_right_alignment() {
        let text = WorldText::new(
            WorldTextSpec {
                font_id: 0,
                text: "AV".to_owned(),
                x: 0.0,
                y: 0.0,
                scale: 1.0,
                color: [1.0; 4],
                max_width: 0.0,
                alignment: WorldTextAlignment::Right,
                render_layer: 0,
                floor_id: 0,
                elevation: 0.0,
                anchor: WorldTextAnchor::World,
            },
            &test_font(),
        )
        .expect("finite layout should be accepted");

        assert_eq!(text.cached_commands.len(), 2);
        assert_eq!(text.cached_commands[0].x, -18.0);
        assert_eq!(text.cached_commands[1].x, -10.0);
    }

    #[test]
    fn system_rejects_non_finite_derived_layouts_without_replacing_cached_text() {
        let mut system = BitmapTextSystem::default();
        assert!(system.register_font(
            1,
            7,
            10.0,
            u32::MAX,
            &['A' as u32],
            &[0.0, 0.0, 1.0, 1.0, 8.0, 8.0, 0.0, 0.0, 10.0],
            &[],
            &[],
        ));
        let spec = WorldTextSpec {
            font_id: 1,
            text: "A".to_owned(),
            x: 0.0,
            y: 0.0,
            scale: 2.0,
            color: [1.0; 4],
            max_width: 0.0,
            alignment: WorldTextAlignment::Left,
            render_layer: 0,
            floor_id: 0,
            elevation: 0.0,
            anchor: WorldTextAnchor::World,
        };
        assert!(system.set_text(1, spec.clone()));
        let revision = system.layout_revision();

        let mut overflowing = spec;
        overflowing.scale = f32::MAX;
        assert!(!system.set_text(1, overflowing));
        assert_eq!(system.glyph_count(), 1);
        assert_eq!(system.layout_revision(), revision);

        assert!(!system.register_font(
            1,
            8,
            f32::MAX,
            u32::MAX,
            &['A' as u32],
            &[0.0, 0.0, 1.0, 1.0, 8.0, 8.0, 0.0, 0.0, 10.0],
            &[],
            &[],
        ));
        assert_eq!(system.glyph_count(), 1);
        assert_eq!(system.layout_revision(), revision);
        assert_eq!(system.fonts[&1].texture_id, 7);
    }

    #[test]
    fn numeric_updates_only_rebuild_cached_commands_for_layout_or_color_changes() {
        let mut system = BitmapTextSystem::default();
        assert!(system.register_font(
            1,
            7,
            10.0,
            u32::MAX,
            &['A' as u32],
            &[0.0, 0.0, 1.0, 1.0, 8.0, 8.0, 0.0, 0.0, 10.0],
            &[],
            &[],
        ));
        assert!(system.set_text(
            1,
            WorldTextSpec {
                font_id: 1,
                text: "A".to_owned(),
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
            },
        ));
        let revision = system.layout_revision();
        let position_update = WorldTextUpdate {
            font_id: 1,
            x: 5.0,
            y: 6.0,
            scale: 1.0,
            color: [1.0; 4],
            max_width: 0.0,
            alignment: WorldTextAlignment::Left,
            render_layer: 2,
            floor_id: 3,
            elevation: 4.0,
            anchor: WorldTextAnchor::World,
        };

        assert!(system.update_text(1, position_update));
        assert_eq!(system.layout_revision(), revision);
        assert_eq!(system.texts[0].1.spec.x, 5.0);
        assert_eq!(system.texts[0].1.cached_commands[0].x, 0.0);

        assert!(system.update_text(
            1,
            WorldTextUpdate {
                color: [0.5, 1.0, 1.0, 1.0],
                ..position_update
            },
        ));
        assert_eq!(system.layout_revision(), revision + 1);
        assert_eq!(system.texts[0].1.cached_commands[0].r, 0.5);
        assert_eq!(system.texts[0].1.spec.x, 5.0);
    }

    fn test_font() -> BitmapFont {
        BitmapFont::from_buffers(
            7,
            10.0,
            u32::MAX,
            &['A' as u32, 'V' as u32],
            &[
                0.0, 0.0, 0.5, 1.0, 8.0, 8.0, 0.0, 0.0, 10.0, 0.5, 0.0, 1.0, 1.0, 8.0, 8.0, 0.0,
                0.0, 10.0,
            ],
            &['A' as u32, 'V' as u32],
            &[-2.0],
        )
        .expect("test font should be valid")
    }
}
