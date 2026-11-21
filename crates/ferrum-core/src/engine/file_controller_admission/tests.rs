use super::*;
#[test]
fn empty_native_controller_guard_is_byte_pure() {
    let engine = Engine::new();
    let before = super::super::persistence::encode(&engine).unwrap();
    validate(
        &engine,
        Limits {
            max_work: 1_000_000,
            max_scratch_bytes: 1_000_000,
        },
    )
    .unwrap();
    assert_eq!(super::super::persistence::encode(&engine).unwrap(), before);
}
