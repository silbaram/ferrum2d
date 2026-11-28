// Ferrum2D modified vendored source; see FERRUM-PATCHES.md.
pub use self::ccd_solver::{CCDSolver, CcdClamp, CcdDiagnostics};
pub(crate) use self::sweeps::{post_solve_ccd_active, shape_never_ccd_swept};

mod ccd_solver;
mod sweeps;
