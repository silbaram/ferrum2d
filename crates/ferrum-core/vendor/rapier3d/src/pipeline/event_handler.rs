// Ferrum2D modified vendored source; see FERRUM-PATCHES.md.
#[cfg(feature = "alloc")]
use crate::dynamics::{RigidBodySet, SoftBodySet, SoftBodyTearEvent};
#[cfg(all(feature = "std", feature = "alloc"))]
use crate::geometry::ContactForceEvent;
#[cfg(feature = "alloc")]
use crate::geometry::{ColliderSet, CollisionEvent, ContactPair};
#[cfg(feature = "alloc")]
use crate::math::Real;

/// Transient observation of one rigid-body solver integration interval.
#[cfg(feature = "alloc")]
#[derive(Debug, Clone, Copy)]
#[cfg_attr(
    feature = "serde-serialize",
    derive(serde::Serialize, serde::Deserialize)
)]
pub struct SolverBodyMotion {
    /// Generational body identity.
    pub body: crate::dynamics::RigidBodyHandle,
    /// Seconds since the current CCD time slice began.
    pub start_time: Real,
    /// Seconds since the current CCD time slice began.
    pub end_time: Real,
    /// Actual center-of-mass pose before integration.
    pub start: crate::math::Pose,
    /// Actual center-of-mass pose after integration, before later CCD overrides.
    pub end: crate::math::Pose,
}

/// One actual linearized solver integration, retaining its time law instead of
/// replacing it with interpolation between normalized endpoint quaternions.
/// Backend solver storage remains transient. Downstream query observations may
/// explicitly persist this integration law as their own versioned payload.
#[cfg(feature = "alloc")]
#[derive(Debug, Clone, Copy)]
#[cfg_attr(
    feature = "serde-serialize",
    derive(serde::Serialize, serde::Deserialize)
)]
pub struct SolverBodyIntegration {
    /// Actual generational body identity and accepted integration endpoints.
    pub motion: SolverBodyMotion,
    /// The kernel's actual integration dt. Subtracting rounded observer labels
    /// `(i+1)*dt - i*dt` need not recover this exact value.
    pub integration_seconds: Real,
    /// Solved center-of-mass velocity, after the solver speed caps.
    pub linear_velocity: crate::math::Vector,
    /// Solved angular velocity, after the solver speed caps.
    pub angular_velocity: crate::math::AngVector,
}

#[cfg(feature = "alloc")]
impl SolverBodyIntegration {
    /// Build one continuation using the same integration kernel, with an
    /// already accepted velocity. No force or damping is integrated here.
    pub fn from_velocity(
        body: crate::dynamics::RigidBodyHandle,
        start_time: Real,
        end_time: Real,
        start: crate::math::Pose,
        linear_velocity: crate::math::Vector,
        angular_velocity: crate::math::AngVector,
    ) -> Option<Self> {
        if !start_time.is_finite()
            || !end_time.is_finite()
            || end_time <= start_time
            || !start.is_finite()
            || !linear_velocity.is_finite()
            || !angular_velocity.is_finite()
        {
            return None;
        }
        let mut end = start;
        crate::dynamics::RigidBodyVelocity {
            linvel: linear_velocity,
            angvel: angular_velocity,
        }
        .integrate_linearized(
            end_time - start_time,
            &mut end.translation,
            &mut end.rotation,
        );
        end.is_finite().then_some(Self {
            motion: SolverBodyMotion {
                body,
                start_time,
                end_time,
                start,
                end,
            },
            integration_seconds: end_time - start_time,
            linear_velocity,
            angular_velocity,
        })
    }

    /// Evaluate the same COM translation and quaternion kernel as the worker.
    /// The endpoints are returned verbatim; no endpoint slerp/nlerp is invented.
    pub fn position_at_time(&self, time: Real) -> crate::math::Pose {
        if time <= self.motion.start_time {
            return self.motion.start;
        }
        if time >= self.motion.end_time {
            return self.motion.end;
        }
        let dt = self.integration_seconds
            * ((time - self.motion.start_time) / (self.motion.end_time - self.motion.start_time));
        let mut pose = self.motion.start;
        crate::dynamics::RigidBodyVelocity {
            linvel: self.linear_velocity,
            angvel: self.angular_velocity,
        }
        .integrate_linearized(dt, &mut pose.translation, &mut pose.rotation);
        pose
    }

    /// Evaluate the original physical kernel at an interval-local physical dt.
    /// Private precise-clock consumers map their logical fraction to this dt;
    /// no absolute observer timestamp is reconstructed or integrated as force.
    pub fn position_at_integration_time(&self, dt: Real) -> crate::math::Pose {
        if dt <= 0. {
            return self.motion.start;
        }
        if dt >= self.integration_seconds {
            return self.motion.end;
        }
        let mut pose = self.motion.start;
        crate::dynamics::RigidBodyVelocity {
            linvel: self.linear_velocity,
            angvel: self.angular_velocity,
        }
        .integrate_linearized(dt, &mut pose.translation, &mut pose.rotation);
        pose
    }

    /// Derivative of the linearized rotation kernel at this interval's time.
    /// `angular_velocity` itself is the initial rate, not a constant rate along
    /// the normalized quaternion curve.
    pub fn angular_velocity_at_time(&self, time: Real) -> crate::math::AngVector {
        let span = self.motion.end_time - self.motion.start_time;
        let ratio = self.integration_seconds / span;
        let dt =
            self.integration_seconds * ((time - self.motion.start_time) / span).clamp(0.0, 1.0);
        #[cfg(feature = "dim3")]
        let scale = 0.25 * self.angular_velocity.length_squared();
        #[cfg(feature = "dim2")]
        let scale = self.angular_velocity * self.angular_velocity;
        self.angular_velocity * (ratio / (1.0 + scale * dt * dt))
    }

    /// COM derivative in the observer clock, preserving the actual kernel dt.
    pub fn linear_velocity_at_time(&self) -> crate::math::Vector {
        self.linear_velocity
            * (self.integration_seconds / (self.motion.end_time - self.motion.start_time))
    }
}

bitflags::bitflags! {
    #[cfg_attr(feature = "serde-serialize", derive(Serialize, Deserialize))]
    #[derive(Copy, Clone, PartialEq, Eq, Debug, Hash)]
    /// Flags that control which physics events are generated for a collider.
    ///
    /// By default, colliders don't generate events (for performance). Enable specific events
    /// per-collider using these flags.
    ///
    /// # Example
    /// ```
    /// # use rapier3d::prelude::*;
    /// // Enable collision start/stop events for a trigger zone
    /// let trigger = ColliderBuilder::cuboid(5.0, 5.0, 5.0)
    ///     .sensor(true)
    ///     .active_events(ActiveEvents::COLLISION_EVENTS)
    ///     .build();
    ///
    /// // Enable force events for breakable glass
    /// let glass = ColliderBuilder::cuboid(1.0, 2.0, 0.1)
    ///     .active_events(ActiveEvents::CONTACT_FORCE_EVENTS)
    ///     .contact_force_event_threshold(1000.0)
    ///     .build();
    /// ```
    pub struct ActiveEvents: u32 {
        /// Enables `Started`/`Stopped` collision events for this collider.
        ///
        /// You'll receive events when this collider starts or stops touching others.
        const COLLISION_EVENTS = 0b0001;

        /// Enables contact force events when forces exceed a threshold.
        ///
        /// You'll receive events when contact forces surpass `contact_force_event_threshold`.
        const CONTACT_FORCE_EVENTS = 0b0010;
    }
}

impl Default for ActiveEvents {
    fn default() -> Self {
        ActiveEvents::empty()
    }
}

/// A callback interface for receiving physics events (collisions starting/stopping, contact forces,
/// soft-body tears).
///
/// Implement this trait to get notified when:
/// - Two colliders start or stop touching ([`handle_collision_event`](Self::handle_collision_event))
/// - Contact forces exceed a threshold ([`handle_contact_force_event`](Self::handle_contact_force_event))
/// - A soft body tears ([`handle_soft_body_tear_event`](Self::handle_soft_body_tear_event))
///
/// # Common use cases
/// - Playing sound effects when objects collide
/// - Triggering game events (damage, pickups, checkpoints)
/// - Monitoring structural stress
/// - Detecting when specific objects touch
///
/// # Built-in implementation
/// Use [`ChannelEventCollector`] to collect events into channels for processing after the physics step.
///
/// # Example
/// ```
/// # use rapier3d::prelude::*;
/// # use rapier3d::geometry::ContactPair;
/// struct MyEventHandler;
///
/// impl EventHandler for MyEventHandler {
///     fn handle_collision_event(
///         &self,
///         bodies: &RigidBodySet,
///         colliders: &ColliderSet,
///         event: CollisionEvent,
///         contact_pair: Option<&ContactPair>,
///     ) {
///         match event {
///             CollisionEvent::Started(h1, h2, _) => {
///                 println!("Collision started between {:?} and {:?}", h1, h2);
///             }
///             CollisionEvent::Stopped(h1, h2, _) => {
///                 println!("Collision ended between {:?} and {:?}", h1, h2);
///             }
///         }
///     }
/// #   fn handle_contact_force_event(&self, _dt: Real, _bodies: &RigidBodySet, _colliders: &ColliderSet, _contact_pair: &ContactPair, _total_force_magnitude: Real) {}
/// #   fn handle_soft_body_tear_event(&self, _soft_bodies: &SoftBodySet, _event: &SoftBodyTearEvent) {}
/// }
/// ```
#[cfg(feature = "alloc")]
pub trait EventHandler: crate::utils::MaybeSync {
    /// Opts into transient rigid-body integration observations. Disabled by default.
    /// These callbacks do not change integration and are independent of event flags.
    fn wants_body_motion(&self) -> bool {
        false
    }

    /// Opts into the exclusive post-integration motion approval stage.
    /// The default solver and observer path do not execute this extra stage.
    fn resolves_solver_motion(&self) -> bool {
        false
    }

    /// Logical domain of this complete pipeline step. The default preserves
    /// native physical seconds. An opted-in caller supplies one finite, strictly
    /// increasing tick-local interval; this never changes integration dt.
    fn solver_motion_step_domain(&self, duration: Real) -> (f64, f64) {
        (0., f64::from(duration))
    }

    /// The exact shared tick-domain boundaries of one physical CCD pass.
    /// Default observers retain their existing f32 callback unchanged.
    fn handle_body_motion_pass_domain_started(&self, duration: Real, _start: f64, _end: f64) {
        self.handle_body_motion_pass_started(duration);
    }

    /// A proposed actual-kernel integration. An opted-in resolver owns
    /// acceptance and observations; the default forwards its original event.
    fn handle_solver_body_proposal(&self, integration: SolverBodyIntegration) {
        self.handle_solver_body_integration(integration);
    }

    /// Runs after all rigid integrations of one solver interval have completed,
    /// before stabilization and the next constraint solve. No backend step,
    /// force integration or user callback may be started from this method.
    fn resolve_solver_motion(
        &self,
        _context: &mut dyn super::SolverMotionContext,
    ) -> super::SolverMotionDecision {
        // An opt-in implementation must explicitly approve its complete batch.
        super::SolverMotionDecision::Rejected
    }

    /// Final fallible approval after every group and restitution, before any
    /// persistent contact/joint impulse or body writeback. The view is borrowed
    /// exclusively by worker zero; no step, force integration or callback may
    /// be started here. Leaving the plan uncovered preserves native behavior.
    fn plan_solver_ccd(
        &self,
        _context: &dyn super::SolverMotionContext,
        _params: &crate::dynamics::IntegrationParameters,
        _plan: &mut super::SolverCcdPlan,
    ) -> super::SolverMotionDecision {
        super::SolverMotionDecision::Approved
    }

    /// Observes a prepared position-only clamp. The actual cutoff is private
    /// f64 time; the default adapter only emits the old lossy endpoint record.
    /// It deliberately does not invent a whole-endpoint Sweep for exact queries.
    fn handle_prepared_ccd_clamp(
        &self,
        body: crate::dynamics::RigidBodyHandle,
        start: crate::math::Pose,
        end: crate::math::Pose,
        cutoff_time: f64,
        duration: f64,
    ) {
        self.handle_body_motion_clamp(body, start, end, (cutoff_time / duration) as Real);
    }

    /// Starts one CCD time slice of a pipeline step. Solver sample times are relative
    /// to this slice; several slices may occur during a single pipeline step.
    fn handle_body_motion_pass_started(&self, _duration: Real) {}

    /// Observes one actual solver integration interval, in center-of-mass poses.
    /// Called concurrently in parallel builds. Soft particles and multibody links
    /// are not reported by this callback. No borrowed solver storage escapes.
    fn handle_solver_body_motion(&self, _motion: SolverBodyMotion) {}

    /// Observes the exact solver integration law. Existing observers still
    /// receive their original endpoint event through this default adapter.
    fn handle_solver_body_integration(&self, integration: SolverBodyIntegration) {
        self.handle_solver_body_motion(integration.motion);
    }

    /// Reports an accepted CCD override of the solved path. Poses are at the center
    /// of mass; fraction is relative to the path before this particular clamp.
    /// Repeated clamps on the same body shorten that already-clamped path again.
    fn handle_body_motion_clamp(
        &self,
        _body: crate::dynamics::RigidBodyHandle,
        _start: crate::math::Pose,
        _end: crate::math::Pose,
        _fraction: Real,
    ) {
    }

    /// Reports the original CCD sweep and its accepted prefix. Keeping the
    /// original sweep matters: nlerping normalized shortened endpoints would
    /// change the prefix time law. Existing endpoint observers remain unchanged.
    fn handle_body_motion_clamped(
        &self,
        body: crate::dynamics::RigidBodyHandle,
        start: crate::math::Pose,
        end: crate::math::Pose,
        _sweep: &crate::parry::query::sweep_toi::Sweep,
        fraction: Real,
    ) {
        self.handle_body_motion_clamp(body, start, end, fraction);
    }

    /// Called when two colliders start or stop touching each other.
    ///
    /// Collision events are triggered when intersection state changes (Started/Stopped).
    /// At least one collider must have [`ActiveEvents::COLLISION_EVENTS`] enabled.
    ///
    /// # Parameters
    /// * `event` - Either `Started(h1, h2, flags)` or `Stopped(h1, h2, flags)`
    /// * `bodies` - All rigid bodies (to look up body info)
    /// * `colliders` - All colliders (to look up collider info)
    /// * `contact_pair` - Detailed contact info (`None` for sensors, since they don't compute contacts)
    ///
    /// # Use cases
    /// - Play collision sound effects
    /// - Apply damage when objects hit
    /// - Trigger game events (entering zones, picking up items)
    /// - Track what's touching what
    fn handle_collision_event(
        &self,
        bodies: &RigidBodySet,
        colliders: &ColliderSet,
        event: CollisionEvent,
        contact_pair: Option<&ContactPair>,
    );

    /// Called when contact forces exceed a threshold.
    ///
    /// Triggered when the total force magnitude between two colliders exceeds the
    /// [`Collider::contact_force_event_threshold`](crate::geometry::Collider::set_contact_force_event_threshold).
    /// At least one collider must have [`ActiveEvents::CONTACT_FORCE_EVENTS`] enabled.
    ///
    /// # Use cases
    /// - Detect hard impacts (for damage, breaking objects)
    /// - Monitor structural stress
    /// - Trigger effects at certain force levels (sparks, cracks)
    ///
    /// # Parameters
    /// * `total_force_magnitude` - Sum of magnitudes of all contact forces (not vector sum!)
    ///   Example: Two forces `[0, 100, 0]` and `[0, -100, 0]` → magnitude = 200 (not 0)
    fn handle_contact_force_event(
        &self,
        dt: Real,
        bodies: &RigidBodySet,
        colliders: &ColliderSet,
        contact_pair: &ContactPair,
        total_force_magnitude: Real,
    );

    /// Called at the end of a step for every soft body that tore during it (an element past its
    /// tear threshold, or a `SoftBody::tear_edge`/`tear_cell` request), once the topology change is
    /// applied ([`SoftBodyTearEvent`]); immediate `SoftBodySet::tear`/`cut` return theirs instead.
    fn handle_soft_body_tear_event(&self, soft_bodies: &SoftBodySet, event: &SoftBodyTearEvent);
}

#[cfg(feature = "alloc")]
impl EventHandler for () {
    fn handle_collision_event(
        &self,
        _bodies: &RigidBodySet,
        _colliders: &ColliderSet,
        _event: CollisionEvent,
        _contact_pair: Option<&ContactPair>,
    ) {
    }

    fn handle_contact_force_event(
        &self,
        _dt: Real,
        _bodies: &RigidBodySet,
        _colliders: &ColliderSet,
        _contact_pair: &ContactPair,
        _total_force_magnitude: Real,
    ) {
    }

    fn handle_soft_body_tear_event(&self, _soft_bodies: &SoftBodySet, _event: &SoftBodyTearEvent) {}
}

/// A ready-to-use event handler that collects events into channels for later processing.
///
/// Instead of processing events immediately during physics step, this collector sends them
/// to channels that you can poll from your game loop. This is the recommended approach.
///
/// # Example
/// ```
/// # use rapier3d::prelude::*;
/// use std::sync::mpsc::channel;
///
/// let (collision_send, collision_recv) = channel();
/// let (contact_force_send, contact_force_recv) = channel();
/// let (soft_body_tear_send, soft_body_tear_recv) = channel();
/// let event_handler =
///     ChannelEventCollector::new(collision_send, contact_force_send, soft_body_tear_send);
///
/// // After physics step:
/// while let Ok(collision_event) = collision_recv.try_recv() {
///     match collision_event {
///         CollisionEvent::Started(h1, h2, _) => println!("Collision!"),
///         CollisionEvent::Stopped(h1, h2, _) => println!("Separated"),
///     }
/// }
/// while let Ok(tear_event) = soft_body_tear_recv.try_recv() {
///     println!("Soft body {:?} tore", tear_event.soft_body);
/// }
/// ```
#[cfg(feature = "std")]
pub struct ChannelEventCollector {
    collision_event_sender: std::sync::mpsc::Sender<CollisionEvent>,
    contact_force_event_sender: std::sync::mpsc::Sender<ContactForceEvent>,
    soft_body_tear_event_sender: std::sync::mpsc::Sender<SoftBodyTearEvent>,
}

#[cfg(feature = "std")]
impl ChannelEventCollector {
    /// Initialize a new event collector from channel senders, one per event kind.
    ///
    /// A sender whose receiver was dropped just discards the events of its kind.
    pub fn new(
        collision_event_sender: std::sync::mpsc::Sender<CollisionEvent>,
        contact_force_event_sender: std::sync::mpsc::Sender<ContactForceEvent>,
        soft_body_tear_event_sender: std::sync::mpsc::Sender<SoftBodyTearEvent>,
    ) -> Self {
        Self {
            collision_event_sender,
            contact_force_event_sender,
            soft_body_tear_event_sender,
        }
    }
}

#[cfg(feature = "std")]
impl EventHandler for ChannelEventCollector {
    fn handle_collision_event(
        &self,
        _bodies: &RigidBodySet,
        _colliders: &ColliderSet,
        event: CollisionEvent,
        _: Option<&ContactPair>,
    ) {
        let _ = self.collision_event_sender.send(event);
    }

    fn handle_contact_force_event(
        &self,
        dt: Real,
        _bodies: &RigidBodySet,
        _colliders: &ColliderSet,
        contact_pair: &ContactPair,
        total_force_magnitude: Real,
    ) {
        let result = ContactForceEvent::from_contact_pair(dt, contact_pair, total_force_magnitude);
        let _ = self.contact_force_event_sender.send(result);
    }

    fn handle_soft_body_tear_event(&self, _soft_bodies: &SoftBodySet, event: &SoftBodyTearEvent) {
        let _ = self.soft_body_tear_event_sender.send(event.clone());
    }
}
