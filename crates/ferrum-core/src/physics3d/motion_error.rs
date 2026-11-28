//! Checked motion errors shared by the tick clock and the trajectory solver.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum TrajectoryError {
    WorkLimit,
    InvalidTime,
    InvalidReference,
    MissingBodyMotion,
    UnsupportedShape,
    NonFinite,
    Unresolved,
}
