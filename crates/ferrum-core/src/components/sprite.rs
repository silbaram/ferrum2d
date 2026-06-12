#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Sprite {
    pub texture_id: u32,
    pub width: f32,
    pub height: f32,
    pub u0: f32,
    pub v0: f32,
    pub u1: f32,
    pub v1: f32,
    pub r: f32,
    pub g: f32,
    pub b: f32,
    pub a: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SpriteFrame {
    pub u0: f32,
    pub v0: f32,
    pub u1: f32,
    pub v1: f32,
}

impl SpriteFrame {
    pub const FULL: Self = Self {
        u0: 0.0,
        v0: 0.0,
        u1: 1.0,
        v1: 1.0,
    };

    pub fn from_values(u0: f32, v0: f32, u1: f32, v1: f32) -> Option<Self> {
        if u0.is_finite()
            && v0.is_finite()
            && u1.is_finite()
            && v1.is_finite()
            && (0.0..=1.0).contains(&u0)
            && (0.0..=1.0).contains(&v0)
            && (0.0..=1.0).contains(&u1)
            && (0.0..=1.0).contains(&v1)
            && u1 > u0
            && v1 > v0
        {
            Some(Self { u0, v0, u1, v1 })
        } else {
            None
        }
    }

    pub fn uv(self) -> (f32, f32, f32, f32) {
        (self.u0, self.v0, self.u1, self.v1)
    }
}

pub const MAX_SPRITE_ANIMATION_FRAMES: usize = 32;
pub const MAX_SPRITE_ANIMATION_CLIPS: usize = 8;
pub const MAX_SPRITE_ANIMATION_FRAME_EVENTS: usize = 16;
pub const SPRITE_ANIMATION_CLIP_IDLE: u32 = 0;
pub const SPRITE_ANIMATION_CLIP_MOVE: u32 = 1;
pub const SPRITE_ANIMATION_CLIP_ATTACK: u32 = 2;
pub const SPRITE_ANIMATION_CLIP_DIE: u32 = 3;
pub const SPRITE_ANIMATION_EVENT_HITBOX: u32 = 1;
pub const SPRITE_ANIMATION_EVENT_SOUND: u32 = 2;
pub const SPRITE_ANIMATION_EVENT_EFFECT: u32 = 3;
pub const SPRITE_ANIMATION_EVENT_CUSTOM: u32 = 4;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SpriteAnimation {
    pub columns: u32,
    pub rows: u32,
    pub idle: SpriteAnimationState,
    pub moving: SpriteAnimationState,
    pub idle_frames: Option<SpriteAnimationFrameSequence>,
    pub moving_frames: Option<SpriteAnimationFrameSequence>,
    pub clips: [Option<SpriteAnimationClip>; MAX_SPRITE_ANIMATION_CLIPS],
    pub clip_frames: [Option<SpriteAnimationFrameSequence>; MAX_SPRITE_ANIMATION_CLIPS],
    pub frame_events: [Option<SpriteAnimationFrameEvent>; MAX_SPRITE_ANIMATION_FRAME_EVENTS],
    pub current_state: SpriteAnimationKind,
    pub current_clip: u32,
    pub current_frame: u32,
    pub elapsed_seconds: f32,
    pub clip_finished: bool,
    pub pending_frame_events: bool,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SpriteAnimationFrameSequence {
    frames: [SpriteFrame; MAX_SPRITE_ANIMATION_FRAMES],
    frame_count: u32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SpriteAnimationState {
    pub row: u32,
    pub frame_count: u32,
    pub frames_per_second: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SpriteAnimationClip {
    pub state: SpriteAnimationState,
    pub looped: bool,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct SpriteAnimationFrameEvent {
    pub clip_id: u32,
    pub frame: u32,
    pub event_kind: u32,
    pub token_id: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SpriteAnimationKind {
    Idle,
    Moving,
    Attack,
    Die,
}

impl SpriteAnimation {
    pub fn new(
        columns: u32,
        rows: u32,
        idle: SpriteAnimationState,
        moving: SpriteAnimationState,
    ) -> Option<Self> {
        if columns <= 1 || rows == 0 || !idle.is_valid(columns, rows) {
            return None;
        }

        let moving = if moving.is_valid(columns, rows) {
            moving
        } else {
            idle
        };
        let mut animation = Self {
            columns,
            rows,
            idle,
            moving,
            idle_frames: None,
            moving_frames: None,
            clips: [None; MAX_SPRITE_ANIMATION_CLIPS],
            clip_frames: [None; MAX_SPRITE_ANIMATION_CLIPS],
            frame_events: [None; MAX_SPRITE_ANIMATION_FRAME_EVENTS],
            current_state: SpriteAnimationKind::Idle,
            current_clip: SPRITE_ANIMATION_CLIP_IDLE,
            current_frame: 0,
            elapsed_seconds: 0.0,
            clip_finished: false,
            pending_frame_events: false,
        };
        animation.clips[SPRITE_ANIMATION_CLIP_IDLE as usize] = Some(SpriteAnimationClip {
            state: idle,
            looped: true,
        });
        animation.clips[SPRITE_ANIMATION_CLIP_MOVE as usize] = Some(SpriteAnimationClip {
            state: moving,
            looped: true,
        });
        Some(animation)
    }

    pub fn horizontal(frame_count: u32, frames_per_second: f32) -> Option<Self> {
        let state = SpriteAnimationState {
            row: 0,
            frame_count,
            frames_per_second,
        };
        Self::new(frame_count, 1, state, state)
    }

    pub fn atlas(
        idle_frames: &[SpriteFrame],
        idle_frames_per_second: f32,
        moving_frames: &[SpriteFrame],
        moving_frames_per_second: f32,
    ) -> Option<Self> {
        let idle_sequence = SpriteAnimationFrameSequence::from_frames(idle_frames)?;
        let moving_sequence =
            SpriteAnimationFrameSequence::from_frames(moving_frames).unwrap_or(idle_sequence);
        let idle = SpriteAnimationState {
            row: 0,
            frame_count: idle_sequence.frame_count,
            frames_per_second: idle_frames_per_second,
        };
        let moving = SpriteAnimationState {
            row: 0,
            frame_count: moving_sequence.frame_count,
            frames_per_second: moving_frames_per_second,
        };
        if !idle.is_timed() {
            return None;
        }

        let mut animation = Self {
            columns: idle_sequence.frame_count.max(moving_sequence.frame_count),
            rows: 1,
            idle,
            moving: if moving.is_timed() { moving } else { idle },
            idle_frames: Some(idle_sequence),
            moving_frames: Some(if moving.is_timed() {
                moving_sequence
            } else {
                idle_sequence
            }),
            clips: [None; MAX_SPRITE_ANIMATION_CLIPS],
            clip_frames: [None; MAX_SPRITE_ANIMATION_CLIPS],
            frame_events: [None; MAX_SPRITE_ANIMATION_FRAME_EVENTS],
            current_state: SpriteAnimationKind::Idle,
            current_clip: SPRITE_ANIMATION_CLIP_IDLE,
            current_frame: 0,
            elapsed_seconds: 0.0,
            clip_finished: false,
            pending_frame_events: false,
        };
        animation.clips[SPRITE_ANIMATION_CLIP_IDLE as usize] = Some(SpriteAnimationClip {
            state: idle,
            looped: true,
        });
        animation.clip_frames[SPRITE_ANIMATION_CLIP_IDLE as usize] = Some(idle_sequence);
        let moving = if moving.is_timed() { moving } else { idle };
        let moving_sequence = if moving.is_timed() {
            moving_sequence
        } else {
            idle_sequence
        };
        animation.clips[SPRITE_ANIMATION_CLIP_MOVE as usize] = Some(SpriteAnimationClip {
            state: moving,
            looped: true,
        });
        animation.clip_frames[SPRITE_ANIMATION_CLIP_MOVE as usize] = Some(moving_sequence);
        Some(animation)
    }

    pub fn advance(&mut self, delta: f32, is_moving: bool) {
        let mut ignored_events =
            [SpriteAnimationFrameEvent::default(); MAX_SPRITE_ANIMATION_FRAME_EVENTS];
        self.advance_collect_events(delta, is_moving, &mut ignored_events);
    }

    pub fn advance_collect_events(
        &mut self,
        delta: f32,
        is_moving: bool,
        output: &mut [SpriteAnimationFrameEvent],
    ) -> usize {
        let motion_clip = if is_moving {
            SPRITE_ANIMATION_CLIP_MOVE
        } else {
            SPRITE_ANIMATION_CLIP_IDLE
        };
        if self.should_follow_motion_clip() {
            self.switch_clip(motion_clip);
        }
        if delta <= 0.0 || !delta.is_finite() {
            return 0;
        }

        let Some(clip) = self.active_clip() else {
            return 0;
        };
        let state = clip.state;
        let mut emitted = 0;
        if self.pending_frame_events {
            emitted += self.write_current_frame_events(&mut output[emitted..]);
            self.pending_frame_events = false;
        }
        self.elapsed_seconds += delta;
        let frame_duration = 1.0 / state.frames_per_second;
        while self.elapsed_seconds >= frame_duration {
            self.elapsed_seconds -= frame_duration;
            if self.advance_frame(clip) {
                emitted += self.write_current_frame_events(&mut output[emitted..]);
            } else {
                break;
            }
        }
        emitted
    }

    pub fn uv(&self) -> (f32, f32, f32, f32) {
        let state = self.active_state().unwrap_or(self.idle);
        if let Some(sequence) = self.active_frame_sequence() {
            return sequence.frame(self.current_frame).uv();
        }

        let frame_width = 1.0 / self.columns as f32;
        let frame_height = 1.0 / self.rows as f32;
        let u0 = self.current_frame as f32 * frame_width;
        let v0 = state.row as f32 * frame_height;
        (u0, v0, u0 + frame_width, v0 + frame_height)
    }

    pub fn set_grid_clip(
        &mut self,
        clip_id: u32,
        state: SpriteAnimationState,
        looped: bool,
    ) -> bool {
        if !self.is_valid_clip_id(clip_id) || !state.is_valid(self.columns, self.rows) {
            return false;
        }
        self.clips[clip_id as usize] = Some(SpriteAnimationClip { state, looped });
        self.clip_frames[clip_id as usize] = None;
        self.sync_legacy_clip_fields(clip_id, state, None);
        true
    }

    pub fn set_atlas_clip(
        &mut self,
        clip_id: u32,
        frames: &[SpriteFrame],
        frames_per_second: f32,
        looped: bool,
    ) -> bool {
        if !self.is_valid_clip_id(clip_id) {
            return false;
        }
        let Some(sequence) = SpriteAnimationFrameSequence::from_frames(frames) else {
            return false;
        };
        let state = SpriteAnimationState {
            row: 0,
            frame_count: sequence.frame_count,
            frames_per_second,
        };
        if !state.is_timed() {
            return false;
        }
        self.columns = self.columns.max(sequence.frame_count);
        self.rows = self.rows.max(1);
        self.clips[clip_id as usize] = Some(SpriteAnimationClip { state, looped });
        self.clip_frames[clip_id as usize] = Some(sequence);
        self.sync_legacy_clip_fields(clip_id, state, Some(sequence));
        true
    }

    pub fn play_clip(&mut self, clip_id: u32) -> bool {
        if !self.has_clip(clip_id) {
            return false;
        }
        self.switch_clip(clip_id);
        true
    }

    pub fn add_frame_event(
        &mut self,
        clip_id: u32,
        frame: u32,
        event_kind: u32,
        token_id: u32,
    ) -> bool {
        let Some(clip) = self.clip(clip_id) else {
            return false;
        };
        if frame >= clip.state.frame_count || token_id == 0 || !valid_animation_event(event_kind) {
            return false;
        }
        let event = SpriteAnimationFrameEvent {
            clip_id,
            frame,
            event_kind,
            token_id,
        };
        if self
            .frame_events
            .iter()
            .flatten()
            .any(|existing| *existing == event)
        {
            return true;
        }
        let Some(slot) = self.frame_events.iter_mut().find(|slot| slot.is_none()) else {
            return false;
        };
        *slot = Some(event);
        true
    }

    pub fn active_clip_id(&self) -> u32 {
        self.current_clip
    }

    fn active_state(&self) -> Option<SpriteAnimationState> {
        self.active_clip().map(|clip| clip.state)
    }

    fn active_clip(&self) -> Option<SpriteAnimationClip> {
        self.clip(self.current_clip).or_else(|| {
            self.clip(match self.current_state {
                SpriteAnimationKind::Idle => SPRITE_ANIMATION_CLIP_IDLE,
                SpriteAnimationKind::Moving => SPRITE_ANIMATION_CLIP_MOVE,
                SpriteAnimationKind::Attack => SPRITE_ANIMATION_CLIP_ATTACK,
                SpriteAnimationKind::Die => SPRITE_ANIMATION_CLIP_DIE,
            })
        })
    }

    fn clip(&self, clip_id: u32) -> Option<SpriteAnimationClip> {
        self.clips.get(clip_id as usize).and_then(|clip| *clip)
    }

    fn active_frame_sequence(&self) -> Option<&SpriteAnimationFrameSequence> {
        self.clip_frames
            .get(self.current_clip as usize)
            .and_then(Option::as_ref)
            .or(match self.current_state {
                SpriteAnimationKind::Idle => self.idle_frames.as_ref(),
                SpriteAnimationKind::Moving => self.moving_frames.as_ref(),
                SpriteAnimationKind::Attack | SpriteAnimationKind::Die => None,
            })
    }

    fn should_follow_motion_clip(&self) -> bool {
        self.current_clip == SPRITE_ANIMATION_CLIP_IDLE
            || self.current_clip == SPRITE_ANIMATION_CLIP_MOVE
            || self.clip_finished
            || !self.has_clip(self.current_clip)
    }

    fn switch_clip(&mut self, clip_id: u32) {
        if self.current_clip == clip_id && !self.clip_finished {
            return;
        }
        self.current_clip = clip_id;
        self.current_state =
            SpriteAnimationKind::from_clip_id(clip_id).unwrap_or(self.current_state);
        self.current_frame = 0;
        self.elapsed_seconds = 0.0;
        self.clip_finished = false;
        self.pending_frame_events = true;
    }

    fn advance_frame(&mut self, clip: SpriteAnimationClip) -> bool {
        if self.clip_finished {
            return false;
        }
        let next_frame = self.current_frame + 1;
        if next_frame < clip.state.frame_count {
            self.current_frame = next_frame;
            return true;
        }
        if clip.looped {
            self.current_frame = 0;
            return true;
        }
        self.current_frame = clip.state.frame_count.saturating_sub(1);
        self.clip_finished = true;
        false
    }

    fn write_current_frame_events(&self, output: &mut [SpriteAnimationFrameEvent]) -> usize {
        let mut written = 0;
        for event in self.frame_events.iter().flatten().copied() {
            if event.clip_id != self.current_clip || event.frame != self.current_frame {
                continue;
            }
            let Some(slot) = output.get_mut(written) else {
                break;
            };
            *slot = event;
            written += 1;
        }
        written
    }

    fn has_clip(&self, clip_id: u32) -> bool {
        self.clips
            .get(clip_id as usize)
            .is_some_and(Option::is_some)
    }

    fn is_valid_clip_id(&self, clip_id: u32) -> bool {
        (clip_id as usize) < MAX_SPRITE_ANIMATION_CLIPS
    }

    fn sync_legacy_clip_fields(
        &mut self,
        clip_id: u32,
        state: SpriteAnimationState,
        frames: Option<SpriteAnimationFrameSequence>,
    ) {
        match clip_id {
            SPRITE_ANIMATION_CLIP_IDLE => {
                self.idle = state;
                self.idle_frames = frames;
            }
            SPRITE_ANIMATION_CLIP_MOVE => {
                self.moving = state;
                self.moving_frames = frames;
            }
            _ => {}
        }
    }
}

impl SpriteAnimationKind {
    pub const fn clip_id(self) -> u32 {
        match self {
            Self::Idle => SPRITE_ANIMATION_CLIP_IDLE,
            Self::Moving => SPRITE_ANIMATION_CLIP_MOVE,
            Self::Attack => SPRITE_ANIMATION_CLIP_ATTACK,
            Self::Die => SPRITE_ANIMATION_CLIP_DIE,
        }
    }

    pub const fn from_clip_id(clip_id: u32) -> Option<Self> {
        match clip_id {
            SPRITE_ANIMATION_CLIP_IDLE => Some(Self::Idle),
            SPRITE_ANIMATION_CLIP_MOVE => Some(Self::Moving),
            SPRITE_ANIMATION_CLIP_ATTACK => Some(Self::Attack),
            SPRITE_ANIMATION_CLIP_DIE => Some(Self::Die),
            _ => None,
        }
    }
}

impl SpriteAnimationFrameSequence {
    pub fn from_frames(frames: &[SpriteFrame]) -> Option<Self> {
        if frames.is_empty() || frames.len() > MAX_SPRITE_ANIMATION_FRAMES {
            return None;
        }

        let mut sequence = Self {
            frames: [SpriteFrame::FULL; MAX_SPRITE_ANIMATION_FRAMES],
            frame_count: frames.len() as u32,
        };
        for (index, frame) in frames.iter().copied().enumerate() {
            sequence.frames[index] = frame;
        }
        Some(sequence)
    }

    pub fn frame_count(&self) -> u32 {
        self.frame_count
    }

    pub fn first_frame(&self) -> SpriteFrame {
        self.frames[0]
    }

    fn frame(&self, index: u32) -> SpriteFrame {
        let resolved = (index % self.frame_count) as usize;
        self.frames[resolved]
    }
}

impl SpriteAnimationState {
    pub fn is_valid(&self, columns: u32, rows: u32) -> bool {
        self.row < rows && self.frame_count > 0 && self.frame_count <= columns && self.is_timed()
    }

    pub fn is_timed(&self) -> bool {
        self.frames_per_second.is_finite() && self.frames_per_second > 0.0
    }
}

const fn valid_animation_event(event_kind: u32) -> bool {
    matches!(
        event_kind,
        SPRITE_ANIMATION_EVENT_HITBOX
            | SPRITE_ANIMATION_EVENT_SOUND
            | SPRITE_ANIMATION_EVENT_EFFECT
            | SPRITE_ANIMATION_EVENT_CUSTOM
    )
}
