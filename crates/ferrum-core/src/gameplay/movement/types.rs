use super::*;

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum MovementPatternEvaluation {
    Velocity(Velocity),
    Chase {
        target: MovementTarget,
        target_transform: Transform2D,
        speed: f32,
    },
    SeekTarget {
        target_transform: Transform2D,
        current_velocity: Velocity,
        speed: f32,
        turn_rate: f32,
    },
    Accelerate {
        current_velocity: Velocity,
        acceleration_x: f32,
        acceleration_y: f32,
        max_speed: f32,
    },
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum MovementPatternApplication {
    Applied,
    DeferredChase {
        target: MovementTarget,
        target_transform: Transform2D,
        speed: f32,
    },
    Unsupported,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct SweptKinematicHit {
    pub(crate) entity: Entity,
    pub(crate) time: f32,
    pub(crate) normal_x: f32,
    pub(crate) normal_y: f32,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum VelocityReflection {
    SurfaceNormal { normal_x: f32, normal_y: f32 },
    ContactOffsetX { surface: Entity, speed: f32 },
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct MovementNavigationSource {
    pub(crate) index: usize,
    pub(crate) generation: u32,
    pub(crate) transform: Transform2D,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum MovementNavigationTargetIdentity {
    PrimaryActor,
    NearestPrimaryActor,
    NearestEnemy,
    NearestLayer(CollisionLayer),
    NearestFaction(u32),
    NearestTag(u32),
    Entity(Entity),
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct MovementNavigationTargetCache {
    pub(in crate::gameplay) generation: u32,
    pub(in crate::gameplay) target_identity: MovementNavigationTargetIdentity,
    pub(in crate::gameplay) target: Transform2D,
    pub(in crate::gameplay) remaining_seconds: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct MovementNavigationPolicy {
    pub(crate) repath_interval_seconds: f32,
    pub(crate) reached_distance_squared: f32,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct MovementPatternBatchRunStats {
    pub(crate) candidates: usize,
    pub(crate) applied: usize,
    pub(crate) unsupported: usize,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct LayerMovementPatternPhaseConfig {
    pub(crate) layer: CollisionLayer,
    pub(crate) player_transform: Option<Transform2D>,
    pub(crate) navigation_policy: MovementNavigationPolicy,
    pub(crate) fallback_pattern: MovementPattern,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct LayerMovementPatternDefaultFallbackConfig {
    pub(crate) layer: CollisionLayer,
    pub(crate) player_transform: Option<Transform2D>,
    pub(crate) navigation_policy: MovementNavigationPolicy,
    pub(crate) fallback: DefaultMovementPatternConfig,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct TopdownInputMovementPhaseConfig {
    pub(crate) entity: Entity,
    pub(crate) input: FrameInputSnapshot,
    pub(crate) default_speed: f32,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct FrameInputSnapshot {
    pub(crate) current: InputState,
    pub(crate) previous: InputState,
}

impl FrameInputSnapshot {
    pub(crate) const fn new(current: InputState, previous: InputState) -> Self {
        Self { current, previous }
    }

    #[cfg(test)]
    pub(crate) const fn current_only(current: InputState) -> Self {
        Self {
            current,
            previous: current,
        }
    }
}
