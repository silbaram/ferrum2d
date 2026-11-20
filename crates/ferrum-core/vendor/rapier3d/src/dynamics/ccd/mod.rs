// Ferrum2D modified vendored source; see FERRUM-PATCHES.md.
pub use self::ccd_solver::{CCDSolver, CcdClamp, CcdDiagnostics};
pub(crate) use self::sweeps::{post_solve_ccd_active, shape_never_ccd_swept};

pub use self::sweeps::{
    solver_ccd_active, solver_ccd_body_tier_allows, solver_ccd_pair_kind,
    solver_ccd_shape_supported,
};

mod ccd_solver;
mod sweeps;
