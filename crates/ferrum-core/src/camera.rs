use crate::components::Transform2D;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Camera2D {
    pub x: f32,
    pub y: f32,
    pub viewport_width: f32,
    pub viewport_height: f32,
}

impl Camera2D {
    pub fn new(viewport_width: f32, viewport_height: f32) -> Self {
        Self {
            x: viewport_width * 0.5,
            y: viewport_height * 0.5,
            viewport_width,
            viewport_height,
        }
    }

    pub fn set_viewport_size(&mut self, width: f32, height: f32) {
        if width > 0.0 {
            self.viewport_width = width;
        }
        if height > 0.0 {
            self.viewport_height = height;
        }
    }

    pub fn follow(&mut self, target: Transform2D, world_width: f32, world_height: f32) {
        self.x = target.x;
        self.y = target.y;
        self.clamp_to_world(world_width, world_height);
    }

    pub fn world_to_screen(&self, transform: Transform2D) -> Transform2D {
        Transform2D {
            x: transform.x - self.left(),
            y: transform.y - self.top(),
        }
    }

    pub fn screen_to_world(&self, transform: Transform2D) -> Transform2D {
        Transform2D {
            x: transform.x + self.left(),
            y: transform.y + self.top(),
        }
    }

    fn left(&self) -> f32 {
        self.x - self.viewport_width * 0.5
    }

    fn top(&self) -> f32 {
        self.y - self.viewport_height * 0.5
    }

    fn clamp_to_world(&mut self, world_width: f32, world_height: f32) {
        self.x = clamp_axis(self.x, self.viewport_width, world_width);
        self.y = clamp_axis(self.y, self.viewport_height, world_height);
    }
}

fn clamp_axis(center: f32, viewport_size: f32, world_size: f32) -> f32 {
    if viewport_size >= world_size {
        world_size * 0.5
    } else {
        center.clamp(viewport_size * 0.5, world_size - viewport_size * 0.5)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn follow_clamps_camera_to_world_bounds() {
        let mut camera = Camera2D::new(400.0, 240.0);

        camera.follow(Transform2D { x: 50.0, y: 900.0 }, 1600.0, 960.0);

        assert_eq!(camera.x, 200.0);
        assert_eq!(camera.y, 840.0);
    }

    #[test]
    fn world_to_screen_applies_camera_offset() {
        let mut camera = Camera2D::new(400.0, 240.0);
        camera.follow(Transform2D { x: 800.0, y: 480.0 }, 1600.0, 960.0);

        let screen = camera.world_to_screen(Transform2D { x: 820.0, y: 500.0 });

        assert_eq!(screen, Transform2D { x: 220.0, y: 140.0 });
    }

    #[test]
    fn screen_to_world_applies_camera_offset() {
        let mut camera = Camera2D::new(400.0, 240.0);
        camera.follow(Transform2D { x: 800.0, y: 480.0 }, 1600.0, 960.0);

        let world = camera.screen_to_world(Transform2D { x: 220.0, y: 140.0 });

        assert_eq!(world, Transform2D { x: 820.0, y: 500.0 });
    }
}
