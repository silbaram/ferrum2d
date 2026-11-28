//! Logical time within a physics tick and conversion to native integration seconds.

use super::motion_error::TrajectoryError;

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

/// The sole controller-duration conversion at the native physical boundary.
/// Reject underflow before previews can consume input or divide by zero.
pub(in crate::physics3d) fn native_duration(seconds: Time) -> Result<f32, TrajectoryError> {
    let value = seconds as f32;
    if !seconds.is_finite() || seconds <= 0. || !value.is_finite() || value <= 0. {
        return Err(TrajectoryError::InvalidTime);
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn domain_rejects_invalid_time_and_preserves_shared_boundaries() {
        assert!(matches!(
            Domain::new(-f64::MAX, f64::MAX),
            Err(TrajectoryError::InvalidTime)
        ));
        assert!(matches!(
            Domain::new(0., f64::NAN),
            Err(TrajectoryError::InvalidTime)
        ));
        let domain = Domain::new(-0., 0.025).unwrap();
        let first = domain.partition(0, 3).unwrap();
        let last = domain.partition(2, 3).unwrap();
        assert_eq!(first.start.to_bits(), domain.start.to_bits());
        assert_eq!(
            first.end.to_bits(),
            domain.partition(1, 3).unwrap().start.to_bits()
        );
        assert_eq!(last.end.to_bits(), domain.end.to_bits());
        assert_eq!(native_duration(domain.duration()).unwrap(), 0.025_f32);
        assert_eq!(
            native_duration(f64::from_bits(1)),
            Err(TrajectoryError::InvalidTime)
        );
    }
}
