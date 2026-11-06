//! Authoritative destructible terrain state. Platform code only receives owned snapshots.

use wasm_bindgen::prelude::*;

const MAX_DIMENSION: u32 = 4096;
const MAX_PIXELS: usize = 16_777_216;
const MAX_SAFE_VERSION: u64 = 9_007_199_254_740_991;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct DirtyRect {
    x: u32,
    y: u32,
    width: u32,
    height: u32,
}

#[wasm_bindgen]
pub struct NativePixelMaskTerrain {
    width: u32,
    height: u32,
    solid_threshold: u8,
    alpha: Vec<u8>,
    dirty: Option<DirtyRect>,
    version: u64,
}

#[wasm_bindgen]
impl NativePixelMaskTerrain {
    /// Empty input selects the fill value. Nonempty input must cover the entire mask.
    #[wasm_bindgen(constructor)]
    pub fn new(
        width: f64,
        height: f64,
        solid_threshold: f64,
        fill_solid: bool,
        data: &[u8],
    ) -> Result<Self, String> {
        let width = dimension(width, "width")?;
        let height = dimension(height, "height")?;
        let solid_threshold = alpha_byte(solid_threshold, "solidThreshold")?;
        let count = (width as usize)
            .checked_mul(height as usize)
            .filter(|count| *count <= MAX_PIXELS)
            .ok_or("pixelMaskTerrain exceeds the 16777216 pixel limit")?;
        if !data.is_empty() && data.len() != count {
            return Err("pixelMaskTerrain.data length must equal width * height".into());
        }
        let mut alpha = Vec::new();
        alpha
            .try_reserve_exact(count)
            .map_err(|_| "pixelMaskTerrain allocation failed")?;
        if data.is_empty() {
            alpha.resize(count, if fill_solid { 255 } else { 0 });
        } else {
            alpha.extend_from_slice(data);
        }
        Ok(Self {
            width,
            height,
            solid_threshold,
            alpha,
            dirty: None,
            version: 0,
        })
    }

    pub fn version(&self) -> f64 {
        self.version as f64
    }

    pub fn alpha_data(&self) -> Vec<u8> {
        self.alpha.clone()
    }

    pub fn solid_data(&self) -> Vec<u8> {
        self.alpha
            .iter()
            .map(|alpha| u8::from(*alpha >= self.solid_threshold))
            .collect()
    }

    pub fn is_solid(&self, x: f64, y: f64) -> bool {
        self.index(x, y)
            .is_some_and(|index| self.alpha[index] >= self.solid_threshold)
    }

    pub fn alpha_at(&self, x: f64, y: f64) -> u8 {
        self.index(x, y).map_or(0, |index| self.alpha[index])
    }

    pub fn set_pixel(&mut self, x: f64, y: f64, alpha: f64) -> Result<bool, String> {
        let Some(index) = self.index(x, y) else {
            return Ok(false);
        };
        let alpha = alpha_byte(alpha, "alpha")?;
        if self.alpha[index] == alpha {
            return Ok(false);
        }
        self.alpha[index] = alpha;
        self.mark_dirty(x as u32, y as u32);
        self.advance_version();
        Ok(true)
    }

    pub fn carve_rect(
        &mut self,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
        alpha: f64,
    ) -> Result<bool, String> {
        let alpha = alpha_byte(alpha, "alpha")?;
        // Match the clipped, floor/ceil rectangle contract, including empty NaN bounds.
        let right = x + width;
        let bottom = y + height;
        if [x, y, right, bottom].iter().any(|value| value.is_nan()) {
            return Ok(false);
        }
        let min_x = clipped_floor(x, self.width);
        let min_y = clipped_floor(y, self.height);
        let max_x = clipped_ceil(right, self.width);
        let max_y = clipped_ceil(bottom, self.height);
        let mut changed = false;
        for py in min_y..max_y {
            for px in min_x..max_x {
                changed |= self.write_pixel(px, py, alpha);
            }
        }
        if changed {
            self.advance_version();
        }
        Ok(changed)
    }

    pub fn carve_circle(
        &mut self,
        center_x: f64,
        center_y: f64,
        radius: f64,
        alpha: f64,
    ) -> Result<bool, String> {
        if !center_x.is_finite() || !center_y.is_finite() || !radius.is_finite() || radius < 0.0 {
            return Ok(false);
        }
        let alpha = alpha_byte(alpha, "alpha")?;
        let min_x = clipped_floor(center_x - radius, self.width);
        let min_y = clipped_floor(center_y - radius, self.height);
        let max_x = clipped_ceil(center_x + radius, self.width);
        let max_y = clipped_ceil(center_y + radius, self.height);
        let radius_squared = radius * radius;
        let mut changed = false;
        for py in min_y..max_y {
            for px in min_x..max_x {
                let dx = f64::from(px) + 0.5 - center_x;
                let dy = f64::from(py) + 0.5 - center_y;
                // Preserve the inexpensive squared-distance test for ordinary brush sizes.
                // hypot handles finite large circles whose squared radius would overflow.
                let inside = if radius_squared.is_finite() {
                    dx * dx + dy * dy <= radius_squared
                } else {
                    dx.hypot(dy) <= radius
                };
                if inside {
                    changed |= self.write_pixel(px, py, alpha);
                }
            }
        }
        if changed {
            self.advance_version();
        }
        Ok(changed)
    }

    pub fn dirty_rect(&self) -> Vec<u32> {
        self.dirty.map_or_else(Vec::new, |rect| {
            vec![rect.x, rect.y, rect.width, rect.height]
        })
    }

    pub fn clear_dirty(&mut self) {
        self.dirty = None;
    }

    /// Owned byte packet: four little-endian u32 rectangle fields, then compact alpha rows.
    /// An empty packet means clean. No borrowed Wasm memory escapes this operation.
    pub fn dirty_alpha_patch(&self) -> Vec<u8> {
        let Some(rect) = self.dirty else {
            return Vec::new();
        };
        let mut packet = Vec::with_capacity(16 + rect.width as usize * rect.height as usize);
        for word in [rect.x, rect.y, rect.width, rect.height] {
            packet.extend_from_slice(&word.to_le_bytes());
        }
        for y in rect.y..rect.y + rect.height {
            let start = (y * self.width + rect.x) as usize;
            packet.extend_from_slice(&self.alpha[start..start + rect.width as usize]);
        }
        packet
    }
}

impl NativePixelMaskTerrain {
    fn index(&self, x: f64, y: f64) -> Option<usize> {
        (x >= 0.0
            && y >= 0.0
            && x < f64::from(self.width)
            && y < f64::from(self.height)
            && x.fract() == 0.0
            && y.fract() == 0.0)
            .then(|| y as usize * self.width as usize + x as usize)
    }

    fn write_pixel(&mut self, x: u32, y: u32, alpha: u8) -> bool {
        let index = (y * self.width + x) as usize;
        if self.alpha[index] == alpha {
            return false;
        }
        self.alpha[index] = alpha;
        self.mark_dirty(x, y);
        true
    }

    fn mark_dirty(&mut self, x: u32, y: u32) {
        self.dirty = Some(match self.dirty {
            None => DirtyRect {
                x,
                y,
                width: 1,
                height: 1,
            },
            Some(rect) => {
                let min_x = rect.x.min(x);
                let min_y = rect.y.min(y);
                DirtyRect {
                    x: min_x,
                    y: min_y,
                    width: (rect.x + rect.width).max(x + 1) - min_x,
                    height: (rect.y + rect.height).max(y + 1) - min_y,
                }
            }
        });
    }

    fn advance_version(&mut self) {
        self.version = (self.version + 1).min(MAX_SAFE_VERSION);
    }
}

fn dimension(value: f64, path: &str) -> Result<u32, String> {
    if !value.is_finite() || value.fract() != 0.0 || value < 1.0 || value > f64::from(MAX_DIMENSION)
    {
        return Err(format!(
            "pixelMaskTerrain.{path} must be a positive integer at most {MAX_DIMENSION}"
        ));
    }
    Ok(value as u32)
}

fn alpha_byte(value: f64, path: &str) -> Result<u8, String> {
    if !value.is_finite() || !(0.0..=255.0).contains(&value) {
        return Err(format!("pixelMaskTerrain.{path} must be between 0 and 255"));
    }
    Ok(value.round() as u8)
}

fn clipped_floor(value: f64, limit: u32) -> u32 {
    value.floor().clamp(0.0, f64::from(limit)) as u32
}

fn clipped_ceil(value: f64, limit: u32) -> u32 {
    value.ceil().clamp(0.0, f64::from(limit)) as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn edits_accumulate_exact_dirty_bounds_and_advance_version_once() {
        let mut terrain = NativePixelMaskTerrain::new(4.0, 3.0, 1.0, true, &[]).unwrap();
        assert!(terrain.carve_rect(1.0, 1.0, 2.0, 1.0, 0.0).unwrap());
        assert_eq!(terrain.version(), 1.0);
        assert_eq!(terrain.dirty_rect(), [1, 1, 2, 1]);
        assert!(!terrain.carve_rect(1.0, 1.0, 2.0, 1.0, 0.0).unwrap());
        assert!(terrain.set_pixel(0.0, 2.0, 12.5).unwrap());
        assert_eq!(terrain.alpha_at(0.0, 2.0), 13);
        assert_eq!(terrain.dirty_rect(), [0, 1, 3, 2]);
        let packet = terrain.dirty_alpha_patch();
        assert_eq!(&packet[16..], [255, 0, 0, 13, 255, 255]);
        assert_eq!(u32::from_le_bytes(packet[4..8].try_into().unwrap()), 1);
        terrain.clear_dirty();
        assert_eq!(terrain.version(), 2.0);
        assert!(terrain.dirty_rect().is_empty());
        assert!(terrain.dirty_alpha_patch().is_empty());
    }

    #[test]
    fn snapshots_and_initial_data_do_not_alias_authoritative_state() {
        let mut input = [0, 127, 128, 255];
        let mut terrain = NativePixelMaskTerrain::new(2.0, 2.0, 128.0, false, &input).unwrap();
        input.fill(255);
        let mut alpha = terrain.alpha_data();
        alpha.fill(255);
        let mut solid = terrain.solid_data();
        solid.fill(0);
        assert_eq!(terrain.alpha_data(), [0, 127, 128, 255]);
        assert_eq!(terrain.solid_data(), [0, 0, 1, 1]);
        assert!(!terrain.is_solid(1.0, 0.0));
        assert!(terrain.is_solid(0.0, 1.0));
        terrain.set_pixel(0.0, 0.0, 255.0).unwrap();
        let restored =
            NativePixelMaskTerrain::new(2.0, 2.0, 128.0, false, &terrain.alpha_data()).unwrap();
        assert_eq!(restored.alpha_data(), terrain.alpha_data());
        assert_eq!(restored.version(), 0.0);
        assert!(restored.dirty_rect().is_empty());
    }

    #[test]
    fn bounds_invalid_inputs_and_failed_edits_are_atomic() {
        for dimension in [0.0, -1.0, 1.5, 4097.0, f64::INFINITY, f64::NAN] {
            assert!(NativePixelMaskTerrain::new(dimension, 1.0, 1.0, false, &[]).is_err());
            assert!(NativePixelMaskTerrain::new(1.0, dimension, 1.0, false, &[]).is_err());
        }
        assert!(NativePixelMaskTerrain::new(2.0, 2.0, 1.0, false, &[1]).is_err());
        assert!(NativePixelMaskTerrain::new(1.0, 1.0, 256.0, false, &[]).is_err());
        let mut terrain = NativePixelMaskTerrain::new(2.0, 2.0, 0.0, false, &[]).unwrap();
        assert!(terrain.is_solid(0.0, 0.0));
        for (x, y) in [(-1.0, 0.0), (2.0, 0.0), (0.5, 0.0), (f64::NAN, 0.0)] {
            assert!(!terrain.is_solid(x, y));
            assert_eq!(terrain.alpha_at(x, y), 0);
            assert!(!terrain.set_pixel(x, y, f64::NAN).unwrap());
        }
        assert!(terrain.set_pixel(0.0, 0.0, f64::NAN).is_err());
        assert!(terrain.carve_rect(0.0, 0.0, 2.0, 2.0, 256.0).is_err());
        assert!(terrain.carve_circle(1.0, 1.0, 2.0, -1.0).is_err());
        assert_eq!(terrain.alpha_data(), [0, 0, 0, 0]);
        assert_eq!(terrain.version(), 0.0);
        assert!(terrain.dirty_rect().is_empty());
    }

    #[test]
    fn clipping_and_circle_pixel_centers_are_bounded() {
        let mut terrain = NativePixelMaskTerrain::new(3.0, 3.0, 1.0, true, &[]).unwrap();
        assert!(terrain.carve_circle(1.5, 1.5, 0.75, 0.0).unwrap());
        assert_eq!(terrain.dirty_rect(), [1, 1, 1, 1]);
        assert_eq!(terrain.solid_data(), [1, 1, 1, 1, 0, 1, 1, 1, 1]);
        terrain.clear_dirty();
        assert!(terrain.carve_rect(-2.0, -2.0, 3.0, 3.0, 0.0).unwrap());
        assert_eq!(terrain.dirty_rect(), [0, 0, 1, 1]);
        assert!(!terrain.carve_rect(f64::NAN, 0.0, 3.0, 3.0, 0.0).unwrap());
        assert!(!terrain.carve_circle(0.0, 0.0, f64::INFINITY, 0.0).unwrap());
        assert!(!terrain.carve_circle(1e200, 1e200, 1.1e200, 0.0).unwrap());
        assert!(terrain
            .carve_rect(0.0, 0.0, f64::INFINITY, f64::INFINITY, 0.0)
            .unwrap());
        assert_eq!(terrain.alpha_data(), [0; 9]);
    }
}
