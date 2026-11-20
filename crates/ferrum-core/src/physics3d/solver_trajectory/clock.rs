//! Private logical time within one controller/nominal tick. Native observer
//! labels and physical integration_seconds retain their original f32 values.
use super::TrajectoryError;
use rapier3d::{pipeline::SolverBodyIntegration, prelude as rp};

pub(in crate::physics3d) type Time = f64;

#[derive(Clone, Copy, Debug, serde::Serialize, serde::Deserialize)]
pub(in crate::physics3d) struct Domain {
    pub start: Time,
    pub end: Time,
}
impl Domain {
    pub fn new(start: Time, end: Time) -> Result<Self, TrajectoryError> {
        if !start.is_finite() || !end.is_finite() || end < start || !(end - start).is_finite() {
            return Err(TrajectoryError::InvalidTime);
        }
        Ok(Self { start, end })
    }
    /// An exact shared boundary; the first/last boundary keeps its original bits.
    pub fn boundary(self, index: usize, count: usize) -> Result<Time, TrajectoryError> {
        if count == 0 || index > count {
            return Err(TrajectoryError::InvalidTime);
        }
        Ok(if index == 0 {
            self.start
        } else if index == count {
            self.end
        } else {
            self.start + self.duration() * (index as Time / count as Time)
        })
    }
    pub fn partition(self, index: usize, count: usize) -> Result<Self, TrajectoryError> {
        if index >= count {
            return Err(TrajectoryError::InvalidTime);
        }
        Self::new(
            self.boundary(index, count)?,
            self.boundary(index + 1, count)?,
        )
    }
    pub fn duration(self) -> Time {
        self.end - self.start
    }
}

#[derive(Clone, Copy, Debug, serde::Serialize, serde::Deserialize)]
pub(in crate::physics3d) struct Kernel {
    pub native: SolverBodyIntegration,
    pub domain: Domain,
}
impl Kernel {
    pub fn from_native(
        native: SolverBodyIntegration,
        domain: Domain,
    ) -> Result<Self, TrajectoryError> {
        Domain::new(domain.start, domain.end)?;
        if !native.motion.start_time.is_finite()
            || !native.motion.end_time.is_finite()
            || native.motion.end_time <= native.motion.start_time
            || domain.duration() <= 0.
            || !native.integration_seconds.is_finite()
            || native.integration_seconds <= 0.
        {
            return Err(TrajectoryError::InvalidTime);
        }
        // These are the same scalar operations used by the public-to-owner
        // derivative boundary below. A malformed tiny/huge saved logical span
        // must not manufacture an infinite or underflowed scale even though
        // its endpoints and original physical kernel are separately finite.
        let scale = (f64::from(native.integration_seconds) / domain.duration()) as f32;
        if !scale.is_finite()
            || scale <= 0.
            || !(native.linear_velocity * scale).is_finite()
            || !(native.angular_velocity * scale).is_finite()
        {
            return Err(TrajectoryError::NonFinite);
        }
        if !native.motion.start.is_finite()
            || !native.motion.end.is_finite()
            || !native.linear_velocity.is_finite()
            || !native.angular_velocity.is_finite()
        {
            return Err(TrajectoryError::NonFinite);
        }
        Ok(Self { native, domain })
    }
    pub fn from_velocity(
        body: rp::RigidBodyHandle,
        domain: Domain,
        start: rp::Pose,
        linear: rp::Vector,
        angular: rp::Vector,
    ) -> Result<Self, TrajectoryError> {
        Domain::new(domain.start, domain.end)?;
        // Fresh Character/authoring kernels use their existing physical-dt
        // conversion. Native response continuations pass their original h
        // explicitly through from_velocity_seconds instead.
        Self::from_velocity_seconds(
            body,
            domain,
            domain.duration() as f32,
            start,
            linear,
            angular,
        )
    }
    pub fn from_velocity_seconds(
        body: rp::RigidBodyHandle,
        domain: Domain,
        dt: f32,
        start: rp::Pose,
        linear: rp::Vector,
        angular: rp::Vector,
    ) -> Result<Self, TrajectoryError> {
        Domain::new(domain.start, domain.end)?;
        if !dt.is_finite() || dt <= 0. {
            return Err(TrajectoryError::InvalidTime);
        }
        let native = SolverBodyIntegration::from_velocity(body, 0., dt, start, linear, angular)
            .ok_or(TrajectoryError::NonFinite)?;
        Self::from_native(native, domain)
    }
    /// Original physical integration time belonging to a logical subdomain.
    /// Repeated response proposals use the same h/D authority as their source
    /// kernel, without converting an absolute or logical timestamp to Native dt.
    pub fn physical_span(self, domain: Domain) -> Result<f32, TrajectoryError> {
        Domain::new(self.domain.start, self.domain.end)?;
        Domain::new(domain.start, domain.end)?;
        let h = self.native.integration_seconds;
        if self.domain.duration() <= 0.
            || domain.duration() <= 0.
            || domain.start < self.domain.start
            || domain.end > self.domain.end
            || !h.is_finite()
            || h <= 0.
        {
            return Err(TrajectoryError::InvalidTime);
        }
        let dt = if domain.start == self.domain.start && domain.end == self.domain.end {
            h
        } else {
            (f64::from(h) * (domain.duration() / self.domain.duration())) as f32
        };
        if !dt.is_finite() || dt <= 0. {
            return Err(TrajectoryError::InvalidTime);
        }
        Ok(dt)
    }
    pub fn domain(self) -> Domain {
        self.domain
    }
    #[cfg(test)]
    pub fn shifted(mut self, offset: Time) -> Self {
        self.domain.start += offset;
        self.domain.end += offset;
        self
    }
    /// Every Native pose branch has the positive-zero identity quaternion,
    /// including the normalized interior. Stored endpoints have separate bits.
    pub fn has_identity_orientation(self) -> bool {
        let identity = rp::Rotation::IDENTITY.to_array().map(f32::to_bits);
        self.native.angular_velocity.to_array().map(f32::to_bits) == [0; 3]
            && self
                .native
                .motion
                .start
                .rotation
                .to_array()
                .map(f32::to_bits)
                == identity
            && self.native.motion.end.rotation.to_array().map(f32::to_bits) == identity
    }
    pub fn local_delta(self, time: Time) -> f32 {
        let fraction = ((time - self.domain.start) / self.domain.duration()).clamp(0., 1.);
        (fraction * f64::from(self.native.integration_seconds)) as f32
    }
    pub fn position_at_time(self, time: Time) -> rp::Pose {
        if time <= self.domain.start {
            self.native.motion.start
        } else if time >= self.domain.end {
            self.native.motion.end
        } else {
            self.native
                .position_at_integration_time(self.local_delta(time))
        }
    }
    pub fn linear_velocity_at_time(self) -> rp::Vector {
        self.native.linear_velocity
            * (f64::from(self.native.integration_seconds) / self.domain.duration()) as f32
    }
    pub fn angular_velocity_at_time(self, time: Time) -> rp::Vector {
        let dt = f64::from(self.local_delta(time));
        let norm2 = self
            .native
            .angular_velocity
            .to_array()
            .into_iter()
            .map(|x| f64::from(x).powi(2))
            .sum::<f64>();
        let scale = (f64::from(self.native.integration_seconds) / self.domain.duration())
            / (1. + 0.25 * norm2 * dt * dt);
        self.native.angular_velocity * scale as f32
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn private_domain_rejects_overflow_and_invalid_native_labels_without_retiming() {
        assert!(matches!(
            Domain::new(-f64::MAX, f64::MAX),
            Err(TrajectoryError::InvalidTime)
        ));
        assert!(matches!(
            Domain::new(0., f64::NAN),
            Err(TrajectoryError::InvalidTime)
        ));
        let domain = Domain::new(0., f64::from(0.025_f32)).unwrap();
        let native = SolverBodyIntegration::from_velocity(
            rp::RigidBodyHandle::invalid(),
            0.,
            0.025,
            rp::Pose::IDENTITY,
            rp::Vector::X,
            rp::Vector::Z,
        )
        .unwrap();
        for bad_span in [f64::from_bits(1), f64::MAX] {
            assert!(matches!(
                Kernel::from_native(native, Domain::new(0., bad_span).unwrap()),
                Err(TrajectoryError::NonFinite)
            ));
        }
        let original = postcard::to_allocvec(&native).unwrap();
        let kernel = Kernel::from_native(native, domain).unwrap();
        assert_eq!(postcard::to_allocvec(&kernel.native).unwrap(), original);
        for (start, end) in [
            (f32::NAN, 0.025),
            (0., f32::INFINITY),
            (0.025, 0.025),
            (0.05, 0.025),
        ] {
            let mut bad = native;
            bad.motion.start_time = start;
            bad.motion.end_time = end;
            assert!(matches!(
                Kernel::from_native(bad, domain),
                Err(TrajectoryError::InvalidTime)
            ));
        }
    }
}
