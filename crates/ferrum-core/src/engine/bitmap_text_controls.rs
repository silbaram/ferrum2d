use wasm_bindgen::prelude::*;

use crate::bitmap_text::{
    WorldTextAlignment, WorldTextAnchor, WorldTextSpec, WorldTextUpdate, MAX_WORLD_TEXT_ID,
};
use crate::entity::Entity;

use super::Engine;

const WORLD_TEXT_NO_ENTITY: u32 = u32::MAX;

#[wasm_bindgen]
impl Engine {
    /// 비트맵 폰트 atlas를 저빈도 bulk buffer 경로로 등록합니다.
    #[allow(clippy::too_many_arguments)]
    pub fn register_bitmap_font(
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
        self.bitmap_text.register_font(
            font_id,
            texture_id,
            line_height,
            fallback_code_point,
            glyph_code_points,
            glyph_metrics,
            kerning_code_points,
            kerning_amounts,
        )
    }

    /// 등록된 비트맵 폰트와 해당 폰트의 glyph cache를 제거합니다.
    pub fn remove_bitmap_font(&mut self, font_id: u32) -> bool {
        self.bitmap_text.remove_font(font_id)
    }

    /// 모든 비트맵 폰트와 font-dependent glyph cache를 제거합니다.
    pub fn clear_bitmap_fonts(&mut self) {
        self.bitmap_text.clear_fonts();
    }

    /// 월드 공간 텍스트를 만들거나 변경하고 glyph sprite cache를 다시 만듭니다.
    #[allow(clippy::too_many_arguments)]
    pub fn set_world_text(
        &mut self,
        text_id: u32,
        font_id: u32,
        text: &str,
        x: f32,
        y: f32,
        scale: f32,
        r: f32,
        g: f32,
        b: f32,
        a: f32,
        max_width: f32,
        alignment_code: u32,
        render_layer: i32,
        floor_id: u32,
        elevation: f32,
        anchor_entity_id: u32,
        anchor_entity_generation: u32,
    ) -> bool {
        if text_id > MAX_WORLD_TEXT_ID {
            return false;
        }
        let Some(alignment) = WorldTextAlignment::from_code(alignment_code) else {
            return false;
        };
        let anchor = if anchor_entity_id == WORLD_TEXT_NO_ENTITY {
            WorldTextAnchor::World
        } else {
            let entity = Entity {
                id: anchor_entity_id,
                generation: anchor_entity_generation,
            };
            if self.world.transform(entity).is_none() {
                return false;
            }
            WorldTextAnchor::Entity(entity)
        };
        self.bitmap_text.set_text(
            text_id,
            WorldTextSpec {
                font_id,
                text: text.to_owned(),
                x,
                y,
                scale,
                color: [r, g, b, a],
                max_width,
                alignment,
                render_layer,
                floor_id,
                elevation,
                anchor,
            },
        )
    }

    /// 문자열을 다시 전달하지 않고 기존 월드 텍스트의 숫자형 속성을 변경합니다.
    #[allow(clippy::too_many_arguments)]
    pub fn update_world_text(
        &mut self,
        text_id: u32,
        font_id: u32,
        x: f32,
        y: f32,
        scale: f32,
        r: f32,
        g: f32,
        b: f32,
        a: f32,
        max_width: f32,
        alignment_code: u32,
        render_layer: i32,
        floor_id: u32,
        elevation: f32,
        anchor_entity_id: u32,
        anchor_entity_generation: u32,
    ) -> bool {
        if text_id > MAX_WORLD_TEXT_ID {
            return false;
        }
        let Some(alignment) = WorldTextAlignment::from_code(alignment_code) else {
            return false;
        };
        let anchor = if anchor_entity_id == WORLD_TEXT_NO_ENTITY {
            WorldTextAnchor::World
        } else {
            let entity = Entity {
                id: anchor_entity_id,
                generation: anchor_entity_generation,
            };
            if self.world.transform(entity).is_none() {
                return false;
            }
            WorldTextAnchor::Entity(entity)
        };
        self.bitmap_text.update_text(
            text_id,
            WorldTextUpdate {
                font_id,
                x,
                y,
                scale,
                color: [r, g, b, a],
                max_width,
                alignment,
                render_layer,
                floor_id,
                elevation,
                anchor,
            },
        )
    }

    /// 월드 공간 텍스트 한 개를 제거합니다.
    pub fn remove_world_text(&mut self, text_id: u32) -> bool {
        self.bitmap_text.remove_text(text_id)
    }

    /// 모든 월드 공간 텍스트를 제거합니다.
    pub fn clear_world_texts(&mut self) {
        self.bitmap_text.clear_texts();
    }

    /// 등록된 월드 공간 텍스트 수를 반환합니다.
    pub fn world_text_count(&self) -> usize {
        self.bitmap_text.text_count()
    }

    /// 현재 cache에 들어 있는 drawable glyph 수를 반환합니다.
    pub fn world_text_glyph_count(&self) -> usize {
        self.bitmap_text.glyph_count()
    }
}
