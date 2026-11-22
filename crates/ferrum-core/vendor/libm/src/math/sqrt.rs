// Ferrum2D modified vendored source; see FERRUM-PATCHES.md.
/// The square root of `x` (f16).
#[cfg(f16_enabled)]
#[cfg_attr(assert_no_panic, no_panic::no_panic)]
pub fn sqrtf16(x: f16) -> f16 {
    select_implementation! {
        name: sqrtf16,
        use_arch: all(target_arch = "aarch64", target_feature = "fp16"),
        args: x,
    }

    return super::generic::sqrt(x);
}

/// The square root of `x` (f32).
#[cfg_attr(assert_no_panic, no_panic::no_panic)]
// Ferrum2D: let glam's inline wrappers reach the hardware instruction.
#[cfg_attr(all(target_arch = "wasm32", not(intrinsics_enabled)), inline)]
pub fn sqrtf(x: f32) -> f32 {
    // Ferrum2D: stable wasm32 otherwise falls back to the bitwise generic
    // routine. IEEE 754 square root is correctly rounded on both paths, so a
    // non-negative input (including -0.0 and +inf) returns identical bits;
    // negative and NaN inputs keep the generic path and its exact NaN bits.
    #[cfg(all(target_arch = "wasm32", not(intrinsics_enabled)))]
    if x >= 0.0 {
        return std::primitive::f32::sqrt(x);
    }
    select_implementation! {
        name: sqrtf,
        use_arch: any(
            all(target_arch = "aarch64", target_feature = "neon"),
            all(target_arch = "wasm32", intrinsics_enabled),
            target_feature = "sse2"
        ),
        args: x,
    }

    super::generic::sqrt(x)
}

/// The square root of `x` (f64).
#[cfg_attr(assert_no_panic, no_panic::no_panic)]
#[cfg_attr(all(target_arch = "wasm32", not(intrinsics_enabled)), inline)]
pub fn sqrt(x: f64) -> f64 {
    // Ferrum2D: same correctly rounded hardware path as `sqrtf` above.
    #[cfg(all(target_arch = "wasm32", not(intrinsics_enabled)))]
    if x >= 0.0 {
        return std::primitive::f64::sqrt(x);
    }
    select_implementation! {
        name: sqrt,
        use_arch: any(
            all(target_arch = "aarch64", target_feature = "neon"),
            all(target_arch = "wasm32", intrinsics_enabled),
            target_feature = "sse2"
        ),
        args: x,
    }

    super::generic::sqrt(x)
}

/// The square root of `x` (f128).
#[cfg(f128_enabled)]
#[cfg_attr(assert_no_panic, no_panic::no_panic)]
pub fn sqrtf128(x: f128) -> f128 {
    return super::generic::sqrt(x);
}
